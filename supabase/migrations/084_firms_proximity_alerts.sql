-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 084 · FIRMS proximity alert rules
--
-- Adds the 'firms_proximity' rule type to the Notification Center so
-- a user can express "notify me when a thermal anomaly is detected
-- within N km of <facilities>". Evaluated by the existing cheap cron
-- (/api/cron/evaluate-rules-cheap, 15-min cadence) — no new evaluator
-- process, no Anthropic spend.
--
-- ─── WHAT A DETECTION IS (load-bearing, do not soften) ─────────
-- A FIRMS row is a THERMAL ANOMALY DETECTION from a satellite
-- radiometer. It is NOT a fire, NOT an explosion and NOT a strike.
-- The single largest population of detections next to refineries is
-- ROUTINE GAS FLARING — the current top-FRP rows in this database
-- sit on Jubail petrochemical plants (Sharq, Ibn Zahr, Tasnee),
-- which flare continuously by design. Attribution of a detection to
-- any event is INFERENCE. Equally, absence of a detection does not
-- imply absence of fire: cloud cover, overpass timing and the ~375 m
-- pixel floor all hide real events. Alert copy is constrained
-- accordingly in apps/web/lib/notifications/firms-proximity.ts.
--
-- ═══════════════════════════════════════════════════════════════
-- ─── PROBLEM 1 · THE ROLL-UP IS GLOBAL, THE INGEST IS NOT ──────
-- ═══════════════════════════════════════════════════════════════
-- firms_facility_observations contains a row per monitored facility
-- per day INCLUDING detection_count = 0. That zero is meaningful
-- ONLY where a satellite was actually queried. FIRMS ingest covers
-- three bounding boxes (FIRMS_REGIONS in apps/web/lib/firms/client.ts):
--     ru-ua   22E..60E, 44N..62N
--     gulf    44E..60E, 22N..34N
--     europe  10W..22E, 35N..60N
-- but the roll-up writes rows for facilities WORLDWIDE. Verified
-- against production on 2026-07-18:
--
--     China          39,796 facilities → 0 inside any ingest bbox
--     United States  16,964 facilities → 0
--     India           8,286 facilities → 0
--     Poland           5,472 → 5,472 (fully covered)
--     Ukraine            843 →   843 (fully covered)
--     Russia           1,801 →   971 (PARTIAL — the ru-ua box stops
--                                     at 60E, so facilities east of
--                                     that are never looked at)
--
-- China therefore shows 8,452 facility-days of detection_count = 0
-- purely because nobody is looking. A day-level coverage gate on
-- firms_ingest_runs.ok PASSES for those facilities, because a run
-- succeeded that day — for a different region. So the naive gate
-- reports an unmonitored Chinese refinery as "quiet", which is a
-- false negative dressed up as a measurement.
--
-- FIX: both functions below take the ingest bboxes as a jsonb
-- parameter and fail CLOSED — a facility outside every bbox is not
-- monitored, is never matched, and never counts toward coverage.
-- The bboxes are passed IN from TypeScript rather than duplicated
-- here so FIRMS_REGIONS stays the single source of truth; widening
-- the ingest automatically widens alerting with no migration.
--
-- ═══════════════════════════════════════════════════════════════
-- ─── PROBLEM 2 · REFINERY COUNTRY ATTRIBUTION IS ABSENT ────────
-- ═══════════════════════════════════════════════════════════════
-- The headline user story was "thermal anomaly within 2 km of any
-- RUSSIAN REFINERY". That story CANNOT be honestly served by the
-- current data and this migration does not pretend otherwise:
--
--   refineries (634 rows, OSM-sourced)
--     country      populated on 3 rows (values 'AT','US','DE')
--     iso_country  populated on 0 rows
--     matching Russia: 0
--   power_plants (GEM-sourced)
--     country populated on 100% of rows — Russia 1801, Ukraine 843
--
-- So country-scoped POWER PLANT rules are backed by real data;
-- country-scoped REFINERY rules resolve to zero facilities.
--
-- REJECTED APPROACH — spatial resolution via geo_regions. It looks
-- like the fix (kind='country', 15 rows incl. RU/UA) and appears to
-- work: 10 refineries "land inside" RU. They do not. Every
-- geo_regions country geometry is a single axis-aligned BOUNDING
-- BOX, not a border:
--     RU  bbox 19E..180E, 41N..82N
--     UA  bbox 22E..41E,  44N..53N
-- The RU box contains Poland, Germany, Finland, Turkey, Kazakhstan,
-- Mongolia, northern China and Japan, and overlaps the UA box. A
-- spatial join against it resolved "Plock Refinery" (Płock, POLAND)
-- to Russia — it would have emitted "thermal anomaly near a Russian
-- refinery" for a Polish one, with a non-deterministic country pick
-- where boxes overlap. Publishing false national attribution on a
-- geopolitical feed is worse than not shipping the filter, so
-- geo_regions is NOT used here.
--
-- Consequence for the app layer: rule creation calls
-- firms_rule_coverage() and REFUSES to save a rule that resolves to
-- zero MONITORED facilities, and surfaces partial coverage (e.g.
-- Russia 971/1801) rather than implying the whole country is
-- watched. That is the "code shipped, data never arrived" failure
-- mode this codebase has already paid for.
--
-- ─── RADIUS CEILING ────────────────────────────────────────────
-- firms_derive_facility_observations pre-computes at a fixed radius
-- (currently 5 km, stored per row in radius_km). A rule asking for a
-- radius LARGER than the roll-up radius cannot be answered from the
-- roll-up and would under-report silently, so the RPC refuses those
-- rows via `p_radius_km <= o.radius_km` rather than hardcoding 5 —
-- self-correcting if the roll-up radius is ever widened.
--
-- ─── DAY COVERAGE GATE ─────────────────────────────────────────
-- On top of the spatial gate, a day is meaningful only if some
-- ingest run for it succeeded (firms_ingest_runs.ok = true). We
-- never alert on, nor reason from, the mere absence of data.
--
-- Idempotent and additive. Apply MANUALLY in the Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1 · Extend the rule_type CHECK constraint ─────────────────
-- Mirrors migration 041. The CHECK cannot be altered in place.
ALTER TABLE user_notification_rules
  DROP CONSTRAINT IF EXISTS user_notification_rules_rule_type_check;
