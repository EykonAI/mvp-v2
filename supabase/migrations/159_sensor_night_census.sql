-- ═══════════════════════════════════════════════════════════════════════
-- eYKON.ai — 159 · Sensor night census + usable-night view
--             (Reality Check programme, PR-1, guard 2 of §3.2)
--
-- PURPOSE
-- A thin or incomplete night must not be able to enter a Reality Check
-- baseline or window. Today nothing records which nights are complete:
-- blackmarble_ingest_runs.ok means "no exception", not "complete", and
-- 2026-07-17 (313 of 431 refineries, 9,281 of 10,125 power units) looks
-- like any other night to a reader of blackmarble_facility_radiance.
-- That night manufactured the Az Zour South artefact.
--
-- This migration records, per (sensor, facility_type, night), how many
-- rows arrived against THAT NIGHT'S ACTUAL ROSTER, and classifies the
-- night. The classifier reads nights only through sensor_usable_nights,
-- so an unusable night is excluded by a JOIN, not by a WHERE a caller
-- can forget.
--
-- THE ROSTER (build prompt §3.2 — "that night's actual roster, not a
-- trailing maximum"):
--   * Black Marble. The worker (services/blackmarble-ingest) samples, at
--     run time, every facility FIRMS observed in the 5 days up to the run
--     (BM_ROSTER_DAYS, default 5). So the roster of night N is the set of
--     distinct facilities in firms_facility_observations over
--     [ran_at::date - 5, ran_at::date], where ran_at is the ingest run
--     that last wrote N (blackmarble_ingest_runs.ran_at). A trailing
--     maximum of past row counts is NOT used: PR-3's roster cut would
--     turn it into weeks of false partial nights.
--     rows_present counts ONLY rows of facilities in that roster. The
--     worker upserts and never deletes, so a night re-fetched across a
--     roster change (PR-3's power cut, a shard outage shrinking the 5-day
--     FIRMS window) still carries rows for sites earlier runs sampled and
--     the last run did not. Counting them would lift a night with a
--     missing tile to >= 0.95 of the smaller roster. They are recorded in
--     rows_outside_roster and never count toward coverage.
--   * FIRMS. firms_derive_facility_observations writes its whole covered
--     roster for a day in ONE INSERT, so a FIRMS day is all-or-nothing at
--     this layer and its roster is the rows it wrote. The ingest re-derives
--     today and yesterday every hour (INGEST_DAYS = 2), so a FIRMS day is
--     usable only once it is final (night <= current_date - 2).
--
-- USABLE = rows_present >= 0.95 x roster_size. 0.90 would admit 07-17
-- (power 9,281 / 10,125 = 0.917; all types 9,594 / 10,556 = 0.909).
--
-- COMPLETENESS never reads blackmarble_ingest_runs.ok. It reads
-- tiles_expected / tiles_processed / tiles_missing and row counts. The
-- worker re-fetches a night while it sits in its rolling window
-- (today-4 .. today-15, BM_LAG_DAYS 4 + BM_RESCAN_DAYS 12); a night still
-- below the floor after night+15 is recorded as PERMANENTLY partial (or
-- permanently empty). Only a manual backfill (BM_BACKFILL_START/END) can
-- change it after that, and the next refresh would then re-classify it.
--
-- Status vocabulary (one per row, CHECK-bound to the numbers):
--   usable              rows >= 0.95 x roster (FIRMS: and final)
--   roster_unrecorded   rows exist but no roster was recorded for the night
--   pending             below the floor, still inside the re-fetch window
--   permanently_partial below the floor after the re-fetch window, rows > 0
--   permanently_empty   zero rows after the re-fetch window
--
-- Expected on 2026-09-18 (Black Marble, refinery): 9 permanently_empty
-- nights (07-11..07-16, 07-26, 08-04, 08-05), 4 permanently_partial
-- (07-10, 07-17, 08-03, 08-06), 09-09 pending at 405/431 = 0.940, and
-- 09-10..09-14 pending empty.
--
-- Heavy SQL never runs over PostgREST (8 s statement_timeout): the refresh
-- is scheduled on pg_cron below, and seeded once when this file is applied.
--
-- Idempotent: CREATE ... IF NOT EXISTS / CREATE OR REPLACE / constraint
-- guards / unschedule-if-exists. No temp tables, no session state.
-- Apply MANUALLY in the Supabase SQL Editor, the whole file, BEFORE merge.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1 · The census ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sensor_night_census (
  sensor          text        NOT NULL,
  facility_type   text        NOT NULL,
  night           date        NOT NULL,
  rows_present    integer     NOT NULL,
  roster_size     integer,
  roster_source   text        NOT NULL,
  -- rows written for the night by facilities NOT in its roster (never counted)
  rows_outside_roster integer,
  coverage_ratio  numeric     GENERATED ALWAYS AS (
                    CASE WHEN roster_size > 0
                         THEN round(rows_present::numeric / roster_size, 6) END) STORED,
  -- Black Marble only: the ingest run's own tile arithmetic for the night.
  tiles_expected  integer,
  tiles_processed integer,
  tiles_missing   integer,
  ingest_ran_at   timestamptz,
  is_final        boolean     NOT NULL,
  usable          boolean     NOT NULL,
  status          text        NOT NULL,
  computed_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sensor, facility_type, night)
);

