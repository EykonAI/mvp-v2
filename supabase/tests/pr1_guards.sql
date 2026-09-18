-- ═══════════════════════════════════════════════════════════════════════
-- eYKON.ai — Reality Check PR-1 · guard tests (migrations 159, 160, 161)
--
-- HOW TO RUN: after applying 159, 160 and 161, paste this WHOLE file into
-- the Supabase SQL Editor and run it (not "Run selected"). It changes
-- nothing: it runs inside BEGIN … ROLLBACK, and every write it makes is
-- also undone by its own exception block, so nothing persists even if the
-- editor did not honour the transaction.
--
-- WHAT YOU SEE
--   * One NOTICE per assertion: "PASS <id> <what>" or "FAIL <id> <what> — <detail>".
--   * The last NOTICE reads "PR-1 guards: <n> of <n> assertions passed".
--   * If every assertion passes, the last statement returns ONE ROW
--     ("PR-1 guards: all assertions passed …"). Paste it back with the notices.
--   * If any assertion fails, the script stops with an ERROR that lists the
--     failed ids — and the result row never appears. That is the signal.
--
-- Each guard assertion names the constraint (or view predicate, or rule)
-- that must produce it, and fails if that guard is removed. Existence
-- assertions run first. The five guards are build prompt §3.2:
--   G1 means manufacture collapses        G2 thin nights enter baselines
--   G3 a baseline spanning two regimes     G4 low baseline heat as "heat steady"
--   G5 co-located sites / keys that do not survive a refresh
-- plus W (run parameters, D-5/D-6) and S (every D-2 state is representable:
-- silence is not a verdict, and it must be writable).
--
-- The KS numbers in G3 come from apps/web/lib/intel/ks.ts (ksStatistic,
-- ksPValue) — the only KS in the codebase — for the stated series:
--   4x step, 16 baseline nights (8 x 100 then 8 x 400): halves D = 1,
--     n1 = n2 = 8, p = 0.000156
--   stable control, 16 nights 95..105: D = 0.125, p = 0.99999948
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

DO $guards$
DECLARE
  r_results jsonb := '[]'::jsonb;   -- [{id, what, ok, detail}] in run order
  v_ok      boolean;
  v_detail  text;
  v_n       integer;
  v_txt     text;
  v_key     text;
  v_members text[];
  v_base    jsonb;
  v_sql_ins text;
  v_got     text;
  v_state   text;
  v_con     text;
  v_msg     text;
  v_robust  boolean;
  v_overlap boolean;
  v_ratio   numeric;
  v_map0    text;
  v_map1    text;
  v_map2    text;
  v_res1    jsonb;
  v_res2    jsonb;
  v_runs0   integer;
  v_runs1   integer;
  t         record;
  r         record;
  v_failed  text[] := '{}';
  v_total   integer := 0;
