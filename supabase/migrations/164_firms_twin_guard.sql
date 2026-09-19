-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 164 · FIRMS twin guard (Reality Check programme, PR-12)
--
-- PURPOSE. One VIIRS overpass can be stored twice: a preliminary record,
-- then a same-pixel record filed 2–3 h later with a very different fire
-- power. Both rows are kept; the earlier-filed one is linked to the
-- later-filed one through a new twin_of column, and everything that
-- aggregates FRP (the facility rollup, and through it the significance
-- detector) reads the pair ONCE, at the later-filed record.
--
-- MEASURED READ-ONLY IN PRODUCTION, 2026-09-18 (supabase-ro):
--   · Sweeny Refinery (way:528529366), 2026-09-05, VIIRS_NOAA20_NRT:
--       078bc27e… 07:33  4,475.89 MW  filed 07:38   ← preliminary
--       9b852901… 07:31      2.02 MW  filed 10:43   ← later-filed
--     55 m apart, brightness 308.31 K / bright_ti5 290.17 K on both.
--     The rollup read max_frp 4,475.89 and firms_significant_events holds
--     an 'elevated' row for it (deviation 1,673× a 2.675 MW baseline).
--   · 14 VIIRS night records >= 1,000 MW since 2026-08-18: 12 are the
--     preliminary half of such a pair (twins 0.72–3.27 MW, filed ~2–3 h
--     later) at five North American sites (Alberta, Regina, Texas City,
--     Norco, Sweeny); the other 2 are the 2026-08-25 north-Texas wildfire
--     pixel (33.03 N, 98.27 W), twins by the rule but agreeing at
--     1,016.87 MW, whose later-filed record keeps that full FRP.
--   · Under the rule below the table holds 19,502 twin pairs (VIIRS only,
--     2026-07-19 → 09-18). Every twin record has exactly ONE twin — no
--     chains, no triples. All but 2 pairs are in the Americas; those 2
--     (Asaluyeh, Iran, I-4 saturated at 367 K) were filed in the same
--     ingest batch. From 09-10 to 09-18: 3,638 pairs with differing FRP,
--     none outside the Americas; 620 exact duplicates (same position, same
--     FRP, one minute apart) from 09-10 to 09-16. (The build prompt's
--     3,331 / 696 were read earlier; raw non-proximate rows are pruned
--     after 3 days, so counts over a past window shrink over time.)
--   · 6,326 facility-days (1,997 refinery, 4,329 power-plant) have a
--     superseded record inside their 5 km radius. The rollup's
--     detection_count reproduces exactly from raw rows on every one of
--     them (raw history is intact), and 2 of them — Cedar Bayou 4 power
--     station on 08-23 and 09-07 — hold ONLY a superseded record: its
--     later-filed twin sits just outside the 5 km radius.
--
-- ─── THE RULE (tight — never a magnitude cap) ─────────────────────
-- Two records are twins when ALL hold:
--   same satellite · same acq_date · acq_time within 2 minutes (acq_time
--   is 'HHMM' text: parsed to minutes of day, so 0759 and 0801 are two
--   minutes apart, not 42) · <= 100 m apart on the spheroid · identical
--   brightness (the I-4 column — there is no bright_ti4) · identical
--   bright_ti5.
-- FRP is never an input. A pixel is never dropped, capped or preferred
-- for being large; the rule picks by filing order only.
--
-- CANONICAL RECORD. Of a twin pair, the one filed LATER is canonical;
-- the earlier one is superseded and carries twin_of = the later one.
--   "Filed" = ingested_at: the ingest upsert never sends ingested_at, so
--   it keeps its first-insert value when FIRMS re-publishes a row.
--   Ties (same ingest batch — 2 of 19,502 pairs) break on the later
--   acq_time, then on the larger id — deterministic, and blind to FRP.
--   In general twin_of points at the LATEST-filed record that is a twin
--   of the row; twin_of IS NOT NULL ⇔ superseded.
-- MODIS is not linked: it has no I-5 band (bright_ti5 is NULL on all
--   13,110 MODIS rows), and an absent value is not an identical one.
--   42 MODIS pairs would match on brightness alone; left for a decision.
--
-- ─── WHERE LINKING RUNS: inside the rollup, before it reads ────────
-- firms_derive_facility_observations(p_day) now calls
-- firms_link_twins(p_day, p_day) as its first step. The ingest route
-- calls the derive for every day it touched right after upserting, so a
-- day is always linked in the same transaction, immediately before the
-- only aggregator reads it — there is no window in which the rollup can
-- read an unlinked day. Measured read-only: 0.18 s on the busiest day
-- held (2026-09-15, 32,042 rows), well inside PostgREST's 8 s budget.
-- Rejected:
--   · a row trigger — it would fire inside the ingest's 500-row
--     PostgREST upsert and have to UPDATE the other member of the pair,
--     often a row written by the same statement: an ON CONFLICT upsert
--     that trips "tuple already modified by an operation triggered by
--     the current command" fails the whole chunk and LOSES detections
--     to protect a derived reading. The ingest is left untouched.
--   · a pg_cron step alone — asynchronous, so the hourly rollup could
--     read a day between arrival and linking.
-- Linking is a full, idempotent recompute per day: a guarded UPDATE
-- touches only rows whose link changes, and clears links that no
-- longer hold (e.g. a re-published row whose brightness changed).
--
-- ─── THE ROLLUP APPLIES THE RULE TOO (answer to the build prompt) ──
-- Yes: firms_derive_facility_observations.max_frp, detection_count and
-- nearest_km are computed over canonical records only, and a new
-- twins_excluded column records how many superseded records inside the
-- radius were left out, so the exclusion is auditable per row.
-- Why here: firms_detect_significant_events does not read raw FIRMS
-- rows — it reads this rollup, for today's max_frp AND for the baseline
-- mean it compares against. Fixing significance alone would need a
-- second spatial aggregation of raw rows, and every other rollup reader
-- (the resolvers, query_thermal_anomalies, proximity alerts, the
-- Reality Check heat strip) would keep reading the preliminary FRP.
-- Consequences, stated plainly:
--   · The heat rate (days with >= 1 detection) is unchanged, except on
--     the 2 Cedar Bayou 4 facility-days above, which now read 0: the
--     pixel's later-filed geolocation is outside the radius.
--   · detection_count falls by the twins excluded; max_frp is the
--     later-filed FRP (Sweeny 09-05: 4,475.89 → 2.02; Coop Regina 08-21:
--     3,542.06 → 14.52; Norco / St. Charles 08-25: 2,070.95 → 6.83;
--     Green Power 2, Texas City, 08-24: 5,804.99 → 2.61).
--
-- ─── SIGNIFICANCE: one classifier, and retraction ─────────────────
-- The classification body of mig 085 moves VERBATIM into
-- firms_significance_judge_day(); firms_detect_significant_events keeps
-- its exact signature, defaults and return value (rows upserted) and
-- now calls it. Two additions, both scoped to twins:
--   1 · RETRACTION. An event on p_day at a facility whose rollup row
--       has twins_excluded > 0, which the corrected inputs no longer
--       support, is deleted — and copied first into
--       firms_significant_event_retractions with the reason, so nothing
--       disappears without a trace. Needed because the preliminary
--       record can be judged before its twin arrives (a late-evening
--       pass filed ~3 h later lands after the 00:48 judgement), and
--       because the upsert alone never removes a row.
--   2 · p_insert = false (backfill only): re-judge WITHOUT inserting.
--       Existing events at twin-touched facilities are refreshed to the
--       corrected figures and stale ones retracted; no backdated event is
--       ever created for a past day.
--
-- ─── HISTORY: a pg_cron backfill, not an inline replay ────────────
-- The server's statement_timeout is 120 s (configuration file; pg_cron
-- runs under it too). Re-reading one past day costs ~5 s (link 0.1 s +
-- rollup correction 0.5–2 s + judgement 2.7 s) and 64 days are held, so
-- the replay cannot run inside this file. It runs as the
-- 'firms-twin-backfill' job: every minute, oldest day first, up to a
-- 45 s budget per run, one run record per day in
-- firms_twin_backfill_days; the job unschedules itself when no day is
-- left (expect ~10 minutes). The rollup correction is UPDATE-only — it
-- never inserts a row, so it can never claim a facility was watched on a
-- day it was not — and it refuses any row whose raw detections no
-- longer reproduce the stored count (reported as obs_skipped).
-- Linking itself (all held days, ~3–10 s) runs inline in STEP 2.
--
-- ORDER WITH 166 (PR-3): APPLY 164 FIRST, THEN 166. 166 changes the same
-- rollup function (the power branch of its `monitored` CTE). It does not
-- carry a copy of any body: it reads the LIVE definition, inserts its
-- predicate once, and proves the result is the old body plus that
-- insertion. md5(pg_proc.prosrc) of the bodies this file installs:
--   firms_derive_facility_observations  62b04fa280ef9a63e95ffea3b4618f04
--   firms_detect_significant_events     52ddb05ffac2f9c265381b7ee83dfab5
-- 166 on top of 164 gives the derive md5 c4296bdc42502ae41f1e364476784099
-- (reproduced by applying 166's insertion to the body above). If 166 is
-- applied FIRST, §0 below refuses to run: a CREATE OR REPLACE here would
-- silently drop 166's predicate. After 166 lands on 164, re-running this
-- file also stops at §0, by design, and VERIFY row 14 reads false.
--
-- NOT CHANGED HERE (listed in the PR): raw-row readers that count
-- detections themselves — /api/firms (globe), cascade_node_sensor_status,
-- compute-regime-shifts, the analyst tool's raw-row path — and Thermal
-- anomaly_flags already emitted for events this retracts.
--
-- Idempotent: safe to re-run whole (until 166 is applied on top — see
-- ORDER WITH 166 above). Apply MANUALLY in the Supabase SQL
-- Editor BEFORE merge — the WHOLE file, not a highlighted selection —
-- then paste back the VERIFY rows at the bottom.
-- ═══════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════
-- STEP 1 — SCHEMA AND FUNCTIONS (short transaction: the ALTERs hold an
-- exclusive lock on two tables the hourly ingest writes, so the heavy
-- linking pass runs in STEP 2, after this commits).
-- ═══════════════════════════════════════════════════════════════
BEGIN;

-- ─── 0 · Refuse to overwrite a body this file was not written against ─
-- Two functions are replaced below. Each must still be mig 085's body
-- (md5(prosrc) read in production 2026-09-18) or this file's own (a
-- re-run). Anything else means another migration replaced it after 085
-- — most likely 166 (PR-3) applied out of order (the planned order is
-- 164, then 166). Stop and rebase; never force: a silent CREATE OR
-- REPLACE here would undo that change.
DO $guard$
DECLARE
  v_derive text;
  v_detect text;
