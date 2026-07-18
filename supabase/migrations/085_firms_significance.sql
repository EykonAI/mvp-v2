-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 085 · FIRMS coverage restriction + significance events
--
-- Two things, and they are the same thing.
--
-- 1 · THE P0 · Coverage honesty by construction.
--     081/083 wrote a firms_facility_observations row for EVERY
--     facility worldwide, but ingest only ever covers a few bboxes.
--     Those detection_count = 0 rows for China (8,452 facility-days),
--     the USA (2,972) and India (2,766) assert "we looked and saw
--     nothing" when the truth is "nobody looked". The resolver gates
--     on firms_ingest_runs by DAY, not by REGION — so a call on a
--     Chinese refinery finds the day covered (a European run
--     succeeded) and is scored CORRECT against data never collected.
--
--     Fix: the rollup now takes p_regions and writes rows ONLY for
--     facilities inside a covered bbox. A row therefore means "this
--     facility was watched on this day" — the property every
--     downstream consumer (resolver, alerts, First Ten, AI tool) was
--     already assuming. Unwatched facilities have no row at all,
--     which reads correctly as "no data" everywhere.
--
--     Side effect: daily writes drop from 13,262 to ~1,817 and grow
--     only as real coverage grows.
--
-- 2 · SIGNIFICANCE · A detection is not an event.
--     Founder scope (2026-07-18): only thermal activity with
--     geopolitical or strong economic impact is of interest.
--     Agricultural burning is not, even beside a refinery.
--
--     A refinery that flares daily is BASELINE, not news — Tasnee
--     logged 101 detections and Bandar Abbas 23 in two days, which is
--     continuous flaring. Significance is DEVIATION FROM A FACILITY'S
--     OWN BASELINE, in three forms:
--
--       ignition   — a normally-dark facility lights up
--       elevated   — a burning facility burns materially harder
--       went_dark  — an habitually-burning facility stops
--                    (the outage signal: refinery down, grid hit)
--
--     went_dark is only computable because of fix (1): absence of
--     detection means something ONLY where we were definitely
--     looking. On an unwatched facility it would be pure artefact.
--
-- HONESTY INVARIANTS carried forward:
--   • A detection is a hot pixel, not a fire and not a strike.
--   • Cloud cover and overpass timing mean absence of detection is
--     not absence of fire — so went_dark requires SUSTAINED absence
--     across multiple covered days, never a single quiet day, and is
--     still labelled inference.
--   • Every event records the baseline it deviated from, so a reader
--     can judge the claim instead of trusting it.
--
-- Additive. RLS ON, service-role only. Apply MANUALLY before merge.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1 · Rollup restricted to covered facilities ───────────────
-- p_regions is the FIRMS_REGIONS bbox array as JSONB (TypeScript
-- stays the single source of truth, same contract as 084).
-- Fails closed: NULL/empty regions writes NOTHING, rather than
-- silently reverting to worldwide.
--
-- ⚠ The DROP below is load-bearing, not tidiness. Adding p_regions
-- CHANGES THE SIGNATURE, and `CREATE OR REPLACE` matches on identity
-- argument types — so without the DROP this does NOT replace the
-- existing 3-arg function, it CREATES A SECOND OVERLOAD and leaves the
-- old worldwide-writing 3-arg version live. The ingest cron calls it
-- with exactly three named args, which resolves to that old function
-- (or errors ambiguously). Either way the entire coverage fix would be
-- a silent no-op, and step 1b's purge would be re-created worldwide by
-- the very next cron tick. Dropping first forces migration and caller
-- to move together or not at all.
DROP FUNCTION IF EXISTS firms_derive_facility_observations(date, numeric, numeric);

CREATE OR REPLACE FUNCTION firms_derive_facility_observations(
  p_day       date,
  p_radius_km numeric DEFAULT 5,
  p_min_mw    numeric DEFAULT 500,
  p_regions   jsonb   DEFAULT NULL
) RETURNS int AS $$
DECLARE
  v_rows int;
