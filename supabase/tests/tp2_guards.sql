-- TP-2 guard tests · refinery_roster_rows + firms_rule_coverage grants (mig 181)
--
-- Run in the Supabase SQL Editor AFTER applying 181, the whole file. It wraps
-- itself in BEGIN … ROLLBACK, so the two refineries.site_type flips it makes
-- to prove assertion 3 are undone. The first FAIL raises and aborts the file
-- (nothing is left behind).
--
-- PASS SIGNAL: the editor's result pane shows ONE row,
--   result = 'TP-2 guards: all 7 assertions passed (0–6) …'
-- It is the file's last statement and is reached only when no assertion
-- raised; any failure shows the FAIL error instead and no row. The NOTICE
-- lines (one PASS per assertion) are the detail, if the editor shows them.
--
-- What each test proves, and what would make it fail:
--   0  refinery_roster_rows(date) exists, SECURITY INVOKER   (181 not applied)
--   1  both functions are service_role only, by role name; firms_rule_coverage
--      is still SECURITY DEFINER                            (grants lost / wrong)
--   2  on the newest derived day the roster equals the refinery-tagged rows
--      minus the re-typed ones, and there are re-typed rows to exclude
--                                                           (filter lost)
--   3  re-typing a roster refinery to 'terminal' is exactly -1; re-typing a
--      re-typed roster site back to 'refinery' is exactly +1 (the figure
--      follows site_type, not a snapshot)
--   4  NULL day and a day with no rows both read 0          (NULL leak)
--   5  /start and the homepage agree: roster = refinery_type_coverage()
--      watched on the newest day                            (populations drift)
--   6  a refinery country rule resolves: firms_rule_coverage('refinery',
--      'Russia', …) matches and is monitored; an ISO code ('RU') matches 0 —
--      the claims the corrected rule-creation hint makes (route.ts)

BEGIN;

-- 0 · existence
DO $$
BEGIN
  IF to_regprocedure('public.refinery_roster_rows(date)') IS NULL THEN
    RAISE EXCEPTION 'FAIL 0 · public.refinery_roster_rows(date) is missing — apply 181 first';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('public.refinery_roster_rows(date)')) THEN
    RAISE EXCEPTION 'FAIL 0 · refinery_roster_rows is SECURITY DEFINER (want INVOKER)';
  END IF;
  RAISE NOTICE 'PASS 0 · refinery_roster_rows(date) exists, SECURITY INVOKER';
END
$$;

-- 1 · grants, by role name (REVOKE FROM PUBLIC alone removes nothing on Supabase)
DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.refinery_roster_rows(date)',
                           'public.firms_rule_coverage(text, text, text, jsonb)'] LOOP
    IF NOT has_function_privilege('service_role', f, 'EXECUTE')
       OR has_function_privilege('anon', f, 'EXECUTE')
       OR has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL 1 · % EXECUTE: service_role %, anon %, authenticated % (want true, false, false)',
        f, has_function_privilege('service_role', f, 'EXECUTE'),
        has_function_privilege('anon', f, 'EXECUTE'), has_function_privilege('authenticated', f, 'EXECUTE');
    END IF;
  END LOOP;
  IF NOT (SELECT prosecdef FROM pg_proc
           WHERE oid = to_regprocedure('public.firms_rule_coverage(text, text, text, jsonb)')) THEN
    RAISE EXCEPTION 'FAIL 1 · firms_rule_coverage is no longer SECURITY DEFINER (181 must not change its definition)';
  END IF;
  RAISE NOTICE 'PASS 1 · refinery_roster_rows and firms_rule_coverage: service_role only; firms_rule_coverage still SECURITY DEFINER';
END
$$;

-- 2 · identity on the newest derived day
DO $$
DECLARE
  d date;
  roster int; tagged int; retyped int;
BEGIN
  SELECT max(period) INTO d FROM public.firms_facility_observations;
  roster := public.refinery_roster_rows(d);
  SELECT count(*) INTO tagged
    FROM public.firms_facility_observations o
   WHERE o.facility_type = 'refinery' AND o.period = d;
  SELECT count(*) INTO retyped
    FROM public.firms_facility_observations o
    JOIN public.refineries f ON f.id = o.facility_id
   WHERE o.facility_type = 'refinery' AND o.period = d AND f.site_type <> 'refinery';
  IF roster IS DISTINCT FROM tagged - retyped OR roster < 1 OR retyped < 1 THEN
    RAISE EXCEPTION 'FAIL 2 · day %: refinery_roster_rows % is not tagged % minus re-typed % (want roster >= 1 and re-typed >= 1)',
      d, roster, tagged, retyped;
  END IF;
  RAISE NOTICE 'PASS 2 · day %: roster % = % refinery-tagged rows minus % re-typed', d, roster, tagged, retyped;
END
$$;

-- 3 · the figure follows site_type (both flips rolled back with the file)
DO $$
DECLARE
  d date;
  r0 int; r1 int; r2 int;
  crude_id text; retyped_id text; retyped_was text;