BEGIN
  SELECT md5(p.prosrc) INTO v_derive FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.firms_derive_facility_observations(date, numeric, numeric, jsonb)');
  SELECT md5(p.prosrc) INTO v_detect FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.firms_detect_significant_events(date, integer, integer, numeric, numeric, integer)');

  IF v_derive IS NULL OR v_detect IS NULL THEN
    RAISE EXCEPTION '164: firms_derive_facility_observations or firms_detect_significant_events not found — this file targets the mig 085 functions';
  END IF;
  IF v_derive NOT IN ('d3de0425a39ec36875e76106a47f85f5',     -- mig 085
                      '62b04fa280ef9a63e95ffea3b4618f04') THEN                -- this file (re-run)
    RAISE EXCEPTION '164: firms_derive_facility_observations body has changed since mig 085 (md5 %). Another migration (likely 166, PR-3) replaced it. Rebase 164 onto the live body; do not force.', v_derive;
  END IF;
  IF v_detect NOT IN ('03d071b9f728d3b31b0fa8ddcf3169f1',     -- mig 085
                      '52ddb05ffac2f9c265381b7ee83dfab5') THEN                -- this file (re-run)
    RAISE EXCEPTION '164: firms_detect_significant_events body has changed since mig 085 (md5 %). Rebase 164 onto the live body; do not force.', v_detect;
  END IF;
END
$guard$;

