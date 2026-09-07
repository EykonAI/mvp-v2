-- 134 · Night-lights detection: a period-led index, and the job moved to pg_cron
--
-- WHAT WAS FAILING. Every run of detect-nightlights-significance since
-- 2026-09-01 has returned ok=false with
--     "detect 2026-08-25: canceling statement due to statement timeout"
--     "detect 2026-08-24: canceling statement due to statement timeout"
-- so no night newer than 08-23 has ever been judged, the two night-lights
-- claim families have had no fresh candidates since, and the route has been
-- red in Railway for six days. This is the authenticator role's 8-second
-- statement_timeout on a PostgREST RPC — the same wall that killed
-- refresh_vessel_cadence on 1 September (migs 121/122).
--
-- WHY IT IS SLOW — MEASURED, and not what it looked like. The function's
-- SELECT runs in 0.3 s hot (EXPLAIN ANALYZE, 2026-09-07). But its plan walks
-- idx_bm_radiance_clear, which leads with (facility_type, facility_id): a
-- 30-night range on `period` is a filter over the WHOLE index in facility
-- order, so the ~104k matching rows are fetched from the heap at random —
-- 104,903 buffer touches for a night. Hot that is nothing; cold it is
-- thousands of random reads on network storage. And it is cold every single
-- day: shared_buffers is 512 MB, ais_position_history is 730 MB and the
-- cadence job sweeps it every 30 minutes. Lifetime cache hit ratio on the
-- radiance table is 93.5% against 99.2% on firms_facility_observations, which
-- the hourly FIRMS ingest keeps warm — which is exactly why the FIRMS detector
-- (same shape) did NOT time out tonight. ~7k physical reads per run at
-- 1-2 ms each is the 8 s wall, to the number.
--
-- TWO FIXES, both here, because either alone leaves a cliff:
--
--   1. An index that LEADS WITH PERIOD and carries what the CTE reads, so a
--      30-night window is one contiguous index-only range — a few thousand
--      sequential blocks instead of ~105k random ones. This makes the RPC
--      fast cold, which is what matters.
--   2. The detection scheduled on pg_cron, daily after the 09:44 UTC Black
--      Marble worker, in a background session under the DATABASE
--      statement_timeout (120 s) rather than authenticator's 8 s. Rule from
--      mig 122, restated because it was not applied here: heavy periodic SQL
--      belongs on pg_cron, never on a PostgREST RPC. The web route stops
--      calling the RPC (same PR) and reads results plus a staleness signal.
--
-- Plain CREATE INDEX, not CONCURRENTLY: the SQL editor runs this in a
-- transaction, where CONCURRENTLY is refused. The SHARE lock lasts a few
-- seconds on 476k rows and the only writer runs at 09:44 UTC.