BEGIN
  IF p_regions IS NULL OR jsonb_array_length(p_regions) = 0 THEN
    -- Fail closed AND LOUD. Returning 0 here would be worse than
    -- useless: the caller reports a successful run that wrote
    -- nothing, which is the silent-no-op failure mode this whole
    -- feature exists to prevent. A caller that forgets its regions
    -- must go red, not green-with-no-data.
    RAISE EXCEPTION 'firms_derive_facility_observations: p_regions is required (declared coverage cannot be empty)';
  END IF;

  WITH monitored AS (
    SELECT 'refinery'::text AS facility_type,
           r.id::text       AS facility_id,
           r.refinery_name  AS facility_name,
           r.country,
           r.geom,
           r.latitude, r.longitude
      FROM refineries r
     WHERE r.geom IS NOT NULL
    UNION ALL
    SELECT 'power_plant'::text,
           p.id::text,
           p.plant_name,
           p.country,
           p.geom,
           p.latitude, p.longitude
      FROM power_plants p
     WHERE p.geom IS NOT NULL
       AND p.capacity_mw >= p_min_mw
  ),
  covered AS (
    SELECT * FROM monitored m
     WHERE firms_point_in_regions(m.latitude, m.longitude, p_regions)
  ),
  day_detections AS (
    SELECT f.id, f.frp, f.geom
      FROM firms_thermal_anomalies f
     WHERE f.acq_date = p_day
       AND f.geom IS NOT NULL
  ),
  hits AS (
    SELECT c.facility_type,
           c.facility_id,
           COUNT(*)                                                        AS detection_count,
           MAX(d.frp)                                                      AS max_frp,
           MIN(ST_Distance(c.geom::geography, d.geom::geography)) / 1000.0 AS nearest_km
      FROM day_detections d
      JOIN covered c
        ON ST_DWithin(c.geom::geography, d.geom::geography, p_radius_km * 1000)
     GROUP BY 1, 2
  )
  INSERT INTO firms_facility_observations (
    facility_type, facility_id, facility_name, country,
    period, detection_count, max_frp, nearest_km, radius_km, computed_at
  )
  SELECT c.facility_type, c.facility_id, c.facility_name, c.country,
         p_day,
         COALESCE(h.detection_count, 0),
         h.max_frp, h.nearest_km, p_radius_km, now()
    FROM covered c
    LEFT JOIN hits h
      ON h.facility_type = c.facility_type
     AND h.facility_id   = c.facility_id
  ON CONFLICT (facility_type, facility_id, period) DO UPDATE
    SET detection_count = EXCLUDED.detection_count,
        max_frp         = EXCLUDED.max_frp,
        nearest_km      = EXCLUDED.nearest_km,
        radius_km       = EXCLUDED.radius_km,
        computed_at     = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$ LANGUAGE plpgsql;

-- ─── 1b · Purge observations that were never actually observed ─
-- The rows already written for facilities outside every ingest bbox
-- (China 8,452 facility-days, USA 2,972, India 2,766 — all at
-- detection_count = 0) are false assertions: they claim an
-- observation that never happened. Leaving them would let the
-- resolver keep scoring calls against them.
--
-- Safe to delete: they carry no information by definition (a zero
-- that was never looked at), they are two days old, and the rollup
-- regenerates any facility that genuinely is covered on the next
-- cron tick.
--
-- Deliberately NOT parameterised on p_regions — a migration cannot
-- see the TypeScript constant, so this uses the bboxes as of
-- 2026-07-18. If FIRMS_REGIONS has changed by the time you apply
-- this, the next rollup re-creates anything wrongly removed.
DELETE FROM firms_facility_observations o
 WHERE NOT firms_point_in_regions(
   (SELECT latitude  FROM firms_monitored_facilities m
     WHERE m.facility_type = o.facility_type AND m.facility_id = o.facility_id),
   (SELECT longitude FROM firms_monitored_facilities m
     WHERE m.facility_type = o.facility_type AND m.facility_id = o.facility_id),
   '[{"west":22,"south":44,"east":60,"north":62},
     {"west":44,"south":22,"east":60,"north":34},
     {"west":-10,"south":35,"east":22,"north":60}]'::jsonb
 );