BEGIN
  SELECT max(period) INTO d FROM public.firms_facility_observations;
  r0 := public.refinery_roster_rows(d);

  SELECT f.id INTO crude_id
    FROM public.firms_facility_observations o
    JOIN public.refineries f ON f.id = o.facility_id
   WHERE o.facility_type = 'refinery' AND o.period = d AND f.site_type = 'refinery'
   ORDER BY f.id LIMIT 1;
  UPDATE public.refineries SET site_type = 'terminal' WHERE id = crude_id;
  r1 := public.refinery_roster_rows(d);
  UPDATE public.refineries SET site_type = 'refinery' WHERE id = crude_id;
  IF r1 - r0 IS DISTINCT FROM -1 THEN
    RAISE EXCEPTION 'FAIL 3 · re-typing % to terminal moved the roster by % (want -1)', crude_id, r1 - r0;
  END IF;

  SELECT f.id, f.site_type INTO retyped_id, retyped_was
    FROM public.firms_facility_observations o
    JOIN public.refineries f ON f.id = o.facility_id
   WHERE o.facility_type = 'refinery' AND o.period = d AND f.site_type <> 'refinery'
   ORDER BY f.id LIMIT 1;
  UPDATE public.refineries SET site_type = 'refinery' WHERE id = retyped_id;
  r2 := public.refinery_roster_rows(d);
  UPDATE public.refineries SET site_type = retyped_was WHERE id = retyped_id;
  IF r2 - r0 IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'FAIL 3 · re-typing % (%) back to refinery moved the roster by % (want +1)', retyped_id, retyped_was, r2 - r0;
  END IF;

  RAISE NOTICE 'PASS 3 · % → terminal: -1; % (%) → refinery: +1', crude_id, retyped_id, retyped_was;
END
$$;

-- 4 · no NULL leak
DO $$
BEGIN
  IF public.refinery_roster_rows(NULL) IS DISTINCT FROM 0
     OR public.refinery_roster_rows(DATE '1900-01-01') IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FAIL 4 · refinery_roster_rows(NULL) %, (1900-01-01) % (want 0, 0)',
      public.refinery_roster_rows(NULL), public.refinery_roster_rows(DATE '1900-01-01');
  END IF;
  RAISE NOTICE 'PASS 4 · NULL day 0, empty day 0';
END
$$;

-- 5 · /start roster = homepage watched, over the deployed FIRMS boxes
--     (lib/firms/client.ts FIRMS_REGIONS, ru-ua east 74)
DO $$
DECLARE
  boxes constant jsonb := '[{"west":22,"south":44,"east":74,"north":62},{"west":44,"south":22,"east":60,"north":34},{"west":-10,"south":35,"east":22,"north":60},{"west":100,"south":18,"east":146,"north":46},{"west":60,"south":5,"east":100,"north":37},{"west":95,"south":-11,"east":142,"north":20},{"west":-100,"south":24,"east":-52,"north":55},{"west":-130,"south":25,"east":-100,"north":55}]';
  d date; roster int; watched int; registry int;
BEGIN
  SELECT max(period) INTO d FROM public.firms_facility_observations;
  roster := public.refinery_roster_rows(d);
  SELECT watched_refineries, registry_refineries INTO watched, registry
    FROM public.refinery_type_coverage(boxes);
  IF roster IS DISTINCT FROM watched THEN
    RAISE EXCEPTION 'FAIL 5 · day %: /start roster % <> homepage watched % (registry %). If an OSM ingest or a re-type landed after the day''s last FIRMS derivation, re-run this file after the next hourly FIRMS run; otherwise the two populations have drifted',
      d, roster, watched, registry;
  END IF;
  RAISE NOTICE 'PASS 5 · day %: /start roster % = homepage watched % (of % crude-oil refineries)', d, roster, watched, registry;
END
$$;

-- 6 · a refinery country rule resolves (English name), an ISO code does not
DO $$
DECLARE
  boxes constant jsonb := '[{"west":22,"south":44,"east":74,"north":62},{"west":44,"south":22,"east":60,"north":34},{"west":-10,"south":35,"east":22,"north":60},{"west":100,"south":18,"east":146,"north":46},{"west":60,"south":5,"east":100,"north":37},{"west":95,"south":-11,"east":142,"north":20},{"west":-100,"south":24,"east":-52,"north":55},{"west":-130,"south":25,"east":-100,"north":55}]';
  mat int; mon int; iso_mat int;
BEGIN
  SELECT matching_facilities, monitored_facilities INTO mat, mon
    FROM public.firms_rule_coverage('refinery', 'Russia', NULL, boxes);
  SELECT matching_facilities INTO iso_mat
    FROM public.firms_rule_coverage('refinery', 'RU', NULL, boxes);
  IF mat < 1 OR mon < 1 OR iso_mat IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FAIL 6 · refinery + Russia: matching %, monitored % (want >= 1 each); refinery + RU matching % (want 0)',
      mat, mon, iso_mat;
  END IF;
  RAISE NOTICE 'PASS 6 · refinery + Russia: % matching, % monitored; refinery + RU: 0', mat, mon;
END
$$;

ROLLBACK;

-- Reached only when no assertion above raised. This row is the pass signal.
SELECT 'TP-2 guards: all 7 assertions passed (0–6: roster function, service_role-only grants, site_type-only roster, follows re-types, no NULL leak, /start roster = homepage watched, refinery country rule resolves); transaction rolled back, nothing written' AS result,
       now() AS checked_at;
