-- 121 · Make refresh_vessel_cadence survivable, and stop it taking the
--       dark-contact event lifecycle down with it.
--
-- WHAT BROKE
-- ----------
-- compute-shadow-fleet-scores has not completed a run since 2026-09-01 02:05.
-- Measured 2026-09-06:
--   * vessel_profiles.computed_at   max = 2026-09-01 02:05:36  (139 h stale)
--   * vessel_cadence.computed_at    max = 2026-09-01 02:05:39  (139 h stale)
--   * dark_contact_events last close    = 2026-09-01 02:06:06, 0 in 24 h
--   * ais_box_liveness.computed_at      = TODAY, 30 min ago
--
-- Liveness is refreshed by the FIRST gate in that cron and it is fresh, so the
-- cron runs and dies at the SECOND gate: refresh_vessel_cadence().
--
-- WHY IT DIES
-- -----------
-- The function recomputes every vessel over a 14-day window: a lag() window
-- over ais_position_history, which is now 6.2M rows / 1535 MB with 6.09M of
-- them inside that window. EXPLAIN ANALYZE on 2026-09-06: 6,088,041 rows,
-- Execution Time 20,706 ms — and that is the read alone, before the 46k-row
-- upsert and the delete.
--
-- PostgREST logs in as `authenticator`, which carries statement_timeout = 8s
-- (service_role has no override). So the call is given 8 seconds to do 20.7
-- seconds of work. It cannot ever finish, and the cron returns 500 before
-- reaching the event lifecycle further down the same handler.
--
-- It worked until 1 September because the table was small enough. Nothing was
-- deployed that day; the data simply crossed the threshold. That is why this
-- looks like a silent stop rather than a regression.
--
-- THE FIX
-- -------
-- 1. Declare the budget the work needs, rather than inheriting the caller's.
-- 2. Recompute only vessels that have a NEW fix since the last refresh. The
--    full sweep costs 20.7 s and grows with the table; the incremental set is
--    just the fleet that moved since the last tick. The first run after this
--    migration is still a near-full sweep (the last refresh was six days ago)
--    and that is fine — it now has the headroom to finish.
--
-- The DELETE changes shape but not meaning. It used to anti-join the freshly
-- computed set; with an incremental refresh that set no longer covers every
-- vessel, so staleness is read off computed_at instead. Equivalent: a vessel
-- with any fix inside the window gets refreshed, so a row not refreshed in 14
-- days has no fixes in the window and its baseline is no longer supported.

BEGIN;

CREATE OR REPLACE FUNCTION public.refresh_vessel_cadence()
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_since timestamptz;
BEGIN
  -- PostgREST's authenticator role allows 8s; this work needs ~21s on a full
  -- sweep. SET LOCAL is scoped to the surrounding transaction, so it cannot
  -- leak into any other statement on the pooled connection.
  SET LOCAL statement_timeout = '90s';

  SELECT coalesce(max(computed_at), now() - interval '14 days')
    INTO v_since
    FROM vessel_cadence;

  WITH changed AS (
    -- Only these vessels can have a different cadence than last time.
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
    HAVING count(*) >= 4  -- 4 deltas = 5 real fixes
  )
  INSERT INTO vessel_cadence (mmsi, fixes, median_interval_h, window_days, computed_at)
  SELECT mmsi, fixes, median_h, 14, now()
  FROM cad
  ON CONFLICT (mmsi) DO UPDATE SET
    fixes             = excluded.fixes,
    median_interval_h = excluded.median_interval_h,
    window_days       = excluded.window_days,
    computed_at       = excluded.computed_at;

  -- A baseline the 14-day window no longer supports is stale evidence, not a
  -- baseline.
  DELETE FROM vessel_cadence WHERE computed_at < now() - interval '14 days';
END;
$function$;

COMMENT ON FUNCTION public.refresh_vessel_cadence() IS
  'Incremental per-vessel median fix interval over 14d. Raises its own statement_timeout: PostgREST allows 8s and a full sweep measured 20.7s on 2026-09-06 (mig 121).';

-- Companion to due_unscored_predictions() from mig 120. That function LIMITs, so
-- PostgREST's count=exact over it can never exceed p_limit and cannot report a
-- backlog. score-predictions shipped reporting a "due_total" that counted every
-- due row, scored or not, so it sat unchanged at 46,986 while consecutive ticks
-- each scored 1,992. This returns the number that actually moves.
CREATE OR REPLACE FUNCTION public.due_unscored_predictions_count()
RETURNS bigint
LANGUAGE sql
STABLE
AS $$
  SELECT count(*)
  FROM predictions_register r
  WHERE r.resolves_at <= now()
    AND NOT EXISTS (
      SELECT 1 FROM prediction_outcomes o WHERE o.prediction_id = r.id
    );
$$;

GRANT EXECUTE ON FUNCTION public.due_unscored_predictions_count() TO service_role;

COMMIT;

-- VERIFY (run after, then re-run 2 min later):
--   SELECT max(computed_at), count(*) FROM vessel_cadence;   -- computed_at should be NOW
--   SELECT max(closed_at), count(*) FILTER (WHERE status='open') FROM dark_contact_events;