-- ─── 2 · Significant events ────────────────────────────────────
CREATE TABLE IF NOT EXISTS firms_significant_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_type   text NOT NULL,
  facility_id     text NOT NULL,
  facility_name   text,
  country         text,
  period          date NOT NULL,
  event_type      text NOT NULL
    CHECK (event_type IN ('ignition','elevated','went_dark')),

  -- What was observed, and what it departed from. Both stored so a
  -- reader can judge the claim rather than trust the label.
  observed_count    int,
  observed_max_frp  numeric,
  baseline_days     int     NOT NULL,
  baseline_rate     numeric,   -- share of covered baseline days with >=1 detection
  baseline_mean_frp numeric,
  deviation         numeric,   -- magnitude of departure (see RPC)
  dark_days         int,       -- consecutive covered zero-days (went_dark only)

  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (facility_type, facility_id, period, event_type)
);

CREATE INDEX IF NOT EXISTS firms_sig_period_idx  ON firms_significant_events (period DESC);
CREATE INDEX IF NOT EXISTS firms_sig_type_idx    ON firms_significant_events (event_type, period DESC);
CREATE INDEX IF NOT EXISTS firms_sig_facility_idx
  ON firms_significant_events (facility_type, facility_id, period DESC);

-- ─── 3 · Detection RPC ─────────────────────────────────────────
-- Baseline is computed from the facility's OWN trailing covered days,
-- excluding the target day. A facility with too few covered baseline
-- days is skipped entirely — no baseline, no claim.
CREATE OR REPLACE FUNCTION firms_detect_significant_events(
  p_day            date,
  p_baseline_days  int     DEFAULT 30,
  p_min_baseline   int     DEFAULT 7,    -- min covered days to judge
  p_elevated_mult  numeric DEFAULT 3.0,  -- FRP multiple over baseline
  p_dark_rate      numeric DEFAULT 0.6,  -- "habitually burning" floor
  p_dark_days      int     DEFAULT 3     -- consecutive zero-days
) RETURNS int AS $$
DECLARE
  v_rows int;
