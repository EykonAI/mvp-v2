-- 181 · Reality Check truth pass 2 (TP-2): the /start thermal roster counts
--       crude-oil refineries only · firms_rule_coverage loses anon and
--       authenticated EXECUTE
--
-- WHY (1) · TWO REFINERY FIGURES, ONE PAGE APART. Since migration 168 every
-- public "refineries watched" figure reads refinery_type_coverage(), which
-- counts refineries.site_type = 'refinery' only: 353 of 554 on 2026-09-19.
-- The /start honesty board's "Thermal watch roster: N refineries"
-- (apps/web/lib/marketing/watched-coverage.ts → thermalRefineryRows) still
-- counted every facility_type = 'refinery' row the FIRMS derivation wrote on
-- its newest day — that includes the 96 sites 168 re-typed (terminals,
-- petrochemical works, gas plants, mills), all of which sit in a box. Read
-- read-only on production 2026-09-19 (day of 2026-09-19): 449 rows, of which
-- 353 are site_type = 'refinery', 96 are re-typed, 0 are orphans. The
-- homepage said 353, /start said 449.
--
-- WHAT (1). refinery_roster_rows(p_period) is that same count restricted to
-- site_type = 'refinery': the derivation's refinery rows for one day, joined
-- to refineries by primary key. It stays a roster count — rows the
-- derivation actually wrote — so a stalled or partial derivation still reads
-- low or stale on the board, instead of being replaced by the box membership
-- figure. On a complete derivation day it equals refinery_type_coverage()'s
-- watched_refineries (353 = 353 on 2026-09-19). The derivation, the
-- observation rows and firms_rule_coverage are unchanged: FIRMS keeps
-- observing every row (168's rule — a re-type is reversible and loses no
-- history). A light read: one day of refinery rows through the
-- (facility_type, facility_id, period) unique index, joined by primary key
-- to the 650-row refineries table. SECURITY INVOKER; service role only, like
-- refinery_type_coverage.
--
-- WHY (2) · firms_rule_coverage WAS CALLABLE WITH THE PUBLIC ANON KEY.
-- Migration 084 ran REVOKE ALL … FROM PUBLIC and GRANT … TO service_role.
-- Supabase grants EXECUTE on new public functions to anon and authenticated
-- by name (default privileges), so revoking PUBLIC removed nothing: on
-- 2026-09-19 pg_proc.proacl read
--   {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- It is SECURITY DEFINER, so /rest/v1/rpc/firms_rule_coverage answered the
-- anon key directly.
--
-- CALLERS (git grep 'firms_rule_coverage' on origin/main 8f599fe). One:
--   lib/notifications/firms-proximity.ts getRuleCoverage(), called only by
--   app/api/notifications/rules/route.ts POST with `admin =
--   createServerSupabase()` — the service-role client. No browser code, no
--   createServerSupabaseWithAuth caller, no SQL function, no worker under
--   services/ calls it. lib/marketing/watched-coverage.ts read it before 168
--   (service role) and reads refinery_type_coverage now. Nothing that runs as
--   anon or authenticated depends on the grant, so it is removed.
--
-- NOT TOUCHED, deliberately. firms_match_facility_alerts (084, also SECURITY
-- DEFINER, same anon/authenticated grants, only caller the service-role
-- cron) is in the "SECURITY DEFINER readers" list migration 143 left to the
-- founder as a tier-gating decision; this file does not pre-empt it.
--
-- Idempotent: CREATE OR REPLACE, and REVOKE / GRANT are no-ops when already
-- in force. No table is written.
--
-- Guard script: supabase/tests/tp2_guards.sql (BEGIN … ROLLBACK; pass signal
-- is its final result row).

BEGIN;

-- ─── 1 · the thermal roster, crude-oil refineries only ─────────────────────
CREATE OR REPLACE FUNCTION public.refinery_roster_rows(p_period date)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
    FROM public.firms_facility_observations o
    JOIN public.refineries f ON f.id = o.facility_id
   WHERE o.facility_type = 'refinery'
     AND o.period = p_period
     AND f.site_type = 'refinery';
$$;

COMMENT ON FUNCTION public.refinery_roster_rows(date) IS
  'Mig 181: firms_facility_observations rows for p_period with facility_type = ''refinery'', restricted to refineries.site_type = ''refinery'' (the 168 population). The /start honesty board "Thermal watch roster" refinery figure (lib/marketing/watched-coverage.ts thermalRefineryRows). NULL period → 0. Service role only.';

REVOKE ALL ON FUNCTION public.refinery_roster_rows(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refinery_roster_rows(date) TO service_role;

-- ─── 2 · firms_rule_coverage: service role only, by role name ──────────────
REVOKE EXECUTE ON FUNCTION public.firms_rule_coverage(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.firms_rule_coverage(text, text, text, jsonb) TO service_role;

COMMIT;

-- ─── VERIFY — ONE SELECT (the SQL Editor shows only the last statement) ────
-- Expected values were measured read-only on production 2026-09-19 (newest
-- derived day 2026-09-19). Rows 5–7 move with the derivation day and with
-- any later re-type or ingest; row 8 is the invariant that matters.
WITH boxes(j) AS (
  SELECT '[{"west":22,"south":44,"east":74,"north":62},{"west":44,"south":22,"east":60,"north":34},{"west":-10,"south":35,"east":22,"north":60},{"west":100,"south":18,"east":146,"north":46},{"west":60,"south":5,"east":100,"north":37},{"west":95,"south":-11,"east":142,"north":20},{"west":-100,"south":24,"east":-52,"north":55},{"west":-130,"south":25,"east":-100,"north":55}]'::jsonb
),
d AS (SELECT max(period) AS day FROM public.firms_facility_observations),
checks(ord, check_name, expected, actual) AS (
  SELECT 1, 'refinery_roster_rows(date) exists · SECURITY DEFINER', 'true · false',
         (SELECT concat_ws(' · ', (count(*) = 1)::text, coalesce(bool_or(p.prosecdef)::text, 'absent'))
            FROM pg_proc p WHERE p.oid = to_regprocedure('public.refinery_roster_rows(date)'))
  UNION ALL
  SELECT 2, 'refinery_roster_rows EXECUTE: service_role · anon · authenticated', 'true · false · false',
         concat_ws(' · ',
           has_function_privilege('service_role',  'public.refinery_roster_rows(date)', 'EXECUTE')::text,
           has_function_privilege('anon',          'public.refinery_roster_rows(date)', 'EXECUTE')::text,
           has_function_privilege('authenticated', 'public.refinery_roster_rows(date)', 'EXECUTE')::text)
  UNION ALL
  SELECT 3, 'firms_rule_coverage EXECUTE: service_role · anon · authenticated', 'true · false · false',
         concat_ws(' · ',
           has_function_privilege('service_role',  'public.firms_rule_coverage(text, text, text, jsonb)', 'EXECUTE')::text,
           has_function_privilege('anon',          'public.firms_rule_coverage(text, text, text, jsonb)', 'EXECUTE')::text,
           has_function_privilege('authenticated', 'public.firms_rule_coverage(text, text, text, jsonb)', 'EXECUTE')::text)
  UNION ALL
  SELECT 4, 'firms_rule_coverage still SECURITY DEFINER (definition untouched)', 'true',
         (SELECT p.prosecdef::text FROM pg_proc p
           WHERE p.oid = to_regprocedure('public.firms_rule_coverage(text, text, text, jsonb)'))
  UNION ALL
  SELECT 5, 'newest derived day', '2026-09-19 (or later)', (SELECT day::text FROM d)
  UNION ALL
  SELECT 6, 'refinery-tagged roster rows on that day (the old /start figure)', '449',
         (SELECT count(*)::text FROM public.firms_facility_observations o, d
           WHERE o.facility_type = 'refinery' AND o.period = d.day)
  UNION ALL
  SELECT 7, 'refinery_roster_rows(newest day) (the new /start figure)', '353',
         (SELECT public.refinery_roster_rows(day)::text FROM d)
  UNION ALL
  SELECT 8, 'roster = refinery_type_coverage watched (the homepage figure)', 'true (353 = 353)',
         (SELECT concat((public.refinery_roster_rows(d.day) = c.watched_refineries)::text,
                        ' (', public.refinery_roster_rows(d.day), ' = ', c.watched_refineries, ')')
            FROM d, public.refinery_type_coverage((SELECT j FROM boxes)) c)
  UNION ALL
  SELECT 9, 'refinery_roster_rows(NULL)', '0', public.refinery_roster_rows(NULL)::text
  UNION ALL
  SELECT 10, 'firms_match_facility_alerts EXECUTE anon · authenticated (NOT changed here — founder tier-gating item, mig 143)', 'true · true',
         concat_ws(' · ',
           has_function_privilege('anon',          'public.firms_match_facility_alerts(text, text, text, numeric, numeric, integer, date, jsonb, integer)', 'EXECUTE')::text,
           has_function_privilege('authenticated', 'public.firms_match_facility_alerts(text, text, text, numeric, numeric, integer, date, jsonb, integer)', 'EXECUTE')::text)
)
SELECT ord, check_name, expected, actual FROM checks ORDER BY ord;