-- ─── 1 · The link ──────────────────────────────────────────────
ALTER TABLE public.firms_thermal_anomalies
  ADD COLUMN IF NOT EXISTS twin_of uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.firms_thermal_anomalies'::regclass
                    AND conname  = 'firms_anom_twin_of_fkey') THEN
    -- ON DELETE SET NULL: a canonical record is only ever pruned without
    -- its twin when it lies > 8 km from every monitored facility (the
    -- raw tier), which puts the superseded twin outside every 5 km
    -- radius — so un-linking it can never change a rollup.
    ALTER TABLE public.firms_thermal_anomalies
      ADD CONSTRAINT firms_anom_twin_of_fkey
      FOREIGN KEY (twin_of) REFERENCES public.firms_thermal_anomalies(id)
      ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.firms_thermal_anomalies'::regclass
                    AND conname  = 'firms_anom_twin_not_self') THEN
    ALTER TABLE public.firms_thermal_anomalies
      ADD CONSTRAINT firms_anom_twin_not_self CHECK (twin_of <> id);
  END IF;
END $$;

-- Serves the FK's delete-time lookup (the prune deletes thousands of
-- rows an hour) and every "superseded" read.
CREATE INDEX IF NOT EXISTS firms_anom_twin_of_idx
  ON public.firms_thermal_anomalies (twin_of)
  WHERE twin_of IS NOT NULL;

COMMENT ON COLUMN public.firms_thermal_anomalies.twin_of IS
  'Set on a SUPERSEDED record: the id of the later-filed record of the same VIIRS pixel (mig 164 rule: same satellite and acq_date, acq_time within 2 min, <= 100 m, identical brightness (I-4) and bright_ti5). NULL = canonical. Both rows are kept; every FRP aggregate reads canonical rows only. FRP is never an input to the rule.';