COMMENT ON TABLE public.sensor_night_census IS
  'Reality Check PR-1 (mig 159). One row per (sensor, facility_type, night): rows that arrived against that night''s actual roster. usable = rows >= 0.95 x roster (FIRMS: and the day is final). Never reads blackmarble_ingest_runs.ok. The classifier reads nights only through sensor_usable_nights. Refreshed by pg_cron job refresh-sensor-night-census.';
-- a table created by an earlier draft of this file gains the column too
ALTER TABLE public.sensor_night_census ADD COLUMN IF NOT EXISTS rows_outside_roster integer;

COMMENT ON COLUMN public.sensor_night_census.rows_present IS
  'Rows for the night that belong to its roster. blackmarble: rows of facilities outside the roster of the ingest run that last wrote the night (left by earlier runs across a roster change) are excluded and counted in rows_outside_roster. When no roster was recorded, every row written for the night.';
COMMENT ON COLUMN public.sensor_night_census.rows_outside_roster IS
  'Rows written for the night by facilities not in its roster — recorded, never counted toward coverage. NULL when no roster was recorded; always 0 for firms (the roster is the rows).';
COMMENT ON COLUMN public.sensor_night_census.roster_size IS
  'That night''s actual roster. blackmarble: distinct facilities FIRMS observed in the 5 days up to the ingest run that last wrote the night (the worker''s own roster rule). firms: the rows the derive wrote (one INSERT per day). NULL = no roster recorded. Never a trailing maximum.';
