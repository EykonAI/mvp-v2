-- 122 · Run refresh_vessel_cadence on pg_cron, because SET LOCAL could never
--       have fixed it. Corrects migration 121.
--
-- WHAT 121 GOT WRONG
-- ------------------
-- 121 added `SET LOCAL statement_timeout = '90s'` inside refresh_vessel_cadence()
-- on the theory that the function could declare its own budget. It cannot.
-- PostgreSQL arms the statement timer in start_xact_command(), BEFORE the
-- function body runs, using the value in force at that moment. Changing the GUC
-- inside the body does not re-arm the timer for the statement already running.
-- The line was inert.
--
-- Verified on production after 121 was applied: compute-shadow-fleet-scores ran
-- at 22:04 (vessel_profiles, ais_box_liveness and dark_contact_events all show
-- writes at that timestamp) while vessel_cadence.computed_at stayed at
-- 2026-09-01 02:05:39. The call still fails. The incremental logic itself is
-- sound — 48,945 of 67,722 in-window vessels qualify as changed — it is simply
-- ~72% of a full sweep, which is ~15-21 s against PostgREST's 8 s.
--
-- 121's OTHER half did work and stays: the cron no longer treats a failed
-- refresh as a missing baseline, which is why 7,851 dark-contact events closed
-- on that same 22:04 run after six days of nothing.
--
-- THE FIX
-- -------
-- Stop calling this over the API at all. A pg_cron job runs in a background
-- session under the DATABASE statement_timeout (120 s here), not the
-- `authenticator` login role's 8 s. The constraint disappears instead of being
-- negotiated with. The web handler keeps only the staleness READ, which is
-- cheap and is what it actually needs.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Drop the inert SET LOCAL. Leaving it would be a comment claiming a mechanism
-- the code does not have — the exact failure class this codebase catalogues.
CREATE OR REPLACE FUNCTION public.refresh_vessel_cadence()
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_since timestamptz;
BEGIN
  -- No statement_timeout games here: this is invoked by pg_cron, which is not
  -- subject to the API role's 8 s. If you ever call it over PostgREST again it
  -- will time out, and that is the honest failure rather than a hidden one.
  SELECT coalesce(max(computed_at), now() - interval '14 days')
    INTO v_since
    FROM vessel_cadence;

  WITH changed AS (
    SELECT DISTINCT mmsi
    FROM ais_position_history
    WHERE recorded_at > v_since
  ),
  deltas AS (
    SELECT h.mmsi,
           extract(epoch from (h.recorded_at
             - lag(h.recorded_at) over (partition by h.mmsi order by h.recorded_at)))/3600.0 AS dh
    FROM ais_position_history h
    JOIN changed c ON c.mmsi = h.mmsi
    WHERE h.recorded_at > now() - interval '14 days'
  ),
  cad AS (
    SELECT mmsi,
           count(*) + 1 AS fixes,
           greatest(0.5, percentile_cont(0.5) within group (order by dh)) AS median_h
    FROM deltas
    WHERE dh IS NOT NULL
    GROUP BY mmsi
    HAVING count(*) >= 4
  )
  INSERT INTO vessel_cadence (mmsi, fixes, median_interval_h, window_days, computed_at)
  SELECT mmsi, fixes, median_h, 14, now()
  FROM cad
  ON CONFLICT (mmsi) DO UPDATE SET
    fixes             = excluded.fixes,
    median_interval_h = excluded.median_interval_h,
    window_days       = excluded.window_days,
    computed_at       = excluded.computed_at;

  DELETE FROM vessel_cadence WHERE computed_at < now() - interval '14 days';
END;
$function$;

COMMENT ON FUNCTION public.refresh_vessel_cadence() IS
  'Incremental per-vessel median fix interval over 14d. Runs on pg_cron every 30 min (mig 122) because a full sweep is ~21s and PostgREST allows 8s. Do not call over the API.';

-- Idempotent (re)schedule.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'refresh-vessel-cadence';
SELECT cron.schedule(
  'refresh-vessel-cadence',
  '*/30 * * * *',
  $job$SELECT public.refresh_vessel_cadence()$job$
);

COMMIT;

-- Clear the six-day backlog now rather than waiting for the first tick. Runs
-- in the SQL Editor under the 120 s database timeout; measured ~21 s.
SELECT public.refresh_vessel_cadence();

-- VERIFY:
--   SELECT max(computed_at) FROM vessel_cadence;                      -- expect NOW
--   SELECT jobname, schedule, active FROM cron.job;                   -- expect the job, active
--   SELECT status, return_message, start_time FROM cron.job_run_details
--     ORDER BY start_time DESC LIMIT 3;                               -- after the next :00/:30