-- ─────────────────────────────────────────────────────────────────────
-- STEP 1 — READ ONLY. Expect: newest_detected 2026-08-23, data_clock
-- 2026-08-25 (or 08-29 once #480's retry has run), job absent.
-- ─────────────────────────────────────────────────────────────────────
select
  (select max(period)::text from nightlights_significant_events)     as newest_detected,
  (select max(period)::text from blackmarble_facility_radiance)      as data_clock,
  (select count(*) from cron.job where jobname = 'detect-nightlights') as job_present,
  (select count(*) from pg_indexes where indexname = 'idx_bm_radiance_clear_by_period') as index_present,
  (select count(*) from information_schema.tables where table_name = 'nightlights_detect_runs') as runs_table_present;


-- ─────────────────────────────────────────────────────────────────────
-- STEP 2 — THE WRITE.
-- ─────────────────────────────────────────────────────────────────────
begin;

-- 2a · the period-led partial index. INCLUDE carries every column the
-- function's `clear` CTE selects, so the scan is index-only.
CREATE INDEX IF NOT EXISTS idx_bm_radiance_clear_by_period
  ON public.blackmarble_facility_radiance (period, facility_type, facility_id)
  INCLUDE (radiance, facility_name, country)
  WHERE radiance IS NOT NULL
    AND cloud_confidence = 'confident_clear'
    AND snow IS NOT TRUE;

-- 2b · a run record: A ROW EXISTS IFF WE JUDGED THAT NIGHT (mig 085's
-- invariant). nightlights_significant_events cannot carry this — a night that
-- was judged and found nothing significant leaves no row there, which is
-- indistinguishable from a night never judged. The web route reads this table
-- to say whether the job has kept up with the data clock.
CREATE TABLE IF NOT EXISTS public.nightlights_detect_runs (
  night       date PRIMARY KEY,
  events      integer     NOT NULL,
  judged_at   timestamptz NOT NULL DEFAULT now(),
  duration_ms integer
);
ALTER TABLE public.nightlights_detect_runs ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role (which bypasses RLS) reads or writes it.

-- 2c · a wrapper that judges the newest N nights on the DATA clock, so the
-- job needs no date argument and follows the worker automatically.
--
-- Parameters are passed EXPLICITLY and must equal the route's constants
-- (apps/web/app/api/cron/detect-nightlights-significance/route.ts:
-- BASELINE_NIGHTS 30 · MIN_CLEAR 7 · SURGE_SIGMA 3.0 · DARK_FRAC 0.25 ·
-- DARK_NIGHTS 3 · LIT_FLOOR 1.0). Verified equal on 2026-09-07. The route
-- still uses the first two for its eligibility probe; if either side is ever
-- edited, re-verify — a mismatch silently judges under a different rule than
-- the one the route reports.
CREATE OR REPLACE FUNCTION public.nightlights_detect_recent(p_days integer DEFAULT 3)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_newest date;
  v_day    date;
  v_n      integer;
  v_t0     timestamptz;
  v_out    jsonb := '{}'::jsonb;
BEGIN
  SELECT max(period) INTO v_newest FROM public.blackmarble_facility_radiance;
  IF v_newest IS NULL THEN
    RETURN jsonb_build_object('error', 'no radiance rows — nothing to judge');
  END IF;
  FOR i IN 0 .. p_days - 1 LOOP
    v_day := v_newest - i;
    v_t0  := clock_timestamp();
    v_n := public.nightlights_detect_significant_events(
             p_day             => v_day,
             p_baseline_nights => 30,
             p_min_clear       => 7,
             p_surge_sigma     => 3.0,
             p_dark_frac       => 0.25,
             p_dark_nights     => 3,
             p_lit_floor       => 1.0);
    INSERT INTO public.nightlights_detect_runs (night, events, judged_at, duration_ms)
    VALUES (v_day, v_n, now(),
            (extract(epoch from clock_timestamp() - v_t0) * 1000)::int)
    ON CONFLICT (night) DO UPDATE
      SET events = EXCLUDED.events, judged_at = EXCLUDED.judged_at,
          duration_ms = EXCLUDED.duration_ms;
    v_out := v_out || jsonb_build_object(v_day::text, v_n);
  END LOOP;
  RETURN jsonb_build_object('data_clock', v_newest, 'judged', v_out, 'ran_at', now());
END;
$$;

-- 2d · schedule it: daily at 10:05 UTC, after the 09:44 UTC worker has landed
-- the night. pg_cron runs it in a background session under the database
-- statement_timeout, not authenticator's 8 s.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'detect-nightlights';
SELECT cron.schedule(
  'detect-nightlights',
  '5 10 * * *',
  $job$ SELECT public.nightlights_detect_recent(3) $job$
);

commit;

-- 2e · one inline run NOW, to judge the nights the timeouts have been
-- skipping since 09-01. Outside the transaction so a slow first pass on a
-- cold cache cannot roll back the index and the job with it. Expect a jsonb
-- with data_clock 2026-08-25 (or later) and non-zero counts for its nights.
SELECT public.nightlights_detect_recent(3);


-- ─────────────────────────────────────────────────────────────────────
-- STEP 3 — VERIFY. Expect index_present 1, job_present 1 (active), and
-- newest_detected equal to data_clock. Then re-run the web cron:
-- expect ok=true and errors=[] — it no longer calls the RPC.
-- ─────────────────────────────────────────────────────────────────────
select
  (select count(*) from pg_indexes where indexname = 'idx_bm_radiance_clear_by_period') as index_present,
  (select count(*) from cron.job where jobname = 'detect-nightlights' and active)        as job_present,
  (select max(period)::text from nightlights_significant_events)                         as newest_detected,
  (select max(period)::text from blackmarble_facility_radiance)                          as data_clock,
  (select count(*) from nightlights_significant_events where period > '2026-08-23')       as events_on_newly_judged_nights,
  (select string_agg(night::text||':'||events||' in '||duration_ms||'ms', ', ' order by night desc) from nightlights_detect_runs) as runs;