-- ─── 2 · The rollup records what it left out ───────────────────
ALTER TABLE public.firms_facility_observations
  ADD COLUMN IF NOT EXISTS twins_excluded int NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.firms_facility_observations'::regclass
                    AND conname  = 'firms_facobs_twins_excluded_nonneg') THEN
    ALTER TABLE public.firms_facility_observations
      ADD CONSTRAINT firms_facobs_twins_excluded_nonneg CHECK (twins_excluded >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS firms_facobs_twins_idx
  ON public.firms_facility_observations (period)
  WHERE twins_excluded > 0;

COMMENT ON COLUMN public.firms_facility_observations.twins_excluded IS
  'Superseded FIRMS records (twin_of IS NOT NULL) inside radius_km on this day, left out of detection_count, max_frp and nearest_km — which read canonical (later-filed) records only. See mig 164.';

-- ─── 3 · Run records for the historical backfill ───────────────
CREATE TABLE IF NOT EXISTS public.firms_twin_backfill_days (
  day               date PRIMARY KEY,
  queued_at         timestamptz NOT NULL DEFAULT now(),
  attempts          int NOT NULL DEFAULT 0,
  done_at           timestamptz,
  links_changed     int,
  obs_updated       int,
  obs_skipped       int,      -- raw rows no longer reproduce the stored row: left untouched
  events_refreshed  int,
  events_retracted  int,
  duration_ms       int,
  last_error        text
);
ALTER TABLE public.firms_twin_backfill_days ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.firms_twin_backfill_days IS
  'One row per historical day re-read by the mig 164 twin backfill (pg_cron job firms-twin-backfill): links changed, rollup rows corrected or refused, events refreshed or retracted. done_at NULL with attempts >= 3 = failed, see last_error. Service-role only.';

-- ─── 4 · Retraction log — a deleted event leaves a record ──────
CREATE TABLE IF NOT EXISTS public.firms_significant_event_retractions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       uuid NOT NULL,          -- the deleted firms_significant_events.id
  facility_type  text NOT NULL,
  facility_id    text NOT NULL,
  period         date NOT NULL,
  event_type     text NOT NULL,
  event          jsonb NOT NULL,         -- the whole row as it stood
  reason         text NOT NULL,
  retracted_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS firms_sig_retr_period_idx
  ON public.firms_significant_event_retractions (period DESC);
ALTER TABLE public.firms_significant_event_retractions ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.firms_significant_event_retractions IS
  'FIRMS significance events deleted because corrected inputs no longer support them (mig 164: a superseded preliminary record had inflated the facility-day). The full row is kept in event. Service-role only.';

-- ─── 5 · acq_time parser ───────────────────────────────────────
-- 'HHMM' (or unpadded 'HMM'/'MM') → minutes of day. NULL for anything
-- that is not a valid time, and a NULL never twins.
CREATE OR REPLACE FUNCTION public.firms_acq_minutes(p_acq_time text)
RETURNS int
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
           WHEN p_acq_time ~ '^[0-9]{1,4}$' THEN
             CASE
               WHEN lpad(p_acq_time, 4, '0')::int / 100 < 24
                AND lpad(p_acq_time, 4, '0')::int % 100 < 60
               THEN (lpad(p_acq_time, 4, '0')::int / 100) * 60
                    + lpad(p_acq_time, 4, '0')::int % 100
             END
         END
$$;

COMMENT ON FUNCTION public.firms_acq_minutes(text) IS
  'FIRMS acq_time (HHMM text) → minutes of day; NULL when not a valid time. 0759 and 0801 are 479 and 481 — two minutes apart. See mig 164.';

-- ─── 6 · The linker ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.firms_link_twins(
  p_from date,
  p_to   date DEFAULT NULL
) RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  v_to   date := COALESCE(p_to, p_from);
  v_rows int;
BEGIN
  IF p_from IS NULL THEN
    RAISE EXCEPTION 'firms_link_twins: p_from is required';
  END IF;
  IF v_to < p_from THEN
    RAISE EXCEPTION 'firms_link_twins: p_to (%) is before p_from (%)', v_to, p_from;
  END IF;

  WITH cand AS (
    -- tmin is NULL for an unparseable acq_time, and a NULL never passes
    -- the 2-minute test below, so such a row never twins. geom stays
    -- geometry here: casting every row of a 30k-row day to geography
    -- costs ~0.8 s, casting only the candidate pairs costs nothing
    -- (measured on 2026-09-15: 0.18 s for the whole statement).
    SELECT f.id, f.satellite, f.acq_date, f.brightness, f.bright_ti5,
           f.ingested_at,
           public.firms_acq_minutes(f.acq_time) AS tmin,
           f.geom
      FROM public.firms_thermal_anomalies f
     WHERE f.acq_date BETWEEN p_from AND v_to
       AND f.brightness IS NOT NULL
       AND f.bright_ti5 IS NOT NULL          -- VIIRS only: MODIS has no I-5
       AND f.geom IS NOT NULL
  ),
  later AS (
    -- For each record, the latest-filed record that is its twin under
    -- the rule. "Later" is a strict total order — (ingested_at, acq
    -- minute, id; uuid order is byte order, so no collation is
    -- involved) — so every pair has exactly one earlier member and no
    -- cycle is possible. FRP appears nowhere in this CTE.
    SELECT DISTINCT ON (a.id)
           a.id,
           b.id AS twin_of
      FROM cand a
      JOIN cand b
        ON b.satellite  = a.satellite
       AND b.acq_date   = a.acq_date
       AND b.brightness = a.brightness
       AND b.bright_ti5 = a.bright_ti5
       AND b.id <> a.id
       AND abs(b.tmin - a.tmin) <= 2
       AND ST_DWithin(a.geom::geography, b.geom::geography, 100)
       AND (b.ingested_at, b.tmin, b.id) > (a.ingested_at, a.tmin, a.id)
     ORDER BY a.id, b.ingested_at DESC, b.tmin DESC, b.id DESC
  ),
  target AS (
    -- Every row in the range that is linked now or should be: a full
    -- recompute, so a link that no longer holds is cleared.
    SELECT f.id, l.twin_of AS new_twin_of
      FROM public.firms_thermal_anomalies f
      LEFT JOIN later l ON l.id = f.id
     WHERE f.acq_date BETWEEN p_from AND v_to
       AND (l.id IS NOT NULL OR f.twin_of IS NOT NULL)
  )
  UPDATE public.firms_thermal_anomalies f
     SET twin_of = t.new_twin_of
    FROM target t
   WHERE f.id = t.id
     AND f.twin_of IS DISTINCT FROM t.new_twin_of;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

COMMENT ON FUNCTION public.firms_link_twins(date, date) IS
  'Recomputes FIRMS twin links for acq_date in [p_from, p_to]: the earlier-filed record of a twin pair gets twin_of = the later-filed one. Idempotent (returns rows changed; 0 on a re-run). Called by firms_derive_facility_observations before every rollup. See mig 164.';

-- ─── 7 · Rollup — canonical records only ───────────────────────
-- Same signature, defaults, region gate, coverage semantics and return
-- value as the live definition (mig 085, re-read from production
-- 2026-09-18). Changes: link p_day first; aggregate canonical rows
-- only; write twins_excluded.
CREATE OR REPLACE FUNCTION public.firms_derive_facility_observations(
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

  -- 164 · Link this day's twins BEFORE reading it, in the same
  -- transaction, so the rollup can never read an unlinked day.
  PERFORM public.firms_link_twins(p_day, p_day);

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
    SELECT f.id, f.frp, f.geom,
           (f.twin_of IS NOT NULL) AS superseded
      FROM firms_thermal_anomalies f
     WHERE f.acq_date = p_day
       AND f.geom IS NOT NULL
  ),
  hits AS (
    -- 164 · A twin pair counts ONCE, at its later-filed record: the
    -- superseded half is counted in twins_excluded and nowhere else.
    SELECT c.facility_type,
           c.facility_id,
           COUNT(*) FILTER (WHERE NOT d.superseded)                          AS detection_count,
           MAX(d.frp) FILTER (WHERE NOT d.superseded)                        AS max_frp,
           MIN(ST_Distance(c.geom::geography, d.geom::geography))
             FILTER (WHERE NOT d.superseded) / 1000.0                        AS nearest_km,
           COUNT(*) FILTER (WHERE d.superseded)                              AS twins_excluded
      FROM day_detections d
      JOIN covered c
        ON ST_DWithin(c.geom::geography, d.geom::geography, p_radius_km * 1000)
     GROUP BY 1, 2
  )
  INSERT INTO firms_facility_observations (
    facility_type, facility_id, facility_name, country,
    period, detection_count, max_frp, nearest_km, radius_km, computed_at,
    twins_excluded
  )
  SELECT c.facility_type, c.facility_id, c.facility_name, c.country,
         p_day,
         COALESCE(h.detection_count, 0),
         h.max_frp, h.nearest_km, p_radius_km, now(),
         COALESCE(h.twins_excluded, 0)
    FROM covered c
    LEFT JOIN hits h
      ON h.facility_type = c.facility_type
     AND h.facility_id   = c.facility_id
  ON CONFLICT (facility_type, facility_id, period) DO UPDATE
    SET detection_count = EXCLUDED.detection_count,
        max_frp         = EXCLUDED.max_frp,
        nearest_km      = EXCLUDED.nearest_km,
        radius_km       = EXCLUDED.radius_km,
        twins_excluded  = EXCLUDED.twins_excluded,
        computed_at     = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$ LANGUAGE plpgsql;

-- ─── 8 · Historical rollup correction (UPDATE-only) ────────────
-- The derive's own aggregation, applied to the rows that ALREADY exist
-- for p_day at their stored radius. It never inserts (a past day's row
-- set is its coverage record) and it refuses a row whose raw detections
-- no longer reproduce it: all_n must equal detection_count +
-- twins_excluded, i.e. exactly the detections the row was built from.
CREATE OR REPLACE FUNCTION public.firms_twin_correct_observations(p_day date)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated int;
  v_skipped int;
BEGIN
  IF p_day IS NULL THEN
    RAISE EXCEPTION 'firms_twin_correct_observations: p_day is required';
  END IF;

  WITH stored AS (
    SELECT o.facility_type, o.facility_id, o.radius_km,
           o.detection_count, o.twins_excluded
      FROM public.firms_facility_observations o
     WHERE o.period = p_day
  ),
  located AS (
    SELECT s.*, r.geom
      FROM stored s
      JOIN public.refineries r
        ON s.facility_type = 'refinery' AND r.id::text = s.facility_id
     WHERE r.geom IS NOT NULL
    UNION ALL
    SELECT s.*, p.geom
      FROM stored s
      JOIN public.power_plants p
        ON s.facility_type = 'power_plant' AND p.id::text = s.facility_id
     WHERE p.geom IS NOT NULL
  ),
  day_detections AS (
    SELECT f.frp, f.geom, (f.twin_of IS NOT NULL) AS superseded
      FROM public.firms_thermal_anomalies f
     WHERE f.acq_date = p_day
       AND f.geom IS NOT NULL
  ),
  hits AS (
    SELECT l.facility_type, l.facility_id,
           COUNT(*)                                                          AS all_n,
           COUNT(*) FILTER (WHERE NOT d.superseded)                          AS n,
           MAX(d.frp) FILTER (WHERE NOT d.superseded)                        AS mx,
           MIN(ST_Distance(l.geom::geography, d.geom::geography))
             FILTER (WHERE NOT d.superseded) / 1000.0                        AS near,
           COUNT(*) FILTER (WHERE d.superseded)                              AS tw
      FROM day_detections d
      JOIN located l
        ON ST_DWithin(l.geom::geography, d.geom::geography, l.radius_km * 1000)
     GROUP BY 1, 2
  ),
  judged AS (
    SELECT h.*,
           (h.all_n = s.detection_count + s.twins_excluded) AS intact
      FROM hits h
      JOIN stored s
        ON s.facility_type = h.facility_type
       AND s.facility_id   = h.facility_id
     WHERE h.tw > 0 OR s.twins_excluded > 0
  ),
  upd AS (
    UPDATE public.firms_facility_observations o
       SET detection_count = j.n,
           max_frp         = j.mx,
           nearest_km      = j.near,
           twins_excluded  = j.tw,
           computed_at     = now()
      FROM judged j
     WHERE o.period        = p_day
       AND o.facility_type = j.facility_type
       AND o.facility_id   = j.facility_id
       AND j.intact
       AND (o.detection_count, o.max_frp, o.nearest_km, o.twins_excluded)
           IS DISTINCT FROM (j.n::int, j.mx, j.near::numeric, j.tw::int)
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM upd),
         (SELECT count(*) FROM judged WHERE NOT intact)
    INTO v_updated, v_skipped;

  RETURN jsonb_build_object('day', p_day, 'updated', v_updated, 'skipped_not_intact', v_skipped);
END;
$$;

COMMENT ON FUNCTION public.firms_twin_correct_observations(date) IS
  'Re-reads EXISTING firms_facility_observations rows for p_day through the twin rule (canonical records only, twins_excluded recorded). UPDATE-only; refuses rows whose raw detections no longer reproduce them. Used by the mig 164 backfill.';

-- ─── 9 · Significance — the one classifier ─────────────────────
-- today … classified are mig 085's CTEs VERBATIM (re-read from
-- production 2026-09-18). New: twin_touched, the p_insert gate on the
-- upsert, and the logged retraction.
CREATE OR REPLACE FUNCTION public.firms_significance_judge_day(
  p_day            date,
  p_baseline_days  int,
  p_min_baseline   int,
  p_elevated_mult  numeric,
  p_dark_rate      numeric,
  p_dark_days      int,
  p_insert         boolean
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_upserted  int;
  v_retracted int;
BEGIN
  IF p_day IS NULL OR p_insert IS NULL THEN
    RAISE EXCEPTION 'firms_significance_judge_day: p_day and p_insert are required';
  END IF;

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
  ),
  -- 164 · Facilities whose inputs the twin guard changed: a superseded
  -- record was excluded on p_day (touched_today) or inside the baseline
  -- window read above.
  twin_touched AS (
    SELECT o.facility_type, o.facility_id,
           bool_or(o.period = p_day) AS touched_today
      FROM firms_facility_observations o
     WHERE o.twins_excluded > 0
       AND o.period <= p_day
       AND o.period >= p_day - p_baseline_days
     GROUP BY 1, 2
  ),
  upserted AS (
    INSERT INTO firms_significant_events (
      facility_type, facility_id, facility_name, country, period, event_type,
      observed_count, observed_max_frp, baseline_days, baseline_rate,
      baseline_mean_frp, deviation, dark_days
    )
    SELECT c.facility_type, c.facility_id, c.facility_name, c.country, p_day, c.event_type,
           c.detection_count, c.max_frp, c.n_days, c.rate, c.mean_frp,
           CASE c.event_type
             WHEN 'elevated'  THEN CASE WHEN c.mean_frp > 0
                                        THEN COALESCE(c.max_frp,0) / c.mean_frp END
             WHEN 'ignition'  THEN c.detection_count::numeric
             WHEN 'went_dark' THEN c.rate
           END,
           CASE WHEN c.event_type = 'went_dark' THEN c.zero_run END
      FROM classified c
     WHERE c.event_type IS NOT NULL
       -- p_insert = true: the hourly path, unchanged. false: the backfill
       -- only re-reads events that already exist at twin-touched
       -- facilities — it never creates a backdated event.
       AND (p_insert
            OR (EXISTS (SELECT 1 FROM twin_touched t
                         WHERE t.facility_type = c.facility_type
                           AND t.facility_id   = c.facility_id)
                AND EXISTS (SELECT 1 FROM firms_significant_events e
                             WHERE e.facility_type = c.facility_type
                               AND e.facility_id   = c.facility_id
                               AND e.period        = p_day
                               AND e.event_type    = c.event_type)))
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
          dark_days         = EXCLUDED.dark_days
      -- Hourly path: every classified row, exactly as before. Backfill:
      -- only rows whose figures actually change are written and counted.
      WHERE p_insert
         OR (firms_significant_events.observed_count, firms_significant_events.observed_max_frp,
             firms_significant_events.baseline_days, firms_significant_events.baseline_rate,
             firms_significant_events.baseline_mean_frp, firms_significant_events.deviation,
             firms_significant_events.dark_days)
            IS DISTINCT FROM
            (EXCLUDED.observed_count, EXCLUDED.observed_max_frp, EXCLUDED.baseline_days,
             EXCLUDED.baseline_rate, EXCLUDED.baseline_mean_frp, EXCLUDED.deviation,
             EXCLUDED.dark_days)
    RETURNING 1
  ),
  -- 164 · RETRACTION. An event on p_day at a facility-day that had a
  -- superseded record excluded, which the corrected inputs no longer
  -- classify as that event type. Disjoint from the rows upserted above
  -- (those ARE classified with their type), so no row is touched twice.
  retracted AS (
    DELETE FROM firms_significant_events e
     USING twin_touched t
     WHERE e.period        = p_day
       AND t.facility_type = e.facility_type
       AND t.facility_id   = e.facility_id
       AND t.touched_today
       AND NOT EXISTS (SELECT 1 FROM classified c
                        WHERE c.facility_type = e.facility_type
                          AND c.facility_id   = e.facility_id
                          AND c.event_type    = e.event_type)
    RETURNING e.*
  ),
  logged AS (
    INSERT INTO firms_significant_event_retractions (
      event_id, facility_type, facility_id, period, event_type, event, reason
    )
    SELECT r.id, r.facility_type, r.facility_id, r.period, r.event_type,
           to_jsonb(r),
           'twin_guard (mig 164): the facility-day re-read at its later-filed FIRMS records no longer supports this event — a superseded preliminary record had inflated its inputs'
      FROM retracted r
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM upserted),
         (SELECT count(*) FROM logged)
    INTO v_upserted, v_retracted;

  RETURN jsonb_build_object('day', p_day, 'upserted', v_upserted, 'retracted', v_retracted);