ALTER TABLE user_notification_rules
  ADD CONSTRAINT user_notification_rules_rule_type_check
  CHECK (rule_type IN (
    'single_event', 'multi_event', 'outcome_ai', 'cross_data_ai',
    'aggregate', 'firms_proximity'
  ));

-- Widen the cheap-cron partial index to include the new type.
-- Partial-index predicates cannot be altered; drop + recreate.
DROP INDEX IF EXISTS idx_user_notification_rules_cheap_active;
CREATE INDEX idx_user_notification_rules_cheap_active
  ON user_notification_rules (rule_type, last_fired_at)
  WHERE active = true AND rule_type IN (
    'single_event', 'multi_event', 'aggregate', 'firms_proximity'
  );

-- ─── 2 · De-duplication ledger ─────────────────────────────────
-- One row per (rule, facility, day) that has ALREADY been alerted on.
-- The unique index IS the dedup mechanism: the cron inserts candidate
-- matches with ON CONFLICT DO NOTHING and alerts only on the rows
-- that actually landed. That makes the claim atomic — two overlapping
-- cron ticks cannot both alert on the same facility-day.
--
-- Deliberately keyed on `period` (the observation day) and not on a
-- timestamp: a refinery that flares every day for a week produces one
-- alert per day per rule, not one per 15-minute tick.
CREATE TABLE IF NOT EXISTS firms_alert_dispatches (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id          UUID NOT NULL REFERENCES user_notification_rules(id) ON DELETE CASCADE,
  facility_type    TEXT NOT NULL,
  facility_id      TEXT NOT NULL,
  period           DATE NOT NULL,
  -- Snapshot of what triggered the claim, for audit and for the
  -- detail drawer. Not read back by the evaluator.
  detection_count  INTEGER,
  max_frp          NUMERIC,
  nearest_km       NUMERIC,
  facility_country TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS firms_alert_dispatches_uniq
  ON firms_alert_dispatches (rule_id, facility_type, facility_id, period);

-- Supports the retention sweep and per-rule history reads.
CREATE INDEX IF NOT EXISTS firms_alert_dispatches_rule_created_idx
  ON firms_alert_dispatches (rule_id, created_at DESC);

-- Service-role only: the cron writes these, users never read them
-- directly (the user-visible history is user_notification_log).
-- RLS ENABLED WITH NO POLICY = deny-all to anon/authenticated.
ALTER TABLE firms_alert_dispatches ENABLE ROW LEVEL SECURITY;

-- ─── 3 · Shared facility view ──────────────────────────────────
-- Unions the two monitored facility classes so country/name/position
-- resolution is written once. country is passed through EXACTLY as
-- stored — no inference, no spatial guessing (see header).
CREATE OR REPLACE VIEW firms_monitored_facilities AS
  SELECT
    f.id                                   AS facility_id,
    'refinery'::TEXT                       AS facility_type,
    f.refinery_name                        AS facility_name,
    NULLIF(TRIM(COALESCE(f.country, f.iso_country)), '') AS facility_country,
    f.latitude                             AS latitude,
    f.longitude                            AS longitude
  FROM refineries f
  UNION ALL
  SELECT
    p.id                                   AS facility_id,
    'power_plant'::TEXT                    AS facility_type,
    p.plant_name                           AS facility_name,
    NULLIF(TRIM(p.country), '')            AS facility_country,
    p.latitude                             AS latitude,
    p.longitude                            AS longitude
  FROM power_plants p;

-- ─── 4 · Ingest-bbox containment ───────────────────────────────
-- p_regions is a jsonb array of {west,south,east,north} passed in
-- from FIRMS_REGIONS (TypeScript is the single source of truth).
-- NULL/empty regions → NOT monitored. Fails closed by construction:
-- if the caller forgets to pass regions, nothing matches rather than
-- everything matching.
CREATE OR REPLACE FUNCTION firms_point_in_regions(
  p_lat     DOUBLE PRECISION,
  p_lon     DOUBLE PRECISION,
  p_regions JSONB
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE((
    SELECT bool_or(
      p_lat IS NOT NULL AND p_lon IS NOT NULL
      AND p_lat >= (r->>'south')::DOUBLE PRECISION
      AND p_lat <= (r->>'north')::DOUBLE PRECISION
      AND p_lon >= (r->>'west')::DOUBLE PRECISION
      AND p_lon <= (r->>'east')::DOUBLE PRECISION
    )
    FROM jsonb_array_elements(COALESCE(p_regions, '[]'::JSONB)) AS r
  ), FALSE);
$$;

-- ─── 5 · Coverage pre-check ────────────────────────────────────
-- Returns how many facilities a rule's filters resolve to, and how
-- many of those are actually inside an ingest bbox. The rules API
-- calls this BEFORE saving and refuses to create a rule whose
-- monitored count is zero — the guard against a rule that looks
-- healthy and can never fire. When monitored < matching, the caller
-- surfaces the ratio so partial coverage (Russia 971/1801) is
-- disclosed rather than implied away.
DROP FUNCTION IF EXISTS firms_rule_coverage(TEXT, TEXT, TEXT, JSONB);

CREATE OR REPLACE FUNCTION firms_rule_coverage(
  p_facility_type TEXT  DEFAULT NULL,
  p_country       TEXT  DEFAULT NULL,
  p_facility_name TEXT  DEFAULT NULL,
  p_regions       JSONB DEFAULT NULL
)
RETURNS TABLE (
  matching_facilities  INTEGER,
  monitored_facilities INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COUNT(*)::INTEGER AS matching_facilities,
    COUNT(*) FILTER (
      WHERE firms_point_in_regions(m.latitude, m.longitude, p_regions)
    )::INTEGER AS monitored_facilities
  FROM firms_monitored_facilities m
  WHERE (p_facility_type IS NULL OR m.facility_type = p_facility_type)
    AND (p_country       IS NULL OR m.facility_country ILIKE p_country)
    AND (p_facility_name IS NULL OR m.facility_name ILIKE '%' || p_facility_name || '%');
$$;

-- ─── 6 · Match RPC ─────────────────────────────────────────────
-- Returns candidate facility-days for one rule's filter set. The cron
-- then claims them against firms_alert_dispatches.
DROP FUNCTION IF EXISTS firms_match_facility_alerts(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INTEGER, DATE, JSONB, INTEGER);

CREATE OR REPLACE FUNCTION firms_match_facility_alerts(
  p_facility_type  TEXT    DEFAULT NULL,
  p_country        TEXT    DEFAULT NULL,
  p_facility_name  TEXT    DEFAULT NULL,
  p_radius_km      NUMERIC DEFAULT NULL,
  p_min_frp        NUMERIC DEFAULT 0,
  p_min_detections INTEGER DEFAULT 1,
  p_since_period   DATE    DEFAULT NULL,
  p_regions        JSONB   DEFAULT NULL,
  p_limit          INTEGER DEFAULT 200
)
RETURNS TABLE (
  facility_type    TEXT,
  facility_id      TEXT,
  facility_name    TEXT,
  facility_country TEXT,
  period           DATE,
  detection_count  INTEGER,
  max_frp          NUMERIC,
  nearest_km       NUMERIC,
  radius_km        NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH covered_days AS (
    -- Day gate: a day is meaningful only if some ingest run for it
    -- succeeded. Never reason from absence of data.
    SELECT DISTINCT r.day_covered AS day
    FROM firms_ingest_runs r
    WHERE r.ok = true
  )
  SELECT
    o.facility_type,
    o.facility_id,
    COALESCE(o.facility_name, m.facility_name) AS facility_name,
    COALESCE(NULLIF(TRIM(o.country), ''), m.facility_country) AS facility_country,
    o.period,
    o.detection_count,
    o.max_frp,
    o.nearest_km,
    o.radius_km
  FROM firms_facility_observations o
  JOIN covered_days c ON c.day = o.period
  -- INNER JOIN, not LEFT: an observation whose facility we cannot
  -- locate cannot be shown to be inside an ingested region, so it
  -- fails closed.
  JOIN firms_monitored_facilities m
    ON m.facility_id = o.facility_id AND m.facility_type = o.facility_type
  WHERE
    -- Spatial gate: facility must sit inside an ingest bbox. Without
    -- this, an unmonitored facility's detection_count = 0 rows read
    -- as "quiet" when in truth nobody looked.
    firms_point_in_regions(m.latitude, m.longitude, p_regions)
    -- A detection actually occurred. detection_count = 0 rows are
    -- the coverage record, never an alert.
    AND o.detection_count >= GREATEST(COALESCE(p_min_detections, 1), 1)
    -- Requested radius must be answerable from the roll-up.
    AND COALESCE(p_radius_km, o.radius_km) <= o.radius_km
    AND o.nearest_km IS NOT NULL
    AND o.nearest_km <= COALESCE(p_radius_km, o.radius_km)
    AND COALESCE(o.max_frp, 0) >= COALESCE(p_min_frp, 0)
    AND (p_facility_type IS NULL OR o.facility_type = p_facility_type)
    AND (p_since_period IS NULL OR o.period >= p_since_period)
    AND (
      p_facility_name IS NULL
      OR COALESCE(o.facility_name, m.facility_name) ILIKE '%' || p_facility_name || '%'
    )
    AND (
      p_country IS NULL
      OR COALESCE(NULLIF(TRIM(o.country), ''), m.facility_country) ILIKE p_country
    )
  ORDER BY o.period DESC, o.max_frp DESC NULLS LAST
  LIMIT GREATEST(COALESCE(p_limit, 200), 1);
$$;

-- The API and cron call these with the service role. SECURITY DEFINER
-- lets them read the facility tables consistently; they expose no
-- user-scoped data (FIRMS and facility data are public feeds) and
-- take only scalar/jsonb filter arguments.
REVOKE ALL ON FUNCTION firms_rule_coverage(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION firms_rule_coverage(TEXT, TEXT, TEXT, JSONB) TO service_role;

REVOKE ALL ON FUNCTION firms_match_facility_alerts(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INTEGER, DATE, JSONB, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION firms_match_facility_alerts(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INTEGER, DATE, JSONB, INTEGER) TO service_role;
