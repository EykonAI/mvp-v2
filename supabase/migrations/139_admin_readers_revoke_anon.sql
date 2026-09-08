-- 139 · The admin readers of migration 138: revoke EXECUTE from anon and
--       authenticated BY NAME.
--
-- Migration 138 ended every admin reader with
--   REVOKE ALL ON FUNCTION … FROM PUBLIC; GRANT EXECUTE ON FUNCTION … TO service_role;
-- and on Supabase that is not enough. The project's default privileges grant
-- EXECUTE on every new function in public to anon, authenticated and
-- service_role explicitly, so after 138 the ACL read
--   {postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}
-- — revoking from PUBLIC removed only the "=X" entry nobody was using.
-- Read on 2026-09-08 12:00 UTC, minutes after 138 was applied:
--   has_function_privilege('anon', 'public.pg_cron_recent_runs(text[], integer)', 'EXECUTE') → true
-- Any holder of the public anon key could call
--   POST /rest/v1/rpc/pg_cron_recent_runs      (cron job statuses and return messages,
--                                               through a SECURITY DEFINER function)
--   POST /rest/v1/rpc/calibration_monitor_health (the pipeline diagnostics)
-- Nothing secret is in either payload; both are exactly what the admin
-- contract (build-prompt v1.1 §3) said would never reach a client.
--
-- The PUBLIC ledger readers keep their grants on purpose — they are public:
-- calibration_ledger_tracks (124), calibration_window_stats (136),
-- calibration_cohorts (137), the plan RPCs (125–129).
--
-- RULE, procedural from now on: an admin-only function on Supabase is declared
-- with  REVOKE EXECUTE ON FUNCTION … FROM PUBLIC, anon, authenticated;  — the
-- roles by name — and verified with has_function_privilege in the same file.

REVOKE EXECUTE ON FUNCTION public.pg_cron_recent_runs(text[], integer)                                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.calibration_monitor_health()                                         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.calibration_family_stats(timestamptz, timestamptz, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.calibration_cohorts_by_box(integer)                                  FROM PUBLIC, anon, authenticated;

-- Restated so the file is complete on its own (idempotent).
GRANT EXECUTE ON FUNCTION public.pg_cron_recent_runs(text[], integer)                                TO service_role;
GRANT EXECUTE ON FUNCTION public.calibration_monitor_health()                                         TO service_role;
GRANT EXECUTE ON FUNCTION public.calibration_family_stats(timestamptz, timestamptz, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.calibration_cohorts_by_box(integer)                                  TO service_role;

-- STEP 1 — READ ONLY, run alone BEFORE the statements above, then again AFTER.
-- Before (2026-09-08): the four mig-138 readers read anon true · authenticated true · service_role true.
-- After: the four read anon FALSE · authenticated FALSE · service_role true;
--        the three public readers are unchanged at true · true · true.
SELECT p.proname,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
       has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('pg_cron_recent_runs', 'calibration_monitor_health', 'calibration_family_stats',
                     'calibration_cohorts_by_box', 'calibration_ledger_tracks', 'calibration_cohorts',
                     'calibration_window_stats')
 ORDER BY 1;