END;
$$;

COMMENT ON FUNCTION public.firms_significance_judge_day(date, int, int, numeric, numeric, int, boolean) IS
  'The single FIRMS significance classifier (mig 085 CTEs verbatim) plus the mig 164 twin retraction (logged in firms_significant_event_retractions). p_insert = true is the hourly path via firms_detect_significant_events; false re-reads existing events at twin-touched facilities without creating any.';

-- The public entry point: signature, defaults and return value
-- (classified rows upserted) exactly as the route has always called it.
CREATE OR REPLACE FUNCTION public.firms_detect_significant_events(
  p_day            date,
  p_baseline_days  int     DEFAULT 30,
  p_min_baseline   int     DEFAULT 7,    -- min covered days to judge
  p_elevated_mult  numeric DEFAULT 3.0,  -- FRP multiple over baseline
  p_dark_rate      numeric DEFAULT 0.6,  -- "habitually burning" floor
  p_dark_days      int     DEFAULT 3     -- consecutive zero-days
) RETURNS int AS $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.firms_significance_judge_day(
    p_day, p_baseline_days, p_min_baseline, p_elevated_mult,
    p_dark_rate, p_dark_days, true);
  RETURN (v_result->>'upserted')::int;
END;
$$ LANGUAGE plpgsql;