BEGIN
  -- ═══ E · existence first ═══════════════════════════════════════════
  FOR t IN
    SELECT * FROM (VALUES
      ('E01', 'table sensor_night_census',            to_regclass('public.sensor_night_census') IS NOT NULL),
      ('E02', 'table sensor_night_census_runs',       to_regclass('public.sensor_night_census_runs') IS NOT NULL),
      ('E03', 'view sensor_usable_nights',            to_regclass('public.sensor_usable_nights') IS NOT NULL),
      ('E04', 'function refresh_sensor_night_census(boolean)',
                                                       to_regprocedure('public.refresh_sensor_night_census(boolean)') IS NOT NULL),
      ('E05', 'table refinery_complexes',             to_regclass('public.refinery_complexes') IS NOT NULL),
      ('E06', 'table refinery_complex_members',       to_regclass('public.refinery_complex_members') IS NOT NULL),
      ('E07', 'table refinery_complex_runs',          to_regclass('public.refinery_complex_runs') IS NOT NULL),
      ('E08', 'function rebuild_refinery_complexes()', to_regprocedure('public.rebuild_refinery_complexes()') IS NOT NULL),
      ('E09', 'trigger refinery_complexes_frozen',
              EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'refinery_complexes_frozen' AND NOT tgisinternal)),
      ('E10', 'table reality_check_runs',             to_regclass('public.reality_check_runs') IS NOT NULL),
      ('E11', 'table reality_check_site_verdicts',    to_regclass('public.reality_check_site_verdicts') IS NOT NULL),
      ('E12', 'view refinery_complex_light_nights',   to_regclass('public.refinery_complex_light_nights') IS NOT NULL),
      ('E13', 'view refinery_complex_heat_days',      to_regclass('public.refinery_complex_heat_days') IS NOT NULL),
      ('E14', 'primary key (run_id, cluster_key) on reality_check_site_verdicts',
              EXISTS (SELECT 1 FROM pg_constraint c
                       WHERE c.conrelid = to_regclass('public.reality_check_site_verdicts') AND c.contype = 'p'
                         AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
                                FROM pg_attribute a
                               WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey))
                             = ARRAY['cluster_key', 'run_id'])),
      ('E15', 'guard constraints present in pg_constraint (8 named)',
              (SELECT count(*) FROM pg_constraint WHERE conname IN (
                 'snc_usable_needs_roster_floor', 'snc_status_follows_numbers',
                 'rfc_key_matches_cell', 'rcsv_night_floors',
                 'rcsv_heat_steady_needs_observable_baseline', 'rcsv_ks_failure_forces_void',
                 'rcr_window_arithmetic', 'rcr_method_pinned')) = 8),
      ('E16', 'pg_cron job refresh-sensor-night-census active',
              EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-sensor-night-census' AND active)),
      ('E17', 'pg_cron job rebuild-refinery-complexes active',
              EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rebuild-refinery-complexes' AND active)),
      ('E18', 'writing functions not executable by anon/authenticated',
              NOT has_function_privilege('anon', 'public.refresh_sensor_night_census(boolean)', 'EXECUTE')
              AND NOT has_function_privilege('authenticated', 'public.refresh_sensor_night_census(boolean)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.rebuild_refinery_complexes()', 'EXECUTE')
              AND NOT has_function_privilege('authenticated', 'public.rebuild_refinery_complexes()', 'EXECUTE'))
    ) AS e(id, what, ok)
  LOOP
    r_results := r_results || jsonb_build_object('id', t.id, 'what', t.what, 'ok', coalesce(t.ok, false), 'detail', NULL);
  END LOOP;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(r_results) x WHERE NOT (x->>'ok')::boolean) THEN
    FOR r IN SELECT x->>'id' AS id, x->>'what' AS what, (x->>'ok')::boolean AS ok FROM jsonb_array_elements(r_results) x LOOP
      RAISE NOTICE '% % %', CASE WHEN r.ok THEN 'PASS' ELSE 'FAIL' END, r.id, r.what;
    END LOOP;
    RAISE EXCEPTION 'PR-1 guards: objects missing — apply 159, 160 and 161 (whole files) first. Failed: %',
      (SELECT string_agg(x->>'id', ', ') FROM jsonb_array_elements(r_results) x WHERE NOT (x->>'ok')::boolean);
  END IF;

  -- ═══ G1 · means manufacture collapses: medians only, no avg( ════════
  SELECT string_agg(o.name, ', ') INTO v_txt
    FROM (VALUES
      ('sensor_usable_nights',          pg_get_viewdef('public.sensor_usable_nights'::regclass, true)),
      ('refinery_complex_light_nights', pg_get_viewdef('public.refinery_complex_light_nights'::regclass, true)),
      ('refinery_complex_heat_days',    pg_get_viewdef('public.refinery_complex_heat_days'::regclass, true)),
      ('refresh_sensor_night_census',   pg_get_functiondef('public.refresh_sensor_night_census(boolean)'::regprocedure)),
      ('rebuild_refinery_complexes',    pg_get_functiondef('public.rebuild_refinery_complexes()'::regprocedure))
    ) AS o(name, def)
   WHERE o.def ~* '\mavg\s*\(' OR o.def ~* '\mmean\s*\(';
  r_results := r_results || jsonb_build_object('id', 'G1.1',
    'what', 'no avg( / mean( in any PR-1 view or function in the classifier path',
    'ok', v_txt IS NULL, 'detail', v_txt);

  SELECT string_agg(table_name || '.' || column_name, ', ') INTO v_txt
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name IN ('reality_check_site_verdicts', 'refinery_complex_light_nights', 'refinery_complex_heat_days')
     AND column_name ~* '(mean|avg|average)';
  r_results := r_results || jsonb_build_object('id', 'G1.2',
    'what', 'no mean/avg column on the verdict table or the classifier views',
    'ok', v_txt IS NULL, 'detail', v_txt);

  SELECT string_agg(column_name, ', ' ORDER BY column_name) INTO v_txt
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'refinery_complex_light_nights'
     AND column_name ~* 'radiance';
  r_results := r_results || jsonb_build_object('id', 'G1.3',
    'what', 'the light view exposes radiance only as per-night medians (radiance_3x3_median, radiance_median)',
    'ok', v_txt = 'radiance_3x3_median, radiance_median', 'detail', v_txt);

  -- ═══ G2 · thin or incomplete nights: the census ═════════════════════
  SELECT count(*), string_agg(facility_type || ' ' || status || ' ' || rows_present || '/' || coalesce(roster_size::text, '?'), '; ')
    INTO v_n, v_txt
    FROM public.sensor_night_census
   WHERE sensor = 'blackmarble' AND night = DATE '2026-07-17';
  r_results := r_results || jsonb_build_object('id', 'G2.1',
    'what', '2026-07-17 is classified for both facility types as permanently_partial',
    'ok', v_n = 2 AND NOT EXISTS (SELECT 1 FROM public.sensor_night_census
                                   WHERE sensor = 'blackmarble' AND night = DATE '2026-07-17'
                                     AND (usable OR status <> 'permanently_partial')),
    'detail', v_txt);

  SELECT count(*) INTO v_n
    FROM public.sensor_usable_nights
   WHERE sensor = 'blackmarble' AND night = DATE '2026-07-17';
  r_results := r_results || jsonb_build_object('id', 'G2.2',
    'what', '2026-07-17 is absent from sensor_usable_nights (the join the classifier reads)',
    'ok', v_n = 0, 'detail', v_n || ' usable rows');

  SELECT coverage_ratio::text INTO v_txt
    FROM public.sensor_night_census
   WHERE sensor = 'blackmarble' AND facility_type = 'power_plant' AND night = DATE '2026-07-17';
  r_results := r_results || jsonb_build_object('id', 'G2.3',
    'what', 'the 0.95 floor is load-bearing: 07-17 power ratio sits in [0.90, 0.95), so 0.90 would admit it',
    'ok', v_txt IS NOT NULL AND v_txt::numeric >= 0.90 AND v_txt::numeric < 0.95, 'detail', 'ratio ' || coalesce(v_txt, 'none'));

  v_got := 'accepted'; v_state := NULL; v_con := NULL;
  BEGIN
    UPDATE public.sensor_night_census
       SET usable = true, status = 'usable'
     WHERE sensor = 'blackmarble' AND facility_type = 'refinery' AND night = DATE '2026-07-17';
    RAISE EXCEPTION 'rc_guard_undo';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_con = CONSTRAINT_NAME, v_msg = MESSAGE_TEXT;
    IF v_msg <> 'rc_guard_undo' THEN v_got := 'rejected by ' || coalesce(nullif(v_con, ''), 'sqlstate ' || v_state); END IF;
  END;
  r_results := r_results || jsonb_build_object('id', 'G2.4',
    'what', 'marking 07-17 usable by hand is rejected by snc_usable_needs_roster_floor',
    'ok', v_con = 'snc_usable_needs_roster_floor', 'detail', v_got);

  SELECT string_agg(to_char(night, 'MM-DD') || ' ' || status, ', ' ORDER BY night) INTO v_txt
    FROM public.sensor_night_census
   WHERE sensor = 'blackmarble' AND facility_type = 'refinery'
     AND night IN (DATE '2026-07-10', DATE '2026-07-11', DATE '2026-07-12', DATE '2026-07-13', DATE '2026-07-14',
                   DATE '2026-07-15', DATE '2026-07-16', DATE '2026-07-17', DATE '2026-07-26', DATE '2026-08-03',
                   DATE '2026-08-04', DATE '2026-08-05', DATE '2026-08-06');
  r_results := r_results || jsonb_build_object('id', 'G2.5',
    'what', 'the 9 zero nights are permanently_empty and the 4 partial nights (07-10, 07-17, 08-03, 08-06) permanently_partial — classified, none usable',
    'ok', (SELECT count(*) FROM public.sensor_night_census
            WHERE sensor = 'blackmarble' AND facility_type = 'refinery' AND NOT usable AND status = 'permanently_empty'
              AND night IN (DATE '2026-07-11', DATE '2026-07-12', DATE '2026-07-13', DATE '2026-07-14', DATE '2026-07-15',
                            DATE '2026-07-16', DATE '2026-07-26', DATE '2026-08-04', DATE '2026-08-05')) = 9
          AND (SELECT count(*) FROM public.sensor_night_census
            WHERE sensor = 'blackmarble' AND facility_type = 'refinery' AND NOT usable AND status = 'permanently_partial'
              AND night IN (DATE '2026-07-10', DATE '2026-07-17', DATE '2026-08-03', DATE '2026-08-06')) = 4,
    'detail', v_txt);

  SELECT string_agg(o.name, ', ') INTO v_txt
    FROM (VALUES ('reads ok',          pg_get_functiondef('public.refresh_sensor_night_census(boolean)'::regprocedure) ~* '\mok\M'),
                 ('trailing window (OVER)', pg_get_functiondef('public.refresh_sensor_night_census(boolean)'::regprocedure) ~* '\mover\s*\(')
         ) AS o(name, hit)
   WHERE o.hit;
  r_results := r_results || jsonb_build_object('id', 'G2.6',
    'what', 'the census never reads blackmarble_ingest_runs.ok and uses no trailing-maximum window',
    'ok', v_txt IS NULL, 'detail', v_txt);

  SELECT count(*) INTO v_n
    FROM public.sensor_night_census
   WHERE (sensor = 'blackmarble' AND status = 'pending' AND night < current_date - 16)
      OR (sensor = 'firms'       AND status = 'pending' AND night < current_date - 3);
  r_results := r_results || jsonb_build_object('id', 'G2.7',
    'what', 'a Black Marble night still incomplete after night+15 is recorded as permanent, not pending (FIRMS: after night+2)',
    'ok', v_n = 0, 'detail', v_n || ' stale pending rows');

  SELECT count(*) INTO v_runs0 FROM public.sensor_night_census_runs;
  v_detail := NULL;
  BEGIN
    PERFORM public.refresh_sensor_night_census(false);
    SELECT count(*) INTO v_runs1 FROM public.sensor_night_census_runs;
    RAISE EXCEPTION 'rc_guard_undo';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg <> 'rc_guard_undo' THEN v_detail := v_msg; END IF;
  END;
  r_results := r_results || jsonb_build_object('id', 'G2.8',
    'what', 'a census refresh writes its run record even when nothing changes',
    'ok', v_detail IS NULL AND v_runs1 = v_runs0 + 1, 'detail', coalesce(v_detail, v_runs0 || ' -> ' || v_runs1));

  -- ═══ fixtures for the verdict table ══════════════════════════════════
  -- A real, minted refinery complex (the verdict FK demands one) and a
  -- valid REFUTED row every case below modifies in exactly one respect.
  SELECT c.cluster_key INTO v_key
    FROM public.refinery_complexes c
   WHERE c.retired_at IS NULL
   ORDER BY c.cluster_key
   LIMIT 1;
  SELECT array_agg(m.facility_id ORDER BY m.facility_id) INTO v_members
    FROM public.refinery_complex_members m
   WHERE m.cluster_key = v_key AND m.left_at IS NULL;

  v_base := jsonb_build_object(
    'cluster_key', v_key, 'members', to_jsonb(v_members), 'member_count', cardinality(v_members),
    'verdict', 'REFUTED', 'coverage_state', 'OBSERVED',
    'baseline_nights', 16, 'window_nights', 5,
    'baseline_median', 99.5, 'window_median', 98, 'baseline_min', 95, 'baseline_max', 105,
    'window_min', 96, 'window_max', 101,
    'r3_baseline_nights', 16, 'r3_window_nights', 5, 'r3_baseline_median', 99.0, 'r3_window_median', 97.0,
    'robustness_verdict', 'REFUTED',
    'baseline_firms_days', 20, 'baseline_heat_days', 10, 'window_firms_days', 15, 'window_heat_days', 2,
    'heat_state', 'HEAT_DOWN',
    'ks_tested', true, 'ks_d', 0.125, 'ks_p', 0.99999948);

  v_sql_ins :=
    'WITH r AS (INSERT INTO public.reality_check_runs (data_clock_night, window_start, window_end, baseline_start, baseline_end)
                VALUES (DATE ''2026-09-01'', DATE ''2026-08-18'', DATE ''2026-09-01'', DATE ''2026-07-18'', DATE ''2026-08-17'')
                RETURNING id)
     INSERT INTO public.reality_check_site_verdicts
       (run_id, cluster_key, members, member_count, verdict, coverage_state,
        baseline_nights, window_nights, baseline_median, window_median, baseline_min, baseline_max, window_min, window_max,
        r3_baseline_nights, r3_window_nights, r3_baseline_median, r3_window_median, robustness_verdict,
        baseline_firms_days, baseline_heat_days, window_firms_days, window_heat_days, heat_state,
        ks_tested, ks_d, ks_p)
     SELECT r.id, x.cluster_key, x.members, x.member_count, x.verdict, x.coverage_state,
            x.baseline_nights, x.window_nights, x.baseline_median, x.window_median, x.baseline_min, x.baseline_max,
            x.window_min, x.window_max,
            x.r3_baseline_nights, x.r3_window_nights, x.r3_baseline_median, x.r3_window_median, x.robustness_verdict,
            x.baseline_firms_days, x.baseline_heat_days, x.window_firms_days, x.window_heat_days, x.heat_state,
            x.ks_tested, x.ks_d, x.ks_p
       FROM r, jsonb_populate_record(NULL::public.reality_check_site_verdicts, $1) AS x
     RETURNING robust_to_retrieval, distributions_overlap, light_ratio';

  -- expect: 'accepted', or a regex of the constraint name(s) that must reject
  FOR t IN
    SELECT * FROM (VALUES
      -- ── G3 · a baseline spanning two regimes ────────────────────────
      ('G3.1', 'synthetic refinery series, 4x step at mid-baseline (D = 1, p = 0.000156), labelled REFUTED, is refused at insert',
       '{"baseline_median":250,"baseline_min":100,"baseline_max":400,"window_median":240,"window_min":230,"window_max":250,
         "r3_baseline_median":250,"r3_window_median":240,"ks_d":1,"ks_p":0.000156}'::jsonb,
       'rcsv_ks_failure_forces_void', NULL::boolean, NULL::boolean),
      ('G3.2', 'the same 4x-step series is writable as VOID_BASELINE_UNSTABLE (silence is representable)',
       '{"verdict":"VOID_BASELINE_UNSTABLE","robustness_verdict":null,
         "baseline_median":250,"baseline_min":100,"baseline_max":400,"window_median":240,"window_min":230,"window_max":250,
         "r3_baseline_median":250,"r3_window_median":240,"ks_d":1,"ks_p":0.000156}'::jsonb,
       'accepted', NULL, NULL),
      ('G3.3', 'positive control: the stable series (D = 0.125, p = 0.99999948) labelled REFUTED is accepted',
       '{}'::jsonb, 'accepted', true, NULL),
      ('G3.4', 'VOID_BASELINE_UNSTABLE without a failed test (p = 0.5) is refused',
       '{"verdict":"VOID_BASELINE_UNSTABLE","robustness_verdict":null,"ks_d":0.3,"ks_p":0.5}'::jsonb,
       'rcsv_unstable_needs_failed_test', NULL, NULL),
      ('G3.5', 'a LEAD on 10 baseline nights (KS not run) is refused — below 12 nights: REFUTED or STEADY, never LEAD',
       '{"verdict":"LEAD","robustness_verdict":"LEAD","baseline_nights":10,"r3_baseline_nights":10,
         "window_median":40,"window_min":35,"window_max":45,"r3_window_median":40,
         "ks_tested":false,"ks_d":null,"ks_p":null}'::jsonb,
       'rcsv_lead_needs_ks_test', NULL, NULL),
      -- ── G4 · low baseline heat labelled "heat steady" ──────────────
      ('G4.1', 'a 0.15-baseline row (3 of 20 FIRMS days) labelled HEAT_STEADY is refused',
       '{"verdict":"STEADY","robustness_verdict":"STEADY","heat_state":"HEAT_STEADY",
         "baseline_heat_days":3,"window_heat_days":2}'::jsonb,
       'rcsv_heat_steady_needs_observable_baseline', NULL, NULL),
      ('G4.2', 'the floor is exclusive: exactly 0.20 (4 of 20) labelled HEAT_STEADY is refused',
       '{"verdict":"STEADY","robustness_verdict":"STEADY","heat_state":"HEAT_STEADY",
         "baseline_heat_days":4,"window_heat_days":2}'::jsonb,
       'rcsv_heat_steady_needs_observable_baseline', NULL, NULL),
      ('G4.3', 'positive control: 0.25 (5 of 20) labelled HEAT_STEADY is accepted',
       '{"verdict":"STEADY","robustness_verdict":"STEADY","heat_state":"HEAT_STEADY",
         "baseline_heat_days":5,"window_heat_days":3}'::jsonb,
       'accepted', true, NULL),
      ('G4.4', 'the 0.15-baseline row is writable as VOID_HEAT_NOT_OBSERVABLE',
       '{"verdict":"VOID_HEAT_NOT_OBSERVABLE","robustness_verdict":null,"heat_state":"HEAT_NOT_OBSERVABLE",
         "baseline_heat_days":3,"window_heat_days":2}'::jsonb,
       'accepted', NULL, NULL),
      ('G4.5', 'an observable baseline (0.50) cannot hide as HEAT_NOT_OBSERVABLE',
       '{"verdict":"VOID_HEAT_NOT_OBSERVABLE","robustness_verdict":null,"heat_state":"HEAT_NOT_OBSERVABLE"}'::jsonb,
       'rcsv_heat_state_follows_rates', NULL, NULL),
      -- ── floors, and silence ─────────────────────────────────────────
      ('S1', 'a STEADY row on 4 baseline nights is refused by a night-floor CHECK',
       '{"verdict":"STEADY","robustness_verdict":"STEADY","heat_state":"HEAT_STEADY","window_heat_days":5,
         "baseline_nights":4,"r3_baseline_nights":4,"ks_tested":false,"ks_d":null,"ks_p":null}'::jsonb,
       'rcsv_(night_floors|coverage_follows_nights|coverage_voids)', NULL, NULL),
      ('S2', 'VOID_INSUFFICIENT_NIGHTS on 2 + 1 nights with ks_* NULL is writable',
       '{"verdict":"VOID_INSUFFICIENT_NIGHTS","coverage_state":"BELOW_FLOOR","robustness_verdict":null,"heat_state":null,
         "baseline_nights":2,"window_nights":1,"baseline_median":99,"baseline_min":98,"baseline_max":100,
         "window_median":97,"window_min":97,"window_max":97,
         "r3_baseline_nights":2,"r3_window_nights":1,"r3_baseline_median":99,"r3_window_median":97,
         "ks_tested":null,"ks_d":null,"ks_p":null}'::jsonb,
       'accepted', NULL, NULL),
      ('S3', 'VOID_NOT_OBSERVED on zero nights (no numbers, no zeros) is writable',
       '{"verdict":"VOID_NOT_OBSERVED","coverage_state":"NOT_OBSERVED","robustness_verdict":null,"heat_state":null,
         "baseline_nights":0,"window_nights":0,"baseline_median":null,"baseline_min":null,"baseline_max":null,
         "window_median":null,"window_min":null,"window_max":null,
         "r3_baseline_nights":0,"r3_window_nights":0,"r3_baseline_median":null,"r3_window_median":null,
         "ks_tested":null,"ks_d":null,"ks_p":null}'::jsonb,
       'accepted', NULL, NULL),
      ('S4', 'STEADY is representable',
       '{"verdict":"STEADY","robustness_verdict":"STEADY","heat_state":"HEAT_STEADY","window_heat_days":5}'::jsonb,
       'accepted', true, NULL),
      ('S5', 'LIGHT_DOWN_ONLY is representable',
       '{"verdict":"LIGHT_DOWN_ONLY","robustness_verdict":"LIGHT_DOWN_ONLY","heat_state":"HEAT_STEADY","window_heat_days":5,
         "window_median":40,"window_min":35,"window_max":45,"r3_window_median":40}'::jsonb,
       'accepted', true, NULL),
      ('S6', 'a REFUTED row whose light is in fact down (0.50 of baseline) is refused by the 0.60 threshold',
       '{"window_median":50,"window_min":45,"window_max":55}'::jsonb,
       'rcsv_light_matches_verdict', NULL, NULL),
      ('S7', 'coverage_state cannot be relabelled: OBSERVED on 2 window nights is refused',
       '{"verdict":"VOID_INSUFFICIENT_NIGHTS","robustness_verdict":null,"window_nights":2,"r3_window_nights":2}'::jsonb,
       'rcsv_coverage_follows_nights', NULL, NULL),
      -- ── D-4 / D-13: the lead and its robustness flag ────────────────
      ('R1', 'Maysan-shaped LEAD (34.37 -> 19.19 on radiance, 103.42 -> 82.48 on 3x3) is accepted, flagged robust_to_retrieval = false, overlap = true',
       '{"verdict":"LEAD","robustness_verdict":"REFUTED",
         "baseline_nights":24,"window_nights":11,"baseline_median":34.37,"baseline_min":12.2,"baseline_max":814.8,
         "window_median":19.19,"window_min":8.0,"window_max":40.8,
         "r3_baseline_nights":24,"r3_window_nights":11,"r3_baseline_median":103.42,"r3_window_median":82.48,
         "baseline_firms_days":31,"baseline_heat_days":20,"window_firms_days":15,"window_heat_days":3,
         "ks_tested":true,"ks_d":0.25,"ks_p":0.4}'::jsonb,
       'accepted', false, true),
      -- ── G5 · a verdict cannot point at an unminted key ─────────────
      ('G5.4', 'a verdict on an unminted key (RFC-S89-W180-999) is refused by the foreign key',
       '{"cluster_key":"RFC-S89-W180-999"}'::jsonb,
       'reality_check_site_verdicts_cluster_key_fkey', NULL, NULL)
    ) AS c(id, what, overrides, expect, want_robust, want_overlap)
  LOOP
    v_got := 'accepted'; v_state := NULL; v_con := NULL; v_msg := NULL;
    v_robust := NULL; v_overlap := NULL; v_ratio := NULL;
    BEGIN
      EXECUTE v_sql_ins INTO v_robust, v_overlap, v_ratio USING (v_base || t.overrides);
      RAISE EXCEPTION 'rc_guard_undo';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_con = CONSTRAINT_NAME, v_msg = MESSAGE_TEXT;
      IF v_msg <> 'rc_guard_undo' THEN
        v_got := 'rejected by ' || coalesce(nullif(v_con, ''), 'sqlstate ' || v_state || ': ' || v_msg);
      ELSE
        v_con := NULL;
      END IF;
    END;
    IF t.expect = 'accepted' THEN
      v_ok := v_got = 'accepted'
              AND (t.want_robust  IS NULL OR v_robust  IS NOT DISTINCT FROM t.want_robust)
              AND (t.want_overlap IS NULL OR v_overlap IS NOT DISTINCT FROM t.want_overlap);
      v_detail := v_got || CASE WHEN v_got = 'accepted'
                               THEN ' (robust_to_retrieval ' || coalesce(v_robust::text, 'null')
                                    || ', distributions_overlap ' || coalesce(v_overlap::text, 'null')
                                    || ', light_ratio ' || coalesce(round(v_ratio, 3)::text, 'null') || ')'
                               ELSE '' END;
    ELSE
      v_ok := v_con IS NOT NULL AND v_con ~ ('^(' || t.expect || ')$');
      v_detail := v_got;
    END IF;
    r_results := r_results || jsonb_build_object('id', t.id, 'what', t.what, 'ok', v_ok, 'detail', v_detail);
  END LOOP;

  -- ═══ G5 · stable complex keys ═══════════════════════════════════════
  SELECT count(*) INTO v_n FROM public.refinery_complexes WHERE retired_at IS NULL;
  r_results := r_results || jsonb_build_object('id', 'G5.1',
    'what', 'every active complex has an RFC- key and at least one current member; every current member has one complex',
    'ok', v_n > 0
          AND NOT EXISTS (SELECT 1 FROM public.refinery_complexes c
                           WHERE c.retired_at IS NULL
                             AND (c.cluster_key !~ '^RFC-[NS][0-9]{2}-[EW][0-9]{3}-[1-9][0-9]*$'
                                  OR NOT EXISTS (SELECT 1 FROM public.refinery_complex_members m
                                                  WHERE m.cluster_key = c.cluster_key AND m.left_at IS NULL)))
          AND NOT EXISTS (SELECT 1 FROM public.refinery_complex_members m
                            JOIN public.refinery_complexes c ON c.cluster_key = m.cluster_key
                           WHERE m.left_at IS NULL AND c.retired_at IS NOT NULL),
    'detail', v_n || ' active complexes (2026-09-18 expectation: 338 over 431 watched refineries)');

  SELECT md5(string_agg(m.facility_id || '=' || m.cluster_key, ',' ORDER BY m.facility_id)) INTO v_map0
    FROM public.refinery_complex_members m WHERE m.left_at IS NULL;
  v_detail := NULL;
  BEGIN
    v_res1 := public.rebuild_refinery_complexes();
    SELECT md5(string_agg(m.facility_id || '=' || m.cluster_key, ',' ORDER BY m.facility_id)) INTO v_map1
      FROM public.refinery_complex_members m WHERE m.left_at IS NULL;
    v_res2 := public.rebuild_refinery_complexes();
    SELECT md5(string_agg(m.facility_id || '=' || m.cluster_key, ',' ORDER BY m.facility_id)) INTO v_map2
      FROM public.refinery_complex_members m WHERE m.left_at IS NULL;
    RAISE EXCEPTION 'rc_guard_undo';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg <> 'rc_guard_undo' THEN v_detail := v_msg; END IF;
  END;
  r_results := r_results || jsonb_build_object('id', 'G5.2',
    'what', 're-running the clustering leaves every existing key unchanged (second rebuild: 0 minted, merged, dissolved, joined, left)',
    'ok', v_detail IS NULL
          AND v_map1 = v_map2
          AND (v_res2->>'minted')::int = 0 AND (v_res2->>'merged')::int = 0 AND (v_res2->>'dissolved')::int = 0
          AND (v_res2->>'members_joined')::int = 0 AND (v_res2->>'members_left')::int = 0,
    'detail', coalesce(v_detail,
              'rebuild #2 ' || coalesce(v_res2::text, 'null')
              || CASE WHEN v_map0 = v_map1 THEN ' · keys identical to before the test'
                      ELSE ' · note: rebuild #1 moved membership (the watched set changed since the last cron run)' END));

  v_got := 'accepted'; v_state := NULL;
  BEGIN
    UPDATE public.refinery_complexes SET centroid_lat = centroid_lat + 0.01 WHERE cluster_key = v_key;
    RAISE EXCEPTION 'rc_guard_undo';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    IF v_msg <> 'rc_guard_undo' THEN v_got := 'rejected: ' || v_msg; END IF;
  END;
  r_results := r_results || jsonb_build_object('id', 'G5.3',
    'what', 'the frozen centroid can never be updated (trigger refinery_complexes_frozen)',
    'ok', v_got LIKE 'rejected: refinery_complexes: the key and frozen centroid%', 'detail', v_got);

  v_got := 'accepted'; v_con := NULL;
  BEGIN
    EXECUTE
      'WITH r AS (INSERT INTO public.reality_check_runs (data_clock_night, window_start, window_end, baseline_start, baseline_end)
                  VALUES (DATE ''2026-09-01'', DATE ''2026-08-18'', DATE ''2026-09-01'', DATE ''2026-07-18'', DATE ''2026-08-17'')
                  RETURNING id),
            a AS (INSERT INTO public.reality_check_site_verdicts
                    (run_id, cluster_key, members, member_count, verdict, coverage_state,
                     baseline_nights, window_nights, r3_baseline_nights, r3_window_nights,
                     baseline_firms_days, baseline_heat_days, window_firms_days, window_heat_days)
                  SELECT r.id, $1, $2, cardinality($2), ''VOID_NOT_OBSERVED'', ''NOT_OBSERVED'', 0, 0, 0, 0, 0, 0, 0, 0 FROM r
                  RETURNING run_id)
       INSERT INTO public.reality_check_site_verdicts
         (run_id, cluster_key, members, member_count, verdict, coverage_state,
          baseline_nights, window_nights, r3_baseline_nights, r3_window_nights,
          baseline_firms_days, baseline_heat_days, window_firms_days, window_heat_days)
       SELECT a.run_id, $1, $2, cardinality($2), ''VOID_NOT_OBSERVED'', ''NOT_OBSERVED'', 0, 0, 0, 0, 0, 0, 0, 0 FROM a'
      USING v_key, v_members;
    RAISE EXCEPTION 'rc_guard_undo';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME, v_msg = MESSAGE_TEXT;
    IF v_msg <> 'rc_guard_undo' THEN v_got := 'rejected by ' || coalesce(nullif(v_con, ''), v_msg); END IF;
  END;
  r_results := r_results || jsonb_build_object('id', 'G5.5',
    'what', 'one verdict per (run_id, cluster_key): a duplicate is refused',
    'ok', v_con = 'reality_check_site_verdicts_pkey', 'detail', v_got);

  SELECT (linkage_m = 5000 AND rematch_m = 2500 AND rematch_m * 2 <= linkage_m),
         'linkage ' || linkage_m || ' m, re-match ' || rematch_m || ' m'
    INTO v_ok, v_txt
    FROM public.refinery_complex_runs ORDER BY ran_at DESC, id DESC LIMIT 1;
  r_results := r_results || jsonb_build_object('id', 'G5.6',
    'what', 'the rebuild ran at the pinned rule: 5,000 m linkage, re-match 2,500 m (never more than half)',
    'ok', coalesce(v_ok, false), 'detail', v_txt);

  -- ═══ W · run parameters are pinned (D-5) and windows explicit (D-6) ══
  FOR t IN
    SELECT * FROM (VALUES
      ('W1', 'the first tick (data clock 09-01, window 08-18..09-01, baseline 07-18..08-17) is accepted',
       $w$INSERT INTO public.reality_check_runs (data_clock_night, window_start, window_end, baseline_start, baseline_end)
          VALUES (DATE '2026-09-01', DATE '2026-08-18', DATE '2026-09-01', DATE '2026-07-18', DATE '2026-08-17')$w$,
       'accepted'),
      ('W2', 'a "14-night / 30-day" window pair is refused',
       $w$INSERT INTO public.reality_check_runs (data_clock_night, window_start, window_end, baseline_start, baseline_end)
          VALUES (DATE '2026-09-01', DATE '2026-08-19', DATE '2026-09-01', DATE '2026-07-20', DATE '2026-08-18')$w$,
       'rcr_window_arithmetic'),
      ('W3', 'a window that does not end on the data-clock night is refused',
       $w$INSERT INTO public.reality_check_runs (data_clock_night, window_start, window_end, baseline_start, baseline_end)
          VALUES (DATE '2026-09-08', DATE '2026-08-18', DATE '2026-09-01', DATE '2026-07-18', DATE '2026-08-17')$w$,
       'rcr_window_arithmetic'),
      ('W4', 'a silent threshold change (light-down 0.55) is refused',
       $w$INSERT INTO public.reality_check_runs (data_clock_night, window_start, window_end, baseline_start, baseline_end, light_down_ratio)
          VALUES (DATE '2026-09-01', DATE '2026-08-18', DATE '2026-09-01', DATE '2026-07-18', DATE '2026-08-17', 0.55)$w$,
       'rcr_method_pinned'),
      ('W5', 'statistic = mean is refused',
       $w$INSERT INTO public.reality_check_runs (data_clock_night, window_start, window_end, baseline_start, baseline_end, statistic)
          VALUES (DATE '2026-09-01', DATE '2026-08-18', DATE '2026-09-01', DATE '2026-07-18', DATE '2026-08-17', 'mean')$w$,
       'rcr_method_pinned')
    ) AS w(id, what, sql, expect)
  LOOP
    v_got := 'accepted'; v_con := NULL; v_msg := NULL;
    BEGIN
      EXECUTE t.sql;
      RAISE EXCEPTION 'rc_guard_undo';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME, v_msg = MESSAGE_TEXT;
      IF v_msg <> 'rc_guard_undo' THEN v_got := 'rejected by ' || coalesce(nullif(v_con, ''), v_msg);
      ELSE v_con := NULL; END IF;
    END;
    v_ok := CASE WHEN t.expect = 'accepted' THEN v_got = 'accepted' ELSE v_con = t.expect END;
    r_results := r_results || jsonb_build_object('id', t.id, 'what', t.what, 'ok', v_ok, 'detail', v_got);
  END LOOP;

  -- ═══ report: one NOTICE per assertion, then fail loud if any failed ══
  FOR r IN
    SELECT x->>'id' AS id, x->>'what' AS what, (x->>'ok')::boolean AS ok, x->>'detail' AS detail
      FROM jsonb_array_elements(r_results) WITH ORDINALITY AS e(x, o)
     ORDER BY o
  LOOP
    v_total := v_total + 1;
    IF r.ok THEN
      RAISE NOTICE 'PASS % %', r.id, r.what || CASE WHEN r.detail IS NULL THEN '' ELSE ' — ' || r.detail END;
    ELSE
      v_failed := v_failed || r.id;
      RAISE NOTICE 'FAIL % % — %', r.id, r.what, coalesce(r.detail, 'no detail');
    END IF;
  END LOOP;

  IF cardinality(v_failed) > 0 THEN
    RAISE EXCEPTION 'PR-1 guards FAILED: % of % assertions failed: %',
      cardinality(v_failed), v_total, array_to_string(v_failed, ', ');
  END IF;
  RAISE NOTICE 'PR-1 guards: % of % assertions passed', v_total, v_total;
END
$guards$;

ROLLBACK;

-- Reached only when the block above raised nothing. Paste this row back.
SELECT 'PR-1 guards: all assertions passed — the last NOTICE states n of n; each PASS notice names its guard' AS result,
       now() AS checked_at;