BEGIN
  WITH today AS (
    SELECT * FROM firms_facility_observations WHERE period = p_day
  ),
  base AS (
    SELECT o.facility_type, o.facility_id,
           COUNT(*)                                                   AS n_days,
           AVG((o.detection_count > 0)::int)::numeric                  AS rate,
           -- Mean FRP over the days this facility ACTUALLY BURNED, not
           -- over all covered days. Averaging in the zero-days answers
           -- the wrong question: it measures "how often × how hot"
           -- when 'elevated' needs "how hot, WHEN LIT". Including them
           -- drags the mean toward zero for every intermittent burner,
           -- so any ordinary burn clears mean * 3 and is mislabelled
           -- as burning materially harder than its own norm. NULL when
           -- the facility never burned — the `> 0` guard then skips it.
           AVG(o.max_frp) FILTER (WHERE o.detection_count > 0)::numeric AS mean_frp
      FROM firms_facility_observations o
     WHERE o.period <  p_day
       AND o.period >= p_day - p_baseline_days
     GROUP BY 1, 2
  ),
  -- Consecutive covered zero-days ending at p_day, plus the state of
  -- the previous covered day (used to require ignition be a genuine
  -- transition rather than day 2 of an ongoing burn).
  recent AS (
    SELECT o.facility_type, o.facility_id, o.period, o.detection_count,
           ROW_NUMBER() OVER (PARTITION BY o.facility_type, o.facility_id
                              ORDER BY o.period DESC) AS rn
      FROM firms_facility_observations o
     WHERE o.period <= p_day
       AND o.period >  p_day - p_baseline_days
  ),
  dark_streak AS (
    SELECT facility_type, facility_id,
           -- No COALESCE to the window length. When a facility has NO
           -- burning day in the window the FILTER is NULL, and the old
           -- fallback turned that NULL into "dark for the whole
           -- window" — i.e. it described a facility that has NEVER
           -- burned as one that has GONE DARK. The rate >= p_dark_rate
           -- gate happens to block that today, so it was never
           -- reachable in practice, but it left the worst failure this
           -- feature could have (a fabricated outage signal) one
           -- parameter change away. A facility with no burn history
           -- has no streak to report: NULL, and went_dark cannot fire.
           MIN(rn) FILTER (WHERE detection_count > 0) - 1 AS zero_run,
           MAX(detection_count) FILTER (WHERE rn = 2)     AS prev_count,
           COUNT(*)                                       AS n_recent
      FROM recent
     GROUP BY 1, 2
  ),
  joined AS (
    SELECT t.facility_type, t.facility_id, t.facility_name, t.country,
           t.detection_count, t.max_frp,
           b.n_days, b.rate, b.mean_frp,
           d.zero_run, d.prev_count
      FROM today t
      JOIN base b
        ON b.facility_type = t.facility_type AND b.facility_id = t.facility_id
      LEFT JOIN dark_streak d
        ON d.facility_type = t.facility_type AND d.facility_id = t.facility_id
     WHERE b.n_days >= p_min_baseline
  ),
  classified AS (
    SELECT j.*,
      CASE
        -- Normally dark, now burning — and dark on the PREVIOUS
        -- covered day, so this is the transition and not day 2 of a
        -- burn already reported. Without the prev_count guard a
        -- facility that burns two days running is re-flagged as
        -- "igniting" on the second day.
        --
        -- Note on the rate threshold: `rate <= 0.1` tightens as
        -- history thins. At the p_min_baseline floor of 7 covered days
        -- 1/7 = 0.14 > 0.1, so it collapses to "never burned in the
        -- window" — the conservative reading, which is the one we
        -- want when we know least. It only loosens to "burned on up to
        -- 10% of days" once a real baseline exists. That drift is
        -- intentional, not an accident of the constant.
        WHEN j.rate <= 0.1 AND j.detection_count > 0
             AND COALESCE(j.prev_count, 0) = 0
          THEN 'ignition'
        -- Habitually burning, now sustained-silent.
        WHEN j.rate >= p_dark_rate AND j.detection_count = 0
             AND COALESCE(j.zero_run, 0) >= p_dark_days
          THEN 'went_dark'
        -- Burning materially harder than its own norm.
        WHEN j.detection_count > 0
             AND j.mean_frp > 0
             AND COALESCE(j.max_frp, 0) >= j.mean_frp * p_elevated_mult
          THEN 'elevated'
        ELSE NULL
      END AS event_type
    FROM joined j
  )
  INSERT INTO firms_significant_events (
    facility_type, facility_id, facility_name, country, period, event_type,
    observed_count, observed_max_frp, baseline_days, baseline_rate,
    baseline_mean_frp, deviation, dark_days
  )
  SELECT facility_type, facility_id, facility_name, country, p_day, event_type,
         detection_count, max_frp, n_days, rate, mean_frp,
         CASE event_type
           WHEN 'elevated'  THEN CASE WHEN mean_frp > 0
                                      THEN COALESCE(max_frp,0) / mean_frp END
           WHEN 'ignition'  THEN detection_count::numeric
           WHEN 'went_dark' THEN rate
         END,
         CASE WHEN event_type = 'went_dark' THEN zero_run END
    FROM classified
   WHERE event_type IS NOT NULL
  ON CONFLICT (facility_type, facility_id, period, event_type) DO UPDATE
    SET observed_count    = EXCLUDED.observed_count,
        observed_max_frp  = EXCLUDED.observed_max_frp,
        -- baseline_days must be refreshed too. Re-running with a
        -- different p_baseline_days otherwise leaves a row whose
        -- stated baseline no longer matches the rate/mean computed
        -- from it — a claim citing evidence it wasn't derived from.
        baseline_days     = EXCLUDED.baseline_days,
        baseline_rate     = EXCLUDED.baseline_rate,
        baseline_mean_frp = EXCLUDED.baseline_mean_frp,
        deviation         = EXCLUDED.deviation,
        dark_days         = EXCLUDED.dark_days;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$ LANGUAGE plpgsql;

-- ─── 4 · RLS + grants ──────────────────────────────────────────
ALTER TABLE firms_significant_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON FUNCTION firms_detect_significant_events(date, int, int, numeric, numeric, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION firms_detect_significant_events(date, int, int, numeric, numeric, int) TO service_role;