-- ─── 10 · The backfill step (pg_cron) ──────────────────────────
-- Oldest day first, so a day's baseline window is already corrected
-- when it is judged. Time-boxed well under the 120 s statement_timeout;
-- one run record per day; a failing day is retried on later runs up to
-- 3 attempts and then left with its error. The judgement parameters
-- are the route's constants (BASELINE_DAYS 30, MIN_BASELINE 7,
-- ELEVATED_MULT 3.0, DARK_RATE 0.6, DARK_DAYS 3 — unchanged since #290,
-- the only caller).
CREATE OR REPLACE FUNCTION public.firms_twin_backfill_step(p_budget_seconds int DEFAULT 45)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_started     timestamptz := clock_timestamp();
  v_last        date := '-infinity';
  v_day         date;
  v_t0          timestamptz;
  v_links       int;
  v_obs         jsonb;
  v_judge       jsonb;
  v_done        int := 0;
  v_failed      int := 0;
  v_left        int;
  v_unscheduled boolean := false;
BEGIN
  LOOP
    EXIT WHEN clock_timestamp() - v_started > make_interval(secs => GREATEST(p_budget_seconds, 1));

    v_day := NULL;
    SELECT q.day INTO v_day
      FROM public.firms_twin_backfill_days q
     WHERE q.done_at IS NULL
       AND q.attempts < 3
       AND q.day > v_last
     ORDER BY q.day
     LIMIT 1
     FOR UPDATE SKIP LOCKED;
    EXIT WHEN v_day IS NULL;

    v_last := v_day;
    v_t0   := clock_timestamp();
    UPDATE public.firms_twin_backfill_days
       SET attempts = attempts + 1, last_error = NULL
     WHERE day = v_day;

    BEGIN
      v_links := public.firms_link_twins(v_day, v_day);
      v_obs   := public.firms_twin_correct_observations(v_day);
      v_judge := public.firms_significance_judge_day(v_day, 30, 7, 3.0, 0.6, 3, false);

      UPDATE public.firms_twin_backfill_days
         SET done_at          = clock_timestamp(),
             links_changed    = v_links,
             obs_updated      = (v_obs->>'updated')::int,
             obs_skipped      = (v_obs->>'skipped_not_intact')::int,
             events_refreshed = (v_judge->>'upserted')::int,
             events_retracted = (v_judge->>'retracted')::int,
             duration_ms      = (extract(epoch FROM clock_timestamp() - v_t0) * 1000)::int
       WHERE day = v_day;
      v_done := v_done + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.firms_twin_backfill_days
         SET last_error  = left(SQLERRM, 500),
             duration_ms = (extract(epoch FROM clock_timestamp() - v_t0) * 1000)::int
       WHERE day = v_day;
      v_failed := v_failed + 1;
    END;
  END LOOP;

  SELECT count(*) INTO v_left
    FROM public.firms_twin_backfill_days
   WHERE done_at IS NULL AND attempts < 3;

  IF v_left = 0 THEN
    -- Nothing left to do: the job removes itself. A manual call by a
    -- role that does not own the job simply leaves it in place.
    BEGIN
      PERFORM cron.unschedule(j.jobid) FROM cron.job j WHERE j.jobname = 'firms-twin-backfill';
      v_unscheduled := FOUND;
    EXCEPTION WHEN OTHERS THEN
      v_unscheduled := false;
    END;
  END IF;

  RETURN jsonb_build_object(
    'days_done',   v_done,
    'days_failed', v_failed,
    'days_left',   v_left,
    'unscheduled', v_unscheduled,
    'elapsed_ms',  (extract(epoch FROM clock_timestamp() - v_started) * 1000)::int
  );
