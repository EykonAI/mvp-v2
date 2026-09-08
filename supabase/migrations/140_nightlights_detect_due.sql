-- 140 · Night-lights detection judges what is DUE, not only what is newest.
--
-- The 10:05 UTC pg_cron job (mig 134) judges the newest 3 nights on the data
-- clock. A night re-ingested AFTER it was judged is never looked at again:
-- 08-25 and 08-26 were judged on partial data on 2026-09-07 21:32 (8 events on
-- 08-25, none recorded for 08-26), then refilled by the Black Marble worker at
-- 09:52–09:55 on 09-08 — and the admin monitor's detect-rejudge rule has been
-- amber since the page first rendered. The job now judges the UNION of
--   · the newest p_recent nights on the data clock (as before), and
--   · every night since run records began whose ingest run is newer than its
--     detect run, or that has no detect run at all — newest first, at most
--     p_max_stale per run, so a large refill drains over a few days rather
--     than blowing the 120 s pg_cron budget in one go.
-- STEP 2 below calls it once, so applying this migration IS the re-judge of
-- 08-25 and 08-26; no separate manual call is needed.
--
-- Re-judging is safe by construction. The detection RPC (mig 092) UPSERTS on
-- (facility_type, facility_id, period, event_type) and never deletes, and a
-- night judged on partial data can only have MISSED events: a missing row is
-- "not covered" — it cannot produce a first_light without a lit observation,
-- nor a went_dark without covered dark nights. A re-judge adds what was
-- missed; events already claimed keep their rows and their claims.
--
-- FOUND WHILE HERE, fixed in the same file: mig 134's nightlights_detect_recent
-- and mig 092's nightlights_detect_significant_events were created without
-- revoking EXECUTE from anon/authenticated (Supabase grants both by name —
-- mig 139's lesson), so any holder of the public anon key could run a
-- ~1–2 s WRITE per call through /rest/v1/rpc/nightlights_detect_recent, as
-- often as they liked. pg_cron runs as postgres and the app never calls these
-- with the anon key, so revoking costs nothing. The same audit is owed to
-- every other RPC that writes (firms_detect_significant_events, the plan
-- issuers' helpers) — listed as a next step, not slipped in here.

-- ─────────────────────────────────────────────────────────────────────
-- STEP 1 — READ ONLY. Expect on 2026-09-08: stale_nights = 2026-08-26,
-- 2026-08-25 (ingest 09:52/09:55 > judged 21:32 the day before); run rows
-- 08-29..08-27 judged 10:05 today; anon_can_run_detect = true (the finding).
-- ─────────────────────────────────────────────────────────────────────
SELECT
  (SELECT string_agg(i.night::text, ', ' ORDER BY i.night DESC)
     FROM public.blackmarble_ingest_runs i
    WHERE i.facilities_written > 0
      AND i.night >= (SELECT min(night) FROM public.nightlights_detect_runs)
      AND NOT EXISTS (SELECT 1 FROM public.nightlights_detect_runs d
                       WHERE d.night = i.night AND d.judged_at >= i.ran_at)) AS stale_nights,
  (SELECT string_agg(night::text || ':' || events || ' judged ' || to_char(judged_at, 'MM-DD HH24:MI'), ' · ' ORDER BY night DESC)
     FROM public.nightlights_detect_runs) AS run_rows,
  has_function_privilege('anon', 'public.nightlights_detect_recent(integer)', 'EXECUTE') AS anon_can_run_detect;

-- ─────────────────────────────────────────────────────────────────────
-- STEP 2 — THE CHANGE.
-- ─────────────────────────────────────────────────────────────────────
BEGIN;

CREATE OR REPLACE FUNCTION public.nightlights_detect_due(p_recent integer DEFAULT 3, p_max_stale integer DEFAULT 5)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_newest date;
  v_day    date;
  v_n      integer;
  v_t0     timestamptz;
  v_recent jsonb  := '{}'::jsonb;
  v_stale  jsonb  := '{}'::jsonb;
  v_done   date[] := '{}';
BEGIN
  SELECT max(period) INTO v_newest FROM public.blackmarble_facility_radiance;
  IF v_newest IS NULL THEN
    RETURN jsonb_build_object('error', 'no radiance rows — nothing to judge');
  END IF;

  -- 1 · the newest nights on the data clock (identical to mig 134)
  FOR i IN 0 .. GREATEST(p_recent, 0) - 1 LOOP
    v_day := v_newest - i;
    v_t0  := clock_timestamp();
    v_n := public.nightlights_detect_significant_events(
             p_day => v_day, p_baseline_nights => 30, p_min_clear => 7,
             p_surge_sigma => 3.0, p_dark_frac => 0.25, p_dark_nights => 3, p_lit_floor => 1.0);
    INSERT INTO public.nightlights_detect_runs (night, events, judged_at, duration_ms)
    VALUES (v_day, v_n, clock_timestamp(), (extract(epoch from clock_timestamp() - v_t0) * 1000)::int)
    ON CONFLICT (night) DO UPDATE
      SET events = EXCLUDED.events, judged_at = EXCLUDED.judged_at, duration_ms = EXCLUDED.duration_ms;
    v_recent := v_recent || jsonb_build_object(v_day::text, v_n);
    v_done   := v_done || v_day;
  END LOOP;

  -- 2 · stale nights: ingested (again) after they were judged, or never judged
  --     since run records began. judged_at is clock_timestamp() so that a
  --     re-judge inside a long transaction still lands after the ingest run.
  FOR v_day IN
    SELECT i.night
      FROM public.blackmarble_ingest_runs i
     WHERE i.facilities_written > 0
       AND i.night >= COALESCE((SELECT min(night) FROM public.nightlights_detect_runs), v_newest - 30)
       AND NOT (i.night = ANY (v_done))
       AND NOT EXISTS (SELECT 1 FROM public.nightlights_detect_runs d
                        WHERE d.night = i.night AND d.judged_at >= i.ran_at)
     ORDER BY i.night DESC
     LIMIT GREATEST(p_max_stale, 0)
  LOOP
    v_t0 := clock_timestamp();
    v_n := public.nightlights_detect_significant_events(
             p_day => v_day, p_baseline_nights => 30, p_min_clear => 7,
             p_surge_sigma => 3.0, p_dark_frac => 0.25, p_dark_nights => 3, p_lit_floor => 1.0);
    INSERT INTO public.nightlights_detect_runs (night, events, judged_at, duration_ms)
    VALUES (v_day, v_n, clock_timestamp(), (extract(epoch from clock_timestamp() - v_t0) * 1000)::int)
    ON CONFLICT (night) DO UPDATE
      SET events = EXCLUDED.events, judged_at = EXCLUDED.judged_at, duration_ms = EXCLUDED.duration_ms;
    v_stale := v_stale || jsonb_build_object(v_day::text, v_n);
  END LOOP;

  RETURN jsonb_build_object('data_clock', v_newest, 'recent', v_recent, 'stale', v_stale, 'ran_at', clock_timestamp());
END;
$$;

-- The job: same schedule, the new wrapper. nightlights_detect_recent stays for
-- manual use.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'detect-nightlights';
SELECT cron.schedule('detect-nightlights', '5 10 * * *', $job$ SELECT public.nightlights_detect_due(3, 5) $job$);

-- Grants (mig 139's rule: by role name). pg_cron runs as postgres; the app
-- never calls these with the anon key.
REVOKE EXECUTE ON FUNCTION public.nightlights_detect_due(integer, integer)                       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.nightlights_detect_recent(integer)                             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.nightlights_detect_significant_events(date, int, int, numeric, numeric, int, numeric) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.nightlights_detect_due(integer, integer)                       TO service_role;
GRANT  EXECUTE ON FUNCTION public.nightlights_detect_recent(integer)                             TO service_role;
GRANT  EXECUTE ON FUNCTION public.nightlights_detect_significant_events(date, int, int, numeric, numeric, int, numeric) TO service_role;

COMMIT;

-- The re-judge itself (≈ 5 nights × 0.7–1.8 s). Expect: recent = 08-29/28/27
-- re-judged with the same counts as at 10:05; stale = {"2026-08-26": n,
-- "2026-08-25": n} with 08-25 well above the 8 it carried from partial data.
SELECT public.nightlights_detect_due(3, 5);

-- ─────────────────────────────────────────────────────────────────────
-- STEP 3 — VERIFY. Expect stale_nights NULL, job command = nightlights_detect_due(3, 5),
-- anon_can_run_detect false, and 08-25/08-26 run rows judged just now.
-- ─────────────────────────────────────────────────────────────────────
SELECT
  (SELECT string_agg(i.night::text, ', ' ORDER BY i.night DESC)
     FROM public.blackmarble_ingest_runs i
    WHERE i.facilities_written > 0
      AND i.night >= (SELECT min(night) FROM public.nightlights_detect_runs)
      AND NOT EXISTS (SELECT 1 FROM public.nightlights_detect_runs d
                       WHERE d.night = i.night AND d.judged_at >= i.ran_at)) AS stale_nights,
  (SELECT command FROM cron.job WHERE jobname = 'detect-nightlights')       AS job_command,
  has_function_privilege('anon', 'public.nightlights_detect_recent(integer)', 'EXECUTE') AS anon_can_run_detect,
  (SELECT string_agg(night::text || ':' || events || ' judged ' || to_char(judged_at, 'MM-DD HH24:MI') || ' in ' || duration_ms || 'ms', ' · ' ORDER BY night DESC)
     FROM public.nightlights_detect_runs WHERE night >= '2026-08-25')       AS run_rows;