COMMENT ON COLUMN public.sensor_night_census.is_final IS
  'blackmarble: all tiles processed, or current_date > night + 15 (the worker''s rolling re-fetch window has passed). firms: night <= current_date - 2 (the ingest re-derives today and yesterday).';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'snc_sensor_known') THEN
    ALTER TABLE public.sensor_night_census ADD CONSTRAINT snc_sensor_known
      CHECK (sensor IN ('blackmarble', 'firms'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'snc_facility_type_known') THEN
    ALTER TABLE public.sensor_night_census ADD CONSTRAINT snc_facility_type_known
      CHECK (facility_type IN ('refinery', 'power_plant'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'snc_counts_sane') THEN
    ALTER TABLE public.sensor_night_census ADD CONSTRAINT snc_counts_sane
      CHECK (rows_present >= 0 AND (roster_size IS NULL OR roster_size > 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'snc_outside_roster_sane') THEN
    ALTER TABLE public.sensor_night_census ADD CONSTRAINT snc_outside_roster_sane
      CHECK ((rows_outside_roster IS NULL) = (roster_size IS NULL)
             AND (rows_outside_roster IS NULL OR rows_outside_roster >= 0)
             AND (sensor <> 'firms' OR rows_outside_roster IS NULL OR rows_outside_roster = 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'snc_roster_source_known') THEN
    ALTER TABLE public.sensor_night_census ADD CONSTRAINT snc_roster_source_known
      CHECK (roster_source IN ('ingest_run_firms_window', 'firms_derive_rows', 'unrecorded')
             AND ((roster_source = 'unrecorded') = (roster_size IS NULL)));
  END IF;
  -- THE guard: a night below 0.95 of its roster can never be marked usable.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'snc_usable_needs_roster_floor') THEN
    ALTER TABLE public.sensor_night_census ADD CONSTRAINT snc_usable_needs_roster_floor
      CHECK (NOT usable OR (roster_size IS NOT NULL AND rows_present::numeric >= 0.95 * roster_size));
  END IF;
  -- A FIRMS day still being re-derived is not yet a usable day.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'snc_firms_usable_is_final') THEN
    ALTER TABLE public.sensor_night_census ADD CONSTRAINT snc_firms_usable_is_final
      CHECK (sensor <> 'firms' OR NOT usable OR is_final);
  END IF;
  -- Status is a function of the numbers, never a free label.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'snc_status_follows_numbers') THEN
    ALTER TABLE public.sensor_night_census ADD CONSTRAINT snc_status_follows_numbers
      CHECK (status = CASE
                        WHEN usable                                   THEN 'usable'
                        WHEN roster_size IS NULL AND rows_present > 0 THEN 'roster_unrecorded'
                        WHEN NOT is_final                             THEN 'pending'
                        WHEN rows_present = 0                         THEN 'permanently_empty'
                        ELSE                                               'permanently_partial'
                      END);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'snc_tiles_blackmarble_only') THEN
    ALTER TABLE public.sensor_night_census ADD CONSTRAINT snc_tiles_blackmarble_only
      CHECK (sensor = 'blackmarble'
             OR (tiles_expected IS NULL AND tiles_processed IS NULL
                 AND tiles_missing IS NULL AND ingest_ran_at IS NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS sensor_night_census_usable_idx
  ON public.sensor_night_census (sensor, facility_type, night) WHERE usable;

-- ─── 2 · Run record: a refresh that changes nothing still writes a row ──
CREATE TABLE IF NOT EXISTS public.sensor_night_census_runs (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ran_at              timestamptz NOT NULL DEFAULT now(),
  full_refresh        boolean     NOT NULL,
  blackmarble_nights  integer     NOT NULL,
  blackmarble_rows_recomputed integer NOT NULL,
  firms_rows_changed  integer     NOT NULL,
  duration_ms         integer     NOT NULL
);
COMMENT ON TABLE public.sensor_night_census_runs IS
  'One row per refresh_sensor_night_census() call, even when nothing changed. No row = the job did not run.';

ALTER TABLE public.sensor_night_census      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sensor_night_census_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sensor_night_census      FROM anon, authenticated;
REVOKE ALL ON public.sensor_night_census_runs FROM anon, authenticated;

-- ─── 3 · The refresh ───────────────────────────────────────────────────
-- Black Marble: recomputes nights that are missing, not final, or whose
-- ingest run changed since the census last looked (p_full recomputes all).
-- FIRMS: recomputes every day (one grouped scan, well under a second).
CREATE OR REPLACE FUNCTION public.refresh_sensor_night_census(p_full boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_t0        timestamptz := clock_timestamp();
  v_bm_nights integer := 0;
  v_bm_rows   integer := 0;
  v_fi_rows   integer := 0;
BEGIN
  -- Serialise concurrent refreshes (cron tick overlapping a manual call).
  PERFORM pg_advisory_xact_lock(hashtext('refresh_sensor_night_census'));

  -- ── Black Marble ────────────────────────────────────────────────────
  WITH runs AS (
    SELECT r.night, r.tiles_expected, r.tiles_processed, r.tiles_missing,
           r.facilities_written, r.ran_at
      FROM blackmarble_ingest_runs r
  ),
  cal AS (
    -- every night the worker looked at, plus every night it should have
    -- looked at by now (LAG 4 days), so a dead worker shows as empty
    -- nights rather than as nothing
    SELECT night FROM runs
    UNION
    SELECT gs::date
      FROM generate_series((SELECT min(night) FROM runs), current_date - 4, interval '1 day') AS gs
     WHERE (SELECT min(night) FROM runs) IS NOT NULL
    UNION
    SELECT DISTINCT b.period FROM blackmarble_facility_radiance b
     WHERE b.period > (SELECT coalesce(max(s.night), DATE '1900-01-01')
                         FROM sensor_night_census s WHERE s.sensor = 'blackmarble')
        OR p_full
  ),
  todo AS (
    SELECT c.night, r.tiles_expected, r.tiles_processed, r.tiles_missing,
           r.facilities_written, r.ran_at
      FROM cal c
      LEFT JOIN runs r ON r.night = c.night
     WHERE p_full
        OR NOT EXISTS (
             SELECT 1 FROM sensor_night_census s
              WHERE s.sensor = 'blackmarble' AND s.night = c.night
                AND s.is_final
                AND s.ingest_ran_at IS NOT DISTINCT FROM r.ran_at)
  ),
  run_days AS (
    SELECT DISTINCT (t.ran_at AT TIME ZONE 'UTC')::date AS d FROM todo t WHERE t.ran_at IS NOT NULL
  ),
  roster_members AS (
    -- the worker's own roster rule: FIRMS-observed in the 5 days up to the run
    SELECT DISTINCT rd.d, f.facility_type, f.facility_id
      FROM run_days rd
      JOIN firms_facility_observations f ON f.period BETWEEN rd.d - 5 AND rd.d
  ),
  roster AS (
    SELECT rm.d, rm.facility_type, count(*)::int AS n
      FROM roster_members rm
     GROUP BY 1, 2
  ),
  present AS (
    -- every row written for the night (n_all) and the rows of facilities in
    -- the roster of the run that last wrote it (n_roster). Rows left by
    -- earlier runs for sites the last run no longer samples are not a look
    -- the roster can be measured against.
    SELECT t.night, b.facility_type,
           count(*)::int              AS n_all,
           count(rm.facility_id)::int AS n_roster
      FROM todo t
      JOIN blackmarble_facility_radiance b ON b.period = t.night
      LEFT JOIN roster_members rm
        ON rm.d             = (t.ran_at AT TIME ZONE 'UTC')::date
       AND rm.facility_type = b.facility_type
       AND rm.facility_id   = b.facility_id
     GROUP BY 1, 2
  ),
  types AS (
    SELECT unnest(ARRAY['refinery', 'power_plant']) AS facility_type
  ),
  calc AS (
    SELECT t.night, ty.facility_type,
           -- with a roster: only its members' rows count; without one: every row
           CASE WHEN ro.n IS NOT NULL THEN coalesce(p.n_roster, 0)
                ELSE coalesce(p.n_all, 0) END                            AS rows_present,
           CASE WHEN ro.n IS NOT NULL THEN coalesce(p.n_all - p.n_roster, 0) END AS rows_outside_roster,
           ro.n             AS roster_size,
           t.tiles_expected, t.tiles_processed, t.tiles_missing, t.ran_at,
           (coalesce(t.tiles_expected > 0
                     AND t.tiles_processed = t.tiles_expected
                     AND t.tiles_missing = 0
                     AND t.facilities_written > 0, false)
            OR current_date > t.night + 15) AS is_final
      FROM todo t
     CROSS JOIN types ty
      LEFT JOIN present p ON p.night = t.night AND p.facility_type = ty.facility_type
      LEFT JOIN roster ro ON ro.d = (t.ran_at AT TIME ZONE 'UTC')::date AND ro.facility_type = ty.facility_type
  ),
  cls AS (
    SELECT c.*,
           (c.roster_size IS NOT NULL AND c.rows_present::numeric >= 0.95 * c.roster_size) AS usable
      FROM calc c
  )
  INSERT INTO sensor_night_census AS s (
    sensor, facility_type, night, rows_present, roster_size, roster_source, rows_outside_roster,
    tiles_expected, tiles_processed, tiles_missing, ingest_ran_at,
    is_final, usable, status, computed_at)
  SELECT 'blackmarble', facility_type, night, rows_present, roster_size,
         CASE WHEN roster_size IS NULL THEN 'unrecorded' ELSE 'ingest_run_firms_window' END,
         rows_outside_roster,
         tiles_expected, tiles_processed, tiles_missing, ran_at,
         is_final, usable,
         CASE WHEN usable                                   THEN 'usable'
              WHEN roster_size IS NULL AND rows_present > 0 THEN 'roster_unrecorded'
              WHEN NOT is_final                             THEN 'pending'
              WHEN rows_present = 0                         THEN 'permanently_empty'
              ELSE                                               'permanently_partial' END,
         now()
    FROM cls
  ON CONFLICT (sensor, facility_type, night) DO UPDATE
     SET rows_present    = EXCLUDED.rows_present,
         roster_size     = EXCLUDED.roster_size,
         roster_source   = EXCLUDED.roster_source,
         rows_outside_roster = EXCLUDED.rows_outside_roster,
         tiles_expected  = EXCLUDED.tiles_expected,
         tiles_processed = EXCLUDED.tiles_processed,
         tiles_missing   = EXCLUDED.tiles_missing,
         ingest_ran_at   = EXCLUDED.ingest_ran_at,
         is_final        = EXCLUDED.is_final,
         usable          = EXCLUDED.usable,
         status          = EXCLUDED.status,
         computed_at     = EXCLUDED.computed_at;
  GET DIAGNOSTICS v_bm_rows = ROW_COUNT;
  v_bm_nights := v_bm_rows / 2;

  -- ── FIRMS ───────────────────────────────────────────────────────────
  -- Incremental: a final day is never re-derived by the ingest (it only
  -- touches today and yesterday), so only missing or non-final days are
  -- recomputed. p_full recomputes every day (after a manual re-derive).
  WITH span AS (
    SELECT min(period) AS lo FROM firms_facility_observations
  ),
  cal AS (
    SELECT gs::date AS night
      FROM span, generate_series(span.lo, current_date, interval '1 day') AS gs
     WHERE span.lo IS NOT NULL
  ),
  todo AS (
    SELECT c.night
      FROM cal c
     WHERE p_full
        OR NOT EXISTS (
             SELECT 1 FROM sensor_night_census s
              WHERE s.sensor = 'firms' AND s.night = c.night AND s.is_final)
  ),
  present AS (
    SELECT f.period AS night, f.facility_type, count(*)::int AS n
      FROM firms_facility_observations f
     WHERE f.period IN (SELECT night FROM todo)
     GROUP BY 1, 2
  ),
  types AS (
    SELECT unnest(ARRAY['refinery', 'power_plant']) AS facility_type
  ),
  calc AS (
    SELECT c.night, ty.facility_type,
           coalesce(p.n, 0)          AS rows_present,
           p.n                       AS roster_size,   -- the derive wrote its whole roster
           (c.night <= current_date - 2) AS is_final
      FROM todo c
     CROSS JOIN types ty
      LEFT JOIN present p ON p.night = c.night AND p.facility_type = ty.facility_type
  ),
  cls AS (
    SELECT c.*,
           (c.roster_size IS NOT NULL
            AND c.rows_present::numeric >= 0.95 * c.roster_size
            AND c.is_final) AS usable
      FROM calc c
  )
  INSERT INTO sensor_night_census AS s (
    sensor, facility_type, night, rows_present, roster_size, roster_source, rows_outside_roster,
    is_final, usable, status, computed_at)
  SELECT 'firms', facility_type, night, rows_present, roster_size,
         CASE WHEN roster_size IS NULL THEN 'unrecorded' ELSE 'firms_derive_rows' END,
         CASE WHEN roster_size IS NULL THEN NULL ELSE 0 END,
         is_final, usable,
         CASE WHEN usable                                   THEN 'usable'
              WHEN roster_size IS NULL AND rows_present > 0 THEN 'roster_unrecorded'
              WHEN NOT is_final                             THEN 'pending'
              WHEN rows_present = 0                         THEN 'permanently_empty'
              ELSE                                               'permanently_partial' END,
         now()
    FROM cls
  ON CONFLICT (sensor, facility_type, night) DO UPDATE
     SET rows_present  = EXCLUDED.rows_present,
         roster_size   = EXCLUDED.roster_size,
         roster_source = EXCLUDED.roster_source,
         rows_outside_roster = EXCLUDED.rows_outside_roster,
         is_final      = EXCLUDED.is_final,
         usable        = EXCLUDED.usable,
         status        = EXCLUDED.status,
         computed_at   = EXCLUDED.computed_at
   WHERE (s.rows_present, s.roster_size, s.rows_outside_roster, s.is_final, s.usable, s.status)
         IS DISTINCT FROM
         (EXCLUDED.rows_present, EXCLUDED.roster_size, EXCLUDED.rows_outside_roster, EXCLUDED.is_final, EXCLUDED.usable, EXCLUDED.status);
  GET DIAGNOSTICS v_fi_rows = ROW_COUNT;

  INSERT INTO sensor_night_census_runs (full_refresh, blackmarble_nights, blackmarble_rows_recomputed, firms_rows_changed, duration_ms)
  VALUES (p_full, v_bm_nights, v_bm_rows, v_fi_rows,
          (extract(epoch FROM clock_timestamp() - v_t0) * 1000)::int);

  RETURN jsonb_build_object(
    'full_refresh',       p_full,
    'blackmarble_nights', v_bm_nights,
    'blackmarble_rows_recomputed', v_bm_rows,
    'firms_rows_changed', v_fi_rows,
    'duration_ms',        (extract(epoch FROM clock_timestamp() - v_t0) * 1000)::int);
END;
$function$;

COMMENT ON FUNCTION public.refresh_sensor_night_census(boolean) IS
  'Reality Check PR-1 (mig 159). Classifies every Black Marble and FIRMS night against that night''s actual roster; writes a sensor_night_census_runs row on every call. Heavy (a full refresh takes ~15-20 s on 2026-09-18 data: it re-derives every night''s roster from FIRMS and matches every row against it): pg_cron only, never over PostgREST.';

REVOKE EXECUTE ON FUNCTION public.refresh_sensor_night_census(boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.refresh_sensor_night_census(boolean) TO service_role;

-- ─── 4 · The only night list the classifier may read ───────────────────
-- The 0.95 floor is repeated in the predicate on purpose: the CHECK above
-- and this view are two independent fences.
CREATE OR REPLACE VIEW public.sensor_usable_nights
WITH (security_invoker = true) AS
SELECT c.sensor,
       c.facility_type,
       c.night,
       c.rows_present,
       c.roster_size,
       c.coverage_ratio,
       c.is_final,
       c.computed_at
  FROM public.sensor_night_census c
 WHERE c.usable
   AND c.roster_size IS NOT NULL
   AND c.rows_present::numeric >= 0.95 * c.roster_size;

COMMENT ON VIEW public.sensor_usable_nights IS
  'Reality Check PR-1 (mig 159). The usable nights (>= 0.95 of that night''s roster; FIRMS days only once final). Every Reality Check read joins through this view, so a thin night is excluded by the join.';

REVOKE ALL ON public.sensor_usable_nights FROM anon, authenticated;

-- ─── 5 · Schedule (heavy SQL lives on pg_cron) ─────────────────────────
-- Hourly at :50 — away from the :05 night-lights detector and the :12
-- plan refresh. Steady state touches ~16 Black Marble nights.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'refresh-sensor-night-census';
SELECT cron.schedule('refresh-sensor-night-census', '50 * * * *',
                     $job$ SELECT public.refresh_sensor_night_census(false) $job$);

-- ─── 6 · Seed: classify every night once (≈ 15-20 s; SQL Editor, not PostgREST)
SELECT public.refresh_sensor_night_census(true);

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════
-- VERIFY — read-only. Paste these rows back.
-- ═══════════════════════════════════════════════════════════════════════

-- V1 · objects exist (expect 8 rows, every present = true)
SELECT 'table sensor_night_census'          AS object, to_regclass('public.sensor_night_census')      IS NOT NULL AS present
UNION ALL SELECT 'table sensor_night_census_runs', to_regclass('public.sensor_night_census_runs') IS NOT NULL
UNION ALL SELECT 'view sensor_usable_nights',      to_regclass('public.sensor_usable_nights')      IS NOT NULL
UNION ALL SELECT 'function refresh_sensor_night_census(boolean)',
                 to_regprocedure('public.refresh_sensor_night_census(boolean)') IS NOT NULL
UNION ALL SELECT 'constraint snc_usable_needs_roster_floor',
                 EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'snc_usable_needs_roster_floor')
UNION ALL SELECT 'constraint snc_status_follows_numbers',
                 EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'snc_status_follows_numbers')
UNION ALL SELECT 'cron job refresh-sensor-night-census',
                 EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-sensor-night-census' AND active)
UNION ALL SELECT 'anon cannot execute refresh',
                 NOT has_function_privilege('anon', 'public.refresh_sensor_night_census(boolean)', 'EXECUTE');

-- V2 · Black Marble refinery nights by status (2026-09-18 expectation:
--      usable 59 · permanently_empty 9 · permanently_partial 4 · pending 6)
SELECT sensor, facility_type, status, count(*) AS nights,
       min(night) AS first_night, max(night) AS last_night
  FROM public.sensor_night_census
 GROUP BY 1, 2, 3
 ORDER BY 1, 2, 3;

-- V3 · every Black Marble refinery night that is NOT usable, with its numbers
--      (expect 07-10 145/431, 07-17 313/431, 08-03 9/431, 08-06 1/431 partial;
--       07-11..07-16, 07-26, 08-04, 08-05 empty; 09-09 405/431 pending;
--       rows_outside_roster 0 on every row — no roster has changed yet)
SELECT night, rows_present, roster_size, coverage_ratio, rows_outside_roster, tiles_processed, tiles_missing,
       is_final, status
  FROM public.sensor_night_census
 WHERE sensor = 'blackmarble' AND facility_type = 'refinery' AND NOT usable
 ORDER BY night;

-- V4 · 2026-07-17 is absent from the usable-night view (expect 0)
SELECT count(*) AS usable_rows_on_0717
  FROM public.sensor_usable_nights
 WHERE sensor = 'blackmarble' AND night = DATE '2026-07-17';

-- V5 · the run record (expect one row, full_refresh true, written just now)
SELECT ran_at, full_refresh, blackmarble_nights, blackmarble_rows_recomputed, firms_rows_changed, duration_ms
  FROM public.sensor_night_census_runs
 ORDER BY ran_at DESC
 LIMIT 3;