END;
$$;

COMMENT ON FUNCTION public.firms_twin_backfill_step(int) IS
  'One pg_cron run of the mig 164 historical twin backfill: for each pending day (oldest first, within the time budget) link twins, correct existing rollup rows, re-read existing events without inserting; writes firms_twin_backfill_days; unschedules firms-twin-backfill when no day is left.';

-- ─── 11 · Grants — service role only ───────────────────────────
-- Supabase grants EXECUTE to anon/authenticated by name (mig 139/143
-- lesson), so revoke from each role explicitly. CREATE OR REPLACE keeps
-- an existing ACL; the two replaced functions are restated anyway.
REVOKE EXECUTE ON FUNCTION public.firms_acq_minutes(text)                                              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.firms_link_twins(date, date)                                         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.firms_twin_correct_observations(date)                                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.firms_significance_judge_day(date, int, int, numeric, numeric, int, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.firms_twin_backfill_step(int)                                        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.firms_derive_facility_observations(date, numeric, numeric, jsonb)    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.firms_detect_significant_events(date, int, int, numeric, numeric, int) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.firms_acq_minutes(text)                                              TO service_role;
GRANT EXECUTE ON FUNCTION public.firms_link_twins(date, date)                                         TO service_role;
GRANT EXECUTE ON FUNCTION public.firms_twin_correct_observations(date)                                TO service_role;
GRANT EXECUTE ON FUNCTION public.firms_significance_judge_day(date, int, int, numeric, numeric, int, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.firms_twin_backfill_step(int)                                        TO service_role;
GRANT EXECUTE ON FUNCTION public.firms_derive_facility_observations(date, numeric, numeric, jsonb)    TO service_role;
GRANT EXECUTE ON FUNCTION public.firms_detect_significant_events(date, int, int, numeric, numeric, int) TO service_role;

COMMIT;


-- ═══════════════════════════════════════════════════════════════
-- STEP 2 — LINK EVERY HELD DAY, QUEUE THE BACKFILL, SCHEDULE IT.
-- Measured read-only: the full link pass is ~3 s of reads and writes
-- 19,502 rows. Idempotent: a re-run changes 0 links, queues nothing
-- new, and re-creates the job only to have it find no work and remove
-- itself.
-- ═══════════════════════════════════════════════════════════════
BEGIN;

SELECT public.firms_link_twins(b.first_day, b.last_day) AS links_changed
  FROM (SELECT min(acq_date) AS first_day, max(acq_date) AS last_day
          FROM public.firms_thermal_anomalies) b
 WHERE b.first_day IS NOT NULL;

INSERT INTO public.firms_twin_backfill_days (day)
SELECT DISTINCT o.period
  FROM public.firms_facility_observations o
 WHERE o.period <= CURRENT_DATE
ON CONFLICT (day) DO NOTHING;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'firms-twin-backfill';
SELECT cron.schedule(
  'firms-twin-backfill',
  '* * * * *',
  $job$ SELECT public.firms_twin_backfill_step(45) $job$
);

COMMIT;


-- ═══════════════════════════════════════════════════════════════
-- STEP 3 — VERIFY. Paste these rows back. Expect every ok = true.
-- Expected details (production, 2026-09-18): superseded ≈ 19,502 and
-- MODIS linked 0; Sweeny 078bc27e… → 9b852901… (2.02 MW canonical);
-- wildfire a6265bc0… → e896c33b… (canonical keeps 1016.87); backfill
-- ~64 days queued. The backfill then drains on its own — re-run rows
-- 12–13 after ~10 minutes: pending 0, job gone.
-- ═══════════════════════════════════════════════════════════════
SELECT n, check_name, ok, detail FROM (
  SELECT 1 AS n, 'twin_of column (uuid) on firms_thermal_anomalies' AS check_name,
         EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'firms_thermal_anomalies'
                    AND column_name = 'twin_of' AND data_type = 'uuid') AS ok,
         NULL::text AS detail
  UNION ALL
  SELECT 2, 'twin_of FK (ON DELETE SET NULL) + not-self CHECK',
         (SELECT count(*) FROM pg_constraint
           WHERE conrelid = 'public.firms_thermal_anomalies'::regclass
             AND conname IN ('firms_anom_twin_of_fkey', 'firms_anom_twin_not_self')) = 2,
         (SELECT string_agg(conname || ': ' || pg_get_constraintdef(oid), ' | ' ORDER BY conname)
            FROM pg_constraint
           WHERE conrelid = 'public.firms_thermal_anomalies'::regclass
             AND conname IN ('firms_anom_twin_of_fkey', 'firms_anom_twin_not_self'))
  UNION ALL
  SELECT 3, 'twin_of index',
         EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'firms_anom_twin_of_idx'),
         (SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'firms_anom_twin_of_idx')
  UNION ALL
  SELECT 4, 'twins_excluded column + CHECK + index on firms_facility_observations',
         EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'firms_facility_observations'
                    AND column_name = 'twins_excluded' AND is_nullable = 'NO')
         AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'firms_facobs_twins_excluded_nonneg')
         AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'firms_facobs_twins_idx'),
         NULL
  UNION ALL
  SELECT 5, 'tables firms_twin_backfill_days + firms_significant_event_retractions (RLS on)',
         (SELECT count(*) FROM pg_class
           WHERE oid IN (to_regclass('public.firms_twin_backfill_days'),
                         to_regclass('public.firms_significant_event_retractions'))
             AND relrowsecurity) = 2,
         NULL
  UNION ALL
  SELECT 6, 'functions present (7)',
         (SELECT count(*) FROM (VALUES
            ('public.firms_acq_minutes(text)'),
            ('public.firms_link_twins(date,date)'),
            ('public.firms_twin_correct_observations(date)'),
            ('public.firms_significance_judge_day(date,integer,integer,numeric,numeric,integer,boolean)'),
            ('public.firms_twin_backfill_step(integer)'),
            ('public.firms_derive_facility_observations(date,numeric,numeric,jsonb)'),
            ('public.firms_detect_significant_events(date,integer,integer,numeric,numeric,integer)')) s(sig)
           WHERE to_regprocedure(s.sig) IS NOT NULL) = 7,
         NULL
  UNION ALL
  SELECT 7, 'derive links before reading; detect runs through the judge; no stale 3-arg derive',
         position('firms_link_twins' IN pg_get_functiondef(to_regprocedure('public.firms_derive_facility_observations(date,numeric,numeric,jsonb)'))) > 0
         AND position('firms_significance_judge_day' IN pg_get_functiondef(to_regprocedure('public.firms_detect_significant_events(date,integer,integer,numeric,numeric,integer)'))) > 0
         AND to_regprocedure('public.firms_derive_facility_observations(date,numeric,numeric)') IS NULL,
         NULL
  UNION ALL
  SELECT 8, 'anon / authenticated cannot EXECUTE any of the 7; service_role can',
         NOT EXISTS (
           SELECT 1 FROM (VALUES
              ('public.firms_acq_minutes(text)'),
              ('public.firms_link_twins(date,date)'),
              ('public.firms_twin_correct_observations(date)'),
              ('public.firms_significance_judge_day(date,integer,integer,numeric,numeric,integer,boolean)'),
              ('public.firms_twin_backfill_step(integer)'),
              ('public.firms_derive_facility_observations(date,numeric,numeric,jsonb)'),
              ('public.firms_detect_significant_events(date,integer,integer,numeric,numeric,integer)')) s(sig)
            WHERE to_regprocedure(s.sig) IS NULL
               OR has_function_privilege('anon',          to_regprocedure(s.sig), 'EXECUTE')
               OR has_function_privilege('authenticated', to_regprocedure(s.sig), 'EXECUTE')
               OR NOT has_function_privilege('service_role', to_regprocedure(s.sig), 'EXECUTE')),
         NULL
  UNION ALL
  SELECT 9, 'records linked (superseded) — VIIRS only',
         (SELECT count(*) FROM public.firms_thermal_anomalies WHERE twin_of IS NOT NULL AND satellite = 'MODIS_NRT') = 0,
         (SELECT 'superseded ' || count(*) FILTER (WHERE twin_of IS NOT NULL)
                 || ' of ' || count(*) || ' rows; MODIS linked '
                 || count(*) FILTER (WHERE twin_of IS NOT NULL AND satellite = 'MODIS_NRT')
            FROM public.firms_thermal_anomalies)
  UNION ALL
  SELECT 10, 'Sweeny 2026-09-05: 4,475.89 MW preliminary superseded by the 2.02 MW later-filed record',
         (SELECT twin_of FROM public.firms_thermal_anomalies WHERE id = '078bc27e-ef98-4959-80ae-dfba862f83f0')
           = '9b852901-13dc-4dbb-ad76-7cc9d4679b82'::uuid
         AND (SELECT twin_of IS NULL FROM public.firms_thermal_anomalies WHERE id = '9b852901-13dc-4dbb-ad76-7cc9d4679b82'),
         (SELECT string_agg(acq_time || ' ' || frp || ' MW filed ' || to_char(ingested_at, 'HH24:MI')
                            || CASE WHEN twin_of IS NULL THEN ' canonical' ELSE ' superseded' END, ' · ' ORDER BY ingested_at)
            FROM public.firms_thermal_anomalies
           WHERE id IN ('078bc27e-ef98-4959-80ae-dfba862f83f0', '9b852901-13dc-4dbb-ad76-7cc9d4679b82'))
  UNION ALL
  SELECT 11, '2026-08-25 north-Texas wildfire: twins by the rule, canonical keeps 1016.87 MW',
         (SELECT twin_of FROM public.firms_thermal_anomalies WHERE id = 'a6265bc0-a71f-468d-ac87-4c2a7789301c')
           = 'e896c33b-1dc8-4071-97d0-424b6ec624eb'::uuid
         AND (SELECT twin_of IS NULL AND frp = 1016.87 FROM public.firms_thermal_anomalies
               WHERE id = 'e896c33b-1dc8-4071-97d0-424b6ec624eb'),
         NULL
  UNION ALL
  SELECT 12, 'backfill queue (re-run after ~10 min: pending 0)',
         (SELECT count(*) FROM public.firms_twin_backfill_days) > 0,
         (SELECT 'days ' || count(*) || ' · done ' || count(*) FILTER (WHERE done_at IS NOT NULL)
                 || ' · pending ' || count(*) FILTER (WHERE done_at IS NULL AND attempts < 3)
                 || ' · failed ' || count(*) FILTER (WHERE done_at IS NULL AND attempts >= 3)
                 || ' · obs updated ' || COALESCE(sum(obs_updated), 0)
                 || ' · obs refused ' || COALESCE(sum(obs_skipped), 0)
                 || ' · events refreshed ' || COALESCE(sum(events_refreshed), 0)
                 || ' · events retracted ' || COALESCE(sum(events_retracted), 0)
            FROM public.firms_twin_backfill_days)
  UNION ALL
  SELECT 13, 'backfill job scheduled — or already finished and removed',
         EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'firms-twin-backfill' AND active)
         OR NOT EXISTS (SELECT 1 FROM public.firms_twin_backfill_days WHERE done_at IS NULL AND attempts < 3),
         (SELECT schedule || ' · ' || command FROM cron.job WHERE jobname = 'firms-twin-backfill')
  UNION ALL
  SELECT 14, 'live rollup + detector bodies are this file''s (md5 of prosrc)',
         (SELECT md5(prosrc) FROM pg_proc
           WHERE oid = to_regprocedure('public.firms_derive_facility_observations(date,numeric,numeric,jsonb)'))
           = '62b04fa280ef9a63e95ffea3b4618f04'
         AND (SELECT md5(prosrc) FROM pg_proc
               WHERE oid = to_regprocedure('public.firms_detect_significant_events(date,integer,integer,numeric,numeric,integer)'))
           = '52ddb05ffac2f9c265381b7ee83dfab5',
         NULL
) v
ORDER BY n;
