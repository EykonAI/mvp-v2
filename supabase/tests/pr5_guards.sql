-- PR-5 guard tests · Reality Check detector, claims and monitor (migs 169 + 170)
--
-- Run in the Supabase SQL Editor AFTER applying 169 and 170, the whole file.
-- It wraps itself in BEGIN … ROLLBACK: every synthetic row it writes (a few
-- refineries at the South Pole, complexes in cell S90/W180, census nights and
-- sensor rows in 2031, three ticks, ~320 refinery-rc claims) is undone. It
-- calls rebuild_refinery_complexes() twice inside the transaction (~1 s each).
--
-- PASS SIGNAL: the result pane shows ONE row,
--   result = 'PR-5 guards: all assertions passed — …'
-- It is the file's last statement and is reached only when nothing raised;
-- on any failure the editor shows 'PR-5 guards FAILED: …' naming the failed
-- ids and no row. The NOTICE lines (one PASS/FAIL per assertion) are detail.
--
-- WHAT IT PROVES (each fails if its guard is removed or weakened)
--   E   the objects of 169 and 170 exist, with service-role-only grants
--   S1  predictions_register_source_check admits 'refinery-rc' …
--   S2  … and still refuses a source no resolver knows. The resolver DEFAULT
--       (a machine-track source without a case resolves VOID "no resolver",
--       never 0.5) is TypeScript: it is proven by
--       apps/web/scripts/reality-check/test-refinery-rc.mjs (CI job
--       reality-check / unit), not here — SQL cannot run it.
--   R1–R14  refinery_rc_resolution(): a synthetic claim of each family
--       resolves true, false and VOID as specified — heat (< 12 of 14 FIRMS
--       days → VOID), light (< 3 usable clear nights with a retrieval → VOID;
--       a clear night without a retrieval is not a dark night; zero is a
--       value), refutation holds (LEAD in a next tick → false; VOID in both →
--       VOID; fewer than 12 baseline nights — no LEAD possible — in both →
--       VOID, in one → the other decides), a retired key → VOID, an
--       unpublished window → DEFER, and the same window 45 days on → VOID
--   V1–V8  a verdict row violating a 161 CHECK is still refused; the one new
--       shape (dual-down, < 12 baseline nights → VOID_INSUFFICIENT_NIGHTS) is
--       admitted and nothing wider
--   M1–M6  refinery_rc_walkforward(): Calibrating at n < 90; Calibrating (not
--       suspended) when a half's skill is undefined; suspended only on
--       negative skill in BOTH halves (one negative half stays scored, M4b); p_next = (k + 10)/(n + 20); the watch
--       proof kind answers
--   N1–N2  a new night-lights claim at a refinery's coordinates is refused;
--       one elsewhere is not
--   C1–C4  re-typed sites form no complex: a terminal never joins; a
--       refinery re-typed later leaves and its key is retired, not deleted;
--       no current member of any complex is a non-refinery

BEGIN;

DO $guards$
DECLARE
  r_results jsonb := '[]'::jsonb;
  v         jsonb;
  v_txt     text;
  v_ok      boolean;
  v_run1    bigint;
  v_run2    bigint;
  v_run3    bigint;
  v_newest  date;
  v_key     text;
  v_site    text;
  v_n       integer;
  r         record;
  v_failed  text[] := '{}';
  v_total   integer := 0;
  c_now_ok    CONSTANT timestamptz := '2031-02-20 12:00+00';   -- after the Jan windows are final
  c_now_early CONSTANT timestamptz := '2031-01-20 12:00+00';
  c_now_late  CONSTANT timestamptz := '2031-07-01 12:00+00';   -- > window end + 45 days
BEGIN
  -- ═══ E · existence first ═══════════════════════════════════════════
  FOR r IN
    SELECT * FROM (VALUES
      ('E01', 'function reality_check_tick_inputs(date,date)',
              to_regprocedure('public.reality_check_tick_inputs(date,date)') IS NOT NULL),
      ('E02', 'function refinery_rc_walkforward(integer,integer)',
              to_regprocedure('public.refinery_rc_walkforward(integer,integer)') IS NOT NULL),
      ('E03', 'function refinery_rc_resolution(text,jsonb,timestamptz)',
              to_regprocedure('public.refinery_rc_resolution(text,jsonb,timestamp with time zone)') IS NOT NULL),
      ('E04', 'rebuild_refinery_complexes filters site_type',
              pg_get_functiondef('public.rebuild_refinery_complexes()'::regprocedure) LIKE '%r.site_type = ''refinery''%'),
      ('E05', 'runs: ks_split_rule / bm_nights_used / firms_days_used / claims_issued',
              (SELECT count(*) FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'reality_check_runs'
                  AND column_name IN ('ks_split_rule', 'bm_nights_used', 'firms_days_used', 'claims_issued')) = 4),
      ('E06', 'run CHECKs rcr_ks_split_pinned, rcr_claims_issued_sane, rcr_inputs_recorded',
              (SELECT count(*) FROM pg_constraint
                WHERE conname IN ('rcr_ks_split_pinned', 'rcr_claims_issued_sane', 'rcr_inputs_recorded')) = 3),
      ('E07', 'index reality_check_runs_one_live_per_clock',
              to_regclass('public.reality_check_runs_one_live_per_clock') IS NOT NULL),
      ('E08', 'verdict CHECKs: 19 (161) with the widened rcsv_coverage_voids',
              (SELECT count(*) FROM pg_constraint
                WHERE conrelid = 'public.reality_check_site_verdicts'::regclass AND contype = 'c') = 19
              AND (SELECT pg_get_constraintdef(oid) LIKE '%ks_tested IS FALSE%' FROM pg_constraint
                    WHERE conname = 'rcsv_coverage_voids' AND conrelid = 'public.reality_check_site_verdicts'::regclass)),
      ('E09', 'source CHECK lists refinery-rc',
              (SELECT pg_get_constraintdef(oid) LIKE '%''refinery-rc''%' FROM pg_constraint
                WHERE conname = 'predictions_register_source_check'
                  AND conrelid = 'public.predictions_register'::regclass)),
      ('E10', 'due_unscored_predictions orders refinery-rc last',
              pg_get_functiondef('public.due_unscored_predictions(integer)'::regprocedure)
                LIKE '%''refinery-rc''%'),
      ('E11', 'night-lights refinery trigger + has_refinery column',
              EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_predictions_nightlights_no_refinery' AND NOT tgisinternal)
              AND EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name = 'nightlights_significant_sites' AND column_name = 'has_refinery')),
      ('E12', 'watch proof kind + seeded item + both change-log rows',
              EXISTS (SELECT 1 FROM public.ledger_watch_items WHERE proof->>'kind' = 'refinery_rc_walkforward')
              AND (SELECT count(*) FROM public.ledger_change_log
                    WHERE note LIKE 'Reality Check method (mig 169)%' OR note LIKE 'refinery-rc (mig 170)%') = 2),
      ('E13', 'anon/authenticated cannot execute the new functions or the rebuild',
              NOT has_function_privilege('anon', 'public.reality_check_tick_inputs(date,date)', 'EXECUTE')
              AND NOT has_function_privilege('authenticated', 'public.reality_check_tick_inputs(date,date)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.refinery_rc_walkforward(integer,integer)', 'EXECUTE')
              AND NOT has_function_privilege('authenticated', 'public.refinery_rc_walkforward(integer,integer)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.refinery_rc_resolution(text,jsonb,timestamp with time zone)', 'EXECUTE')
              AND NOT has_function_privilege('authenticated', 'public.refinery_rc_resolution(text,jsonb,timestamp with time zone)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.rebuild_refinery_complexes()', 'EXECUTE'))
    ) AS e(id, what, ok)
  LOOP
    r_results := r_results || jsonb_build_object('id', r.id, 'what', r.what, 'ok', coalesce(r.ok, false), 'detail', NULL);
  END LOOP;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(r_results) x WHERE NOT (x->>'ok')::boolean) THEN
    RAISE EXCEPTION 'PR-5 guards: objects missing — apply 169 and 170 (whole files) first. Failed: %',
      (SELECT string_agg(x->>'id', ', ') FROM jsonb_array_elements(r_results) x WHERE NOT (x->>'ok')::boolean);
  END IF;

  -- ═══ fixtures (all rolled back) ═══════════════════════════════════════
  -- nine synthetic complexes in cell S90/W180, far from every real one;
  -- -9 is retired (dissolved)
  INSERT INTO public.refinery_complexes
    (cluster_key, lat_cell, lon_cell, seq, centroid_lat, centroid_lon, centroid, member_count)
  SELECT public.refinery_complex_key(-90, -180, g), -90, -180, g, -89.5, -179.5,
         ST_GeogFromText('SRID=4326;POINT(-179.5 -89.5)'), 1
    FROM generate_series(1, 9) g;
  UPDATE public.refinery_complexes
     SET retired_at = now(), retired_reason = 'dissolved', member_count = 0
   WHERE cluster_key = 'RFC-S90-W180-9';

  -- census: January 2031 usable and final on both instruments
  INSERT INTO public.sensor_night_census
    (sensor, facility_type, night, rows_present, roster_size, roster_source, rows_outside_roster,
     is_final, usable, status)
  SELECT s.sensor, 'refinery', d::date, 100, 100,
         CASE WHEN s.sensor = 'firms' THEN 'firms_derive_rows' ELSE 'ingest_run_firms_window' END,
         0, true, true, 'usable'
    FROM (VALUES ('firms'), ('blackmarble')) AS s(sensor),
         generate_series(DATE '2031-01-01', DATE '2031-01-14', interval '1 day') d;

  -- FIRMS: h-true 14 days, 1 heat day · h-false 14 days, 8 heat days · h-void 11 days
  INSERT INTO public.firms_facility_observations (facility_type, facility_id, period, detection_count, radius_km)
  SELECT 'refinery', 'rcg:h-true',  d::date, CASE WHEN d = DATE '2031-01-05' THEN 1 ELSE 0 END, 5
    FROM generate_series(DATE '2031-01-01', DATE '2031-01-14', interval '1 day') d
  UNION ALL
  SELECT 'refinery', 'rcg:h-false', d::date, CASE WHEN extract(day FROM d)::int <= 8 THEN 2 ELSE 0 END, 5
    FROM generate_series(DATE '2031-01-01', DATE '2031-01-14', interval '1 day') d
  UNION ALL
  SELECT 'refinery', 'rcg:h-void',  d::date, 0, 5
    FROM generate_series(DATE '2031-01-01', DATE '2031-01-11', interval '1 day') d;

  -- Black Marble: l-lit 13 clear nights at 80 + one clear night at 0 (a value) ·
  -- l-dark 14 clear nights at 40 · l-void 2 clear nights with a retrieval, 5
  -- clear nights WITHOUT one (not dark), the rest cloudy at 900 (cloud glow)
  INSERT INTO public.blackmarble_facility_radiance
    (facility_type, facility_id, period, radiance, radiance_3x3, px_hq_3x3, cloud_confidence, tile)
  SELECT 'refinery', 'rcg:l-lit', d::date, CASE WHEN d = DATE '2031-01-07' THEN 0 ELSE 80 END, 80, 9, 'confident_clear', 'h00v00'
    FROM generate_series(DATE '2031-01-01', DATE '2031-01-14', interval '1 day') d
  UNION ALL
  SELECT 'refinery', 'rcg:l-dark', d::date, 40, 40, 9, 'confident_clear', 'h00v00'
    FROM generate_series(DATE '2031-01-01', DATE '2031-01-14', interval '1 day') d
  UNION ALL
  SELECT 'refinery', 'rcg:l-void', d::date,
         CASE WHEN extract(day FROM d)::int <= 2 THEN 120
              WHEN extract(day FROM d)::int <= 7 THEN NULL
              ELSE 900 END,
         NULL, 0,
         CASE WHEN extract(day FROM d)::int <= 7 THEN 'confident_clear' ELSE 'confident_cloudy' END, 'h00v00'
    FROM generate_series(DATE '2031-01-01', DATE '2031-01-14', interval '1 day') d;

  -- three complete ticks after 2031-03-01 (runs 1 and 2 are "the next two")
  INSERT INTO public.reality_check_runs
    (status, completed_at, data_clock_night, window_start, window_end, baseline_start, baseline_end,
     bm_nights_used, firms_days_used, complexes_in_scope, verdicts_written)
  VALUES ('complete', now(), DATE '2031-03-08', DATE '2031-02-22', DATE '2031-03-08', DATE '2031-01-22', DATE '2031-02-21', '{}', '{}', 3, 3)
  RETURNING id INTO v_run1;
  INSERT INTO public.reality_check_runs
    (status, completed_at, data_clock_night, window_start, window_end, baseline_start, baseline_end,
     bm_nights_used, firms_days_used, complexes_in_scope, verdicts_written)
  VALUES ('complete', now(), DATE '2031-03-15', DATE '2031-03-01', DATE '2031-03-15', DATE '2031-01-29', DATE '2031-02-28', '{}', '{}', 3, 3)
  RETURNING id INTO v_run2;
  INSERT INTO public.reality_check_runs
    (status, completed_at, data_clock_night, window_start, window_end, baseline_start, baseline_end,
     bm_nights_used, firms_days_used, complexes_in_scope, verdicts_written)
  VALUES ('complete', now(), DATE '2031-04-01', DATE '2031-03-18', DATE '2031-04-01', DATE '2031-02-15', DATE '2031-03-17', '{}', '{}', 0, 0)
  RETURNING id INTO v_run3;

  -- verdict fixtures for refutation holds: -1 REFUTED then VOID (holds) ·
  -- -2 REFUTED then LEAD (broken) · -3 VOID in both · -7 untested in both
  -- (8 baseline nights: no LEAD was possible, so no look) · -8 untested then
  -- tested REFUTED (one look: holds)
  INSERT INTO public.reality_check_site_verdicts
    (run_id, cluster_key, members, member_count, verdict, coverage_state,
     baseline_nights, window_nights, baseline_median, window_median, baseline_min, baseline_max, window_min, window_max,
     r3_baseline_nights, r3_window_nights, r3_baseline_median, r3_window_median, robustness_verdict,
     baseline_firms_days, baseline_heat_days, window_firms_days, window_heat_days, heat_state,
     ks_tested, ks_d, ks_p)
  VALUES
    (v_run1, 'RFC-S90-W180-1', '{rcg:x}', 1, 'REFUTED', 'OBSERVED', 20, 5, 100, 100, 50, 150, 90, 110,
     20, 5, 100, 100, 'REFUTED', 31, 10, 15, 0, 'HEAT_DOWN', true, 0.2, 0.9),
    (v_run2, 'RFC-S90-W180-1', '{rcg:x}', 1, 'VOID_NOT_OBSERVED', 'NOT_OBSERVED', 0, 0, NULL, NULL, NULL, NULL, NULL, NULL,
     0, 0, NULL, NULL, NULL, 0, 0, 0, 0, 'HEAT_NOT_OBSERVABLE', NULL, NULL, NULL),
    (v_run1, 'RFC-S90-W180-2', '{rcg:x}', 1, 'REFUTED', 'OBSERVED', 20, 5, 100, 100, 50, 150, 90, 110,
     20, 5, 100, 100, 'REFUTED', 31, 10, 15, 0, 'HEAT_DOWN', true, 0.2, 0.9),
    (v_run2, 'RFC-S90-W180-2', '{rcg:x}', 1, 'LEAD', 'OBSERVED', 20, 5, 100, 40, 50, 150, 30, 50,
     20, 5, 100, 40, 'LEAD', 31, 10, 15, 0, 'HEAT_DOWN', true, 0.2, 0.9),
    (v_run1, 'RFC-S90-W180-3', '{rcg:x}', 1, 'VOID_NOT_OBSERVED', 'NOT_OBSERVED', 0, 0, NULL, NULL, NULL, NULL, NULL, NULL,
     0, 0, NULL, NULL, NULL, 0, 0, 0, 0, 'HEAT_NOT_OBSERVABLE', NULL, NULL, NULL),
    (v_run2, 'RFC-S90-W180-3', '{rcg:x}', 1, 'VOID_NOT_OBSERVED', 'NOT_OBSERVED', 0, 0, NULL, NULL, NULL, NULL, NULL, NULL,
     0, 0, NULL, NULL, NULL, 0, 0, 0, 0, 'HEAT_NOT_OBSERVABLE', NULL, NULL, NULL),
    (v_run1, 'RFC-S90-W180-7', '{rcg:x}', 1, 'REFUTED', 'OBSERVED', 8, 5, 100, 100, 50, 150, 90, 110,
     8, 5, 100, 100, 'REFUTED', 31, 10, 15, 0, 'HEAT_DOWN', false, NULL, NULL),
    (v_run2, 'RFC-S90-W180-7', '{rcg:x}', 1, 'STEADY', 'OBSERVED', 8, 5, 100, 100, 50, 150, 90, 110,
     8, 5, 100, 100, 'STEADY', 31, 10, 15, 5, 'HEAT_STEADY', false, NULL, NULL),
    (v_run1, 'RFC-S90-W180-8', '{rcg:x}', 1, 'REFUTED', 'OBSERVED', 8, 5, 100, 100, 50, 150, 90, 110,
     8, 5, 100, 100, 'REFUTED', 31, 10, 15, 0, 'HEAT_DOWN', false, NULL, NULL),
    (v_run2, 'RFC-S90-W180-8', '{rcg:x}', 1, 'REFUTED', 'OBSERVED', 20, 5, 100, 100, 50, 150, 90, 110,
     20, 5, 100, 100, 'REFUTED', 31, 10, 15, 0, 'HEAT_DOWN', true, 0.2, 0.9);

  -- ═══ S · the source ════════════════════════════════════════════════
  BEGIN
    INSERT INTO public.predictions_register
      (feature, context, predicted_distribution, target_observable, target_window_hours, resolves_at,
       statement, source, track, hash)
    VALUES ('rc_site_stays_lit', '{}'::jsonb, '{"mean":0.5,"type":"point"}'::jsonb,
            'rc-guard:source-check', 336, now() + interval '14 days', 'guard', 'refinery-rc', 'machine', 'guard');
    r_results := r_results || jsonb_build_object('id', 'S1', 'what', 'a refinery-rc claim is admitted by the source CHECK', 'ok', true, 'detail', NULL);
  EXCEPTION WHEN check_violation THEN
    r_results := r_results || jsonb_build_object('id', 'S1', 'what', 'a refinery-rc claim is admitted by the source CHECK', 'ok', false, 'detail', SQLERRM);
  END;
  BEGIN
    INSERT INTO public.predictions_register
      (feature, context, predicted_distribution, target_observable, target_window_hours, resolves_at,
       statement, source, track, hash)
    VALUES ('x', '{}'::jsonb, '{"mean":0.5}'::jsonb, 'rc-guard:unknown-source', 24, now(), 'guard', 'no-such-source', 'machine', 'guard');
    r_results := r_results || jsonb_build_object('id', 'S2', 'what', 'a source with no resolver is still refused', 'ok', false, 'detail', 'accepted');
  EXCEPTION WHEN check_violation THEN
    r_results := r_results || jsonb_build_object('id', 'S2', 'what', 'a source with no resolver is still refused', 'ok', true, 'detail', NULL);
  END;

  -- ═══ R · the resolution rule, family by family ══════════════════════
  FOR r IN
    SELECT * FROM (VALUES
      ('R01', 'heat: 1 heat day in 14 against a 10/31 baseline → persists (1)',
              'rc_heat_dark_persists', '{"cluster_key":"RFC-S90-W180-1","members":["rcg:h-true"],"window_start":"2031-01-01","window_end":"2031-01-14","baseline_heat_days":10,"baseline_firms_days":31}', c_now_ok, 'ready', 1),
      ('R02', 'heat: 8 heat days in 14 → does not persist (0)',
              'rc_heat_dark_persists', '{"cluster_key":"RFC-S90-W180-1","members":["rcg:h-false"],"window_start":"2031-01-01","window_end":"2031-01-14","baseline_heat_days":10,"baseline_firms_days":31}', c_now_ok, 'ready', 0),
      ('R03', 'heat: 11 of 14 FIRMS days observed → VOID',
              'rc_heat_dark_persists', '{"cluster_key":"RFC-S90-W180-1","members":["rcg:h-void"],"window_start":"2031-01-01","window_end":"2031-01-14","baseline_heat_days":10,"baseline_firms_days":31}', c_now_ok, 'void', NULL),
      ('R04', 'stays lit: window median 80 vs 0.60 x 100 (a zero night counted as a value) → 1',
              'rc_site_stays_lit', '{"cluster_key":"RFC-S90-W180-1","members":["rcg:l-lit"],"window_start":"2031-01-01","window_end":"2031-01-14","baseline_median":100}', c_now_ok, 'ready', 1),
      ('R05', 'stays lit: window median 40 → 0',
              'rc_site_stays_lit', '{"cluster_key":"RFC-S90-W180-1","members":["rcg:l-dark"],"window_start":"2031-01-01","window_end":"2031-01-14","baseline_median":100}', c_now_ok, 'ready', 0),
      ('R06', 'stays lit: 2 clear nights with a retrieval (5 clear without one are not dark) → VOID',
              'rc_site_stays_lit', '{"cluster_key":"RFC-S90-W180-1","members":["rcg:l-void"],"window_start":"2031-01-01","window_end":"2031-01-14","baseline_median":100}', c_now_ok, 'void', NULL),
      ('R07', 'lead persists: window median 40 < 60 → 1',
              'rc_lead_light_persists', '{"cluster_key":"RFC-S90-W180-1","members":["rcg:l-dark"],"window_start":"2031-01-01","window_end":"2031-01-14","baseline_median":100}', c_now_ok, 'ready', 1),
      ('R08', 'lead persists: window median 80 → 0',
              'rc_lead_light_persists', '{"cluster_key":"RFC-S90-W180-1","members":["rcg:l-lit"],"window_start":"2031-01-01","window_end":"2031-01-14","baseline_median":100}', c_now_ok, 'ready', 0),
      ('R09', 'refutation holds: REFUTED then VOID in the next two ticks → 1',
              'rc_refutation_holds', '{"cluster_key":"RFC-S90-W180-1","members":["rcg:x"],"window_start":"2031-03-02","window_end":"2031-03-15","tick_data_clock":"2031-03-01"}', c_now_ok, 'ready', 1),
      ('R10', 'refutation holds: a LEAD in the next two ticks → 0',
              'rc_refutation_holds', '{"cluster_key":"RFC-S90-W180-2","members":["rcg:x"],"window_start":"2031-03-02","window_end":"2031-03-15","tick_data_clock":"2031-03-01"}', c_now_ok, 'ready', 0),
      ('R11', 'refutation holds: VOID in both ticks → VOID',
              'rc_refutation_holds', '{"cluster_key":"RFC-S90-W180-3","members":["rcg:x"],"window_start":"2031-03-02","window_end":"2031-03-15","tick_data_clock":"2031-03-01"}', c_now_ok, 'void', NULL),
      ('R11b', 'refutation holds: fewer than 12 baseline nights in both next ticks (no LEAD possible) → VOID, never a free "holds"',
              'rc_refutation_holds', '{"cluster_key":"RFC-S90-W180-7","members":["rcg:x"],"window_start":"2031-03-02","window_end":"2031-03-15","tick_data_clock":"2031-03-01"}', c_now_ok, 'void', NULL),
      ('R11c', 'refutation holds: untested then a tested REFUTED → 1 (one tick could have called a LEAD)',
              'rc_refutation_holds', '{"cluster_key":"RFC-S90-W180-8","members":["rcg:x"],"window_start":"2031-03-02","window_end":"2031-03-15","tick_data_clock":"2031-03-01"}', c_now_ok, 'ready', 1),
      ('R12', 'any family on a retired key → VOID',
              'rc_site_stays_lit', '{"cluster_key":"RFC-S90-W180-9","members":["rcg:l-lit"],"window_start":"2031-01-01","window_end":"2031-01-14","baseline_median":100}', c_now_ok, 'void', NULL),
      ('R13', 'an unpublished window DEFERS (light, heat, and fewer than two later ticks)',
              'rc_site_stays_lit', '{"cluster_key":"RFC-S90-W180-1","members":["rcg:l-lit"],"window_start":"2031-02-01","window_end":"2031-02-14","baseline_median":100}', c_now_early, 'defer', NULL),
      ('R13b', 'heat window not final → DEFER',
              'rc_heat_dark_persists', '{"cluster_key":"RFC-S90-W180-1","members":["rcg:h-true"],"window_start":"2031-02-01","window_end":"2031-02-14","baseline_heat_days":10,"baseline_firms_days":31}', c_now_early, 'defer', NULL),
      ('R13c', 'one tick after the claim so far → DEFER',
              'rc_refutation_holds', '{"cluster_key":"RFC-S90-W180-1","members":["rcg:x"],"window_start":"2031-03-16","window_end":"2031-03-29","tick_data_clock":"2031-03-15"}', c_now_ok, 'defer', NULL),
      ('R14', 'the same unpublished windows 45+ days on → VOID (instrument did not publish)',
              'rc_site_stays_lit', '{"cluster_key":"RFC-S90-W180-1","members":["rcg:l-lit"],"window_start":"2031-02-01","window_end":"2031-02-14","baseline_median":100}', c_now_late, 'void', NULL),
      ('R14b', 'fewer than two later ticks 45+ days on → VOID',
              'rc_refutation_holds', '{"cluster_key":"RFC-S90-W180-1","members":["rcg:x"],"window_start":"2031-03-16","window_end":"2031-03-29","tick_data_clock":"2031-03-15"}', c_now_late, 'void', NULL),
      ('R14c', 'a malformed claim (no members) → VOID',
              'rc_heat_dark_persists', '{"cluster_key":"RFC-S90-W180-1","window_start":"2031-01-01","window_end":"2031-01-14","baseline_heat_days":10,"baseline_firms_days":31}', c_now_ok, 'void', NULL)
    ) AS t(id, what, fam, ctx, at_now, want_state, want_obs)
  LOOP
    v := public.refinery_rc_resolution(r.fam, r.ctx::jsonb, r.at_now);
    v_ok := v->>'state' = r.want_state
            AND (r.want_obs IS NULL OR (v->>'observed')::int = r.want_obs);
    r_results := r_results || jsonb_build_object('id', r.id, 'what', r.what, 'ok', v_ok,
                   'detail', CASE WHEN v_ok THEN NULL ELSE v::text END);
  END LOOP;

  -- ═══ V · the verdict table still refuses what 161 refused ════════════
  FOR r IN
    SELECT * FROM (VALUES
      -- id, what, key, verdict, coverage, bn, wn, bmed, wmed, bmin, bmax, wmin, wmax, rv, bf, bh, wf, wh, heat, kst, ksd, ksp, want_ok
      ('V1', 'HEAT_STEADY at a 0.15 baseline heat rate is refused',
             'RFC-S90-W180-4', 'STEADY', 'OBSERVED', 20, 5, 100::numeric, 100::numeric, 50::numeric, 150::numeric, 90::numeric, 110::numeric, 'STEADY',
             20, 3, 15, 3, 'HEAT_STEADY', true, 0.2::numeric, 0.9::numeric, false),
      ('V2', 'a LEAD without the stability test (8 baseline nights) is refused',
             'RFC-S90-W180-4', 'LEAD', 'OBSERVED', 8, 5, 100, 40, 50, 150, 30, 50, 'LEAD',
             31, 10, 15, 0, 'HEAT_DOWN', false, NULL, NULL, false),
      ('V3', 'a failed stability test with a verdict other than VOID_BASELINE_UNSTABLE is refused',
             'RFC-S90-W180-4', 'REFUTED', 'OBSERVED', 20, 5, 100, 100, 50, 150, 90, 110, 'REFUTED',
             31, 10, 15, 0, 'HEAT_DOWN', true, 0.6, 0.01, false),
      ('V4', 'a BELOW_FLOOR row that is not VOID_INSUFFICIENT_NIGHTS is refused',
             'RFC-S90-W180-4', 'STEADY', 'BELOW_FLOOR', 4, 5, 100, 100, 50, 150, 90, 110, 'STEADY',
             31, 10, 15, 5, 'HEAT_STEADY', NULL, NULL, NULL, false),
      ('V5', 'VOID_INSUFFICIENT_NIGHTS on an OBSERVED row that is not dual-down is refused (the 169 shape is exact)',
             'RFC-S90-W180-4', 'VOID_INSUFFICIENT_NIGHTS', 'OBSERVED', 8, 5, 100, 100, 50, 150, 90, 110, NULL,
             31, 10, 15, 0, 'HEAT_DOWN', false, NULL, NULL, false),
      ('V6', 'a REFUTED row with light down is refused (0.60 pinned)',
             'RFC-S90-W180-4', 'REFUTED', 'OBSERVED', 20, 5, 100, 59, 50, 150, 50, 70, 'REFUTED',
             31, 10, 15, 0, 'HEAT_DOWN', true, 0.2, 0.9, false),
      ('V7', 'dual-down with 8 baseline nights reads VOID_INSUFFICIENT_NIGHTS — admitted (mig 169)',
             'RFC-S90-W180-5', 'VOID_INSUFFICIENT_NIGHTS', 'OBSERVED', 8, 5, 100, 40, 50, 150, 30, 50, NULL,
             31, 10, 15, 0, 'HEAT_DOWN', false, NULL, NULL, true),
      ('V8', 'dual-down with 20 baseline nights (tested) cannot be VOID_INSUFFICIENT_NIGHTS — it is a LEAD',
             'RFC-S90-W180-6', 'VOID_INSUFFICIENT_NIGHTS', 'OBSERVED', 20, 5, 100, 40, 50, 150, 30, 50, NULL,
             31, 10, 15, 0, 'HEAT_DOWN', true, 0.2, 0.9, false)
    ) AS t(id, what, ck, verdict, cov, bn, wn, bmed, wmed, bmin, bmax, wmin, wmax, rv, bf, bh, wf, wh, heat, kst, ksd, ksp, want_ok)
  LOOP
    BEGIN
      INSERT INTO public.reality_check_site_verdicts
        (run_id, cluster_key, members, member_count, verdict, coverage_state,
         baseline_nights, window_nights, baseline_median, window_median, baseline_min, baseline_max, window_min, window_max,
         r3_baseline_nights, r3_window_nights, r3_baseline_median, r3_window_median, robustness_verdict,
         baseline_firms_days, baseline_heat_days, window_firms_days, window_heat_days, heat_state,
         ks_tested, ks_d, ks_p)
      VALUES (v_run3, r.ck, '{rcg:v}', 1, r.verdict, r.cov,
              r.bn, r.wn, r.bmed, r.wmed, r.bmin, r.bmax, r.wmin, r.wmax,
              r.bn, r.wn, r.bmed, r.wmed, r.rv,
              r.bf, r.bh, r.wf, r.wh, r.heat, r.kst, r.ksd, r.ksp);
      v_ok := r.want_ok;
      v_txt := 'accepted';
      -- an accepted row is removed again so the next case can use the key
      DELETE FROM public.reality_check_site_verdicts WHERE run_id = v_run3 AND cluster_key = r.ck;
    EXCEPTION WHEN check_violation THEN
      v_ok := NOT r.want_ok;
      v_txt := 'refused: ' || SQLERRM;
    END;
    r_results := r_results || jsonb_build_object('id', r.id, 'what', r.what, 'ok', v_ok,
                   'detail', CASE WHEN v_ok THEN NULL ELSE v_txt END);
  END LOOP;

  -- ═══ M · the monitor ══════════════════════════════════════════════════
  -- rc_guard_a: 10 judged · rc_guard_b: 100 judged, every outcome 1 (skill
  -- undefined) · rc_guard_c: 100 judged, p 0.9 against a 0.25 base (negative
  -- in both halves) · rc_guard_d: 100 judged, sharp and right (positive)
  INSERT INTO public.predictions_register
    (id, feature, context, predicted_distribution, target_observable, target_window_hours,
     issued_at, resolves_at, statement, source, track, hash)
  SELECT md5('rcg-' || f || g)::uuid, f, '{}'::jsonb,
         jsonb_build_object('mean', CASE f WHEN 'rc_guard_c' THEN 0.9
                                           WHEN 'rc_guard_d' THEN CASE WHEN g % 2 = 0 THEN 0.8 ELSE 0.2 END
                                           -- first half sharp and right, second half confidently wrong
                                           WHEN 'rc_guard_e' THEN CASE WHEN g > 50 THEN 0.9
                                                                       WHEN g % 2 = 0 THEN 0.8 ELSE 0.2 END
                                           ELSE 0.5 END, 'type', 'point'),
         'rc-guard:' || f || ':' || g, 336,
         now() - make_interval(mins => 1000 - g), now() - make_interval(mins => 999 - g),
         'guard', 'refinery-rc', 'machine', 'guard'
    FROM (VALUES ('rc_guard_a', 10), ('rc_guard_b', 100), ('rc_guard_c', 100), ('rc_guard_d', 100), ('rc_guard_e', 100)) AS s(f, n),
         generate_series(1, s.n) g;
  INSERT INTO public.prediction_outcomes (prediction_id, observed_value, observed_at, brier, log_loss, calibration_bin)
  SELECT p.id, y, now(), round(((p.predicted_distribution->>'mean')::numeric - y) ^ 2, 3), 0, 5
    FROM public.predictions_register p
    CROSS JOIN LATERAL (SELECT CASE p.feature
                                 WHEN 'rc_guard_a' THEN (split_part(p.target_observable, ':', 3)::int % 2)
                                 WHEN 'rc_guard_b' THEN 1
                                 WHEN 'rc_guard_c' THEN CASE WHEN split_part(p.target_observable, ':', 3)::int % 4 = 0 THEN 1 ELSE 0 END
                                 WHEN 'rc_guard_e' THEN CASE WHEN split_part(p.target_observable, ':', 3)::int > 50
                                                             THEN (split_part(p.target_observable, ':', 3)::int % 4 = 0)::int
                                                             ELSE (split_part(p.target_observable, ':', 3)::int % 2 = 0)::int END
                                 ELSE CASE WHEN split_part(p.target_observable, ':', 3)::int % 2 = 0 THEN 1 ELSE 0 END
                               END::numeric AS y) yy
   WHERE p.source = 'refinery-rc' AND p.target_observable LIKE 'rc-guard:rc_guard_%';

  v := public.refinery_rc_walkforward();
  r_results := r_results || jsonb_build_object('id', 'M1',
    'what', 'n < 90 → Calibrating (10 judged)',
    'ok', v->'families'->'rc_guard_a'->>'status' = 'calibrating' AND (v->'families'->'rc_guard_a'->>'judged')::int = 10,
    'detail', (v->'families'->'rc_guard_a')::text);
  r_results := r_results || jsonb_build_object('id', 'M2',
    'what', '100 judged, base rate 1 (skill undefined) → Calibrating, never suspended',
    'ok', v->'families'->'rc_guard_b'->>'status' = 'calibrating' AND v->'families'->'rc_guard_b'->>'skill_half_1' IS NULL,
    'detail', (v->'families'->'rc_guard_b')::text);
  r_results := r_results || jsonb_build_object('id', 'M3',
    'what', '100 judged, negative skill in both halves → suspended',
    'ok', v->'families'->'rc_guard_c'->>'status' = 'suspended'
          AND (v->'families'->'rc_guard_c'->>'skill_half_1')::numeric < 0
          AND (v->'families'->'rc_guard_c'->>'skill_half_2')::numeric < 0,
    'detail', (v->'families'->'rc_guard_c')::text);
  r_results := r_results || jsonb_build_object('id', 'M4',
    'what', '100 judged, positive skill → scored',
    'ok', v->'families'->'rc_guard_d'->>'status' = 'scored',
    'detail', (v->'families'->'rc_guard_d')::text);
  r_results := r_results || jsonb_build_object('id', 'M4b',
    'what', 'negative skill in ONE half only → scored, not suspended',
    'ok', v->'families'->'rc_guard_e'->>'status' = 'scored'
          AND (v->'families'->'rc_guard_e'->>'skill_half_1')::numeric > 0
          AND (v->'families'->'rc_guard_e'->>'skill_half_2')::numeric < 0,
    'detail', (v->'families'->'rc_guard_e')::text);
  r_results := r_results || jsonb_build_object('id', 'M5',
    'what', 'the four families are always listed; p_next = (k + 10)/(n + 20) (guard_a: k 5, n 10 → 0.5; guard_b: 110/120)',
    'ok', (SELECT count(*) FROM jsonb_object_keys(v->'families') k
            WHERE k IN ('rc_heat_dark_persists', 'rc_site_stays_lit', 'rc_lead_light_persists', 'rc_refutation_holds')) = 4
          AND (v->'families'->'rc_guard_a'->>'p_next')::numeric = 0.5
          AND (v->'families'->'rc_guard_b'->>'p_next')::numeric = round(110.0 / 120, 4),
    'detail', NULL);
  r_results := r_results || jsonb_build_object('id', 'M6',
    'what', 'watch proof kind: proven once a family has 90 judged; not for a family with 10',
    'ok', (public.ledger_watch_prove('{"kind":"refinery_rc_walkforward","family":"rc_guard_b","min_judged":90}'::jsonb)->>'proven')::boolean
          AND NOT (public.ledger_watch_prove('{"kind":"refinery_rc_walkforward","family":"rc_guard_a","min_judged":90}'::jsonb)->>'proven')::boolean,
    'detail', NULL);

  -- ═══ N · refinery sites left the night-lights families ═══════════════
  SELECT round(latitude::numeric, 4) || ':' || round(longitude::numeric, 4) INTO v_site
    FROM public.refineries ORDER BY id LIMIT 1;
  BEGIN
    INSERT INTO public.predictions_register
      (feature, context, predicted_distribution, target_observable, target_window_hours, resolves_at,
       statement, source, track, hash)
    VALUES ('nightlights_recovery', jsonb_build_object('site_key', v_site), '{"mean":0.7}'::jsonb,
            'rc-guard:nl-refinery', 168, now() + interval '7 days', 'guard', 'blackmarble', 'machine', 'guard');
    r_results := r_results || jsonb_build_object('id', 'N1', 'what', 'a night-lights claim at a refinery site is refused', 'ok', false, 'detail', 'accepted at ' || v_site);
  EXCEPTION WHEN check_violation THEN
    r_results := r_results || jsonb_build_object('id', 'N1', 'what', 'a night-lights claim at a refinery site is refused', 'ok', true, 'detail', NULL);
  END;
  BEGIN
    INSERT INTO public.predictions_register
      (feature, context, predicted_distribution, target_observable, target_window_hours, resolves_at,
       statement, source, track, hash)
    VALUES ('nightlights_recovery', '{"site_key":"-89.9999:-179.9999"}'::jsonb, '{"mean":0.7}'::jsonb,
            'rc-guard:nl-elsewhere', 168, now() + interval '7 days', 'guard', 'blackmarble', 'machine', 'guard');
    r_results := r_results || jsonb_build_object('id', 'N2', 'what', 'a night-lights claim elsewhere is not refused', 'ok', true, 'detail', NULL);
  EXCEPTION WHEN check_violation THEN
    r_results := r_results || jsonb_build_object('id', 'N2', 'what', 'a night-lights claim elsewhere is not refused', 'ok', false, 'detail', SQLERRM);
  END;

  -- ═══ C · re-typed sites form no complex (last: the rebuild retires the
  --        memberless S90/W180 fixtures, which the R tests above needed) ══
  SELECT max(period) INTO v_newest FROM public.firms_facility_observations WHERE facility_type = 'refinery';
  INSERT INTO public.refineries (id, osm_type, osm_id, refinery_name, latitude, longitude, site_type)
  VALUES ('rcg:site-ref',  'way', -910001, 'guard refinery', -89.95, -179.95, 'refinery'),
         ('rcg:site-term', 'way', -910002, 'guard terminal', -89.95, -179.90, 'terminal');   -- ~0.9 km apart
  INSERT INTO public.firms_facility_observations (facility_type, facility_id, period, detection_count, radius_km)
  VALUES ('refinery', 'rcg:site-ref', v_newest, 1, 5), ('refinery', 'rcg:site-term', v_newest, 1, 5);

  PERFORM public.rebuild_refinery_complexes();
  SELECT m.cluster_key INTO v_key FROM public.refinery_complex_members m
   WHERE m.facility_id = 'rcg:site-ref' AND m.left_at IS NULL;
  r_results := r_results || jsonb_build_object('id', 'C1',
    'what', 'a refinery-typed site forms a complex; a terminal 0.9 km away does not join it',
    'ok', v_key IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.refinery_complex_members WHERE facility_id = 'rcg:site-term'),
    'detail', coalesce(v_key, 'no complex'));

  UPDATE public.refineries SET site_type = 'terminal' WHERE id = 'rcg:site-ref';
  PERFORM public.rebuild_refinery_complexes();
  r_results := r_results || jsonb_build_object('id', 'C2',
    'what', 're-typing its only member retires the key as dissolved (the row stays)',
    'ok', EXISTS (SELECT 1 FROM public.refinery_complexes
                   WHERE cluster_key = v_key AND retired_reason = 'dissolved' AND retired_at IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM public.refinery_complex_members
                           WHERE facility_id = 'rcg:site-ref' AND left_at IS NULL),
    'detail', v_key);
  BEGIN
    DELETE FROM public.refinery_complexes WHERE cluster_key = v_key;
    r_results := r_results || jsonb_build_object('id', 'C3', 'what', 'a retired key cannot be deleted', 'ok', false, 'detail', 'deleted');
  EXCEPTION WHEN integrity_constraint_violation THEN
    r_results := r_results || jsonb_build_object('id', 'C3', 'what', 'a retired key cannot be deleted', 'ok', true, 'detail', NULL);
  END;
  SELECT count(*) INTO v_n
    FROM public.refinery_complex_members m JOIN public.refineries rf ON rf.id = m.facility_id
   WHERE m.left_at IS NULL AND rf.site_type <> 'refinery';
  r_results := r_results || jsonb_build_object('id', 'C4',
    'what', 'no current member of any complex is a non-refinery; the tick inputs agree',
    'ok', v_n = 0
          AND NOT EXISTS (SELECT 1 FROM public.reality_check_tick_inputs(current_date - 46, current_date)
                           WHERE non_refinery_members > 0),
    'detail', v_n::text);

  -- ═══ report ═════════════════════════════════════════════════════════
  FOR r IN
    SELECT x->>'id' AS id, x->>'what' AS what, (x->>'ok')::boolean AS ok, x->>'detail' AS detail
      FROM jsonb_array_elements(r_results) WITH ORDINALITY AS e(x, o)
     ORDER BY o
  LOOP
    v_total := v_total + 1;
    IF r.ok THEN
      RAISE NOTICE 'PASS % %', r.id, r.what;
    ELSE
      v_failed := v_failed || r.id;
      RAISE NOTICE 'FAIL % % — %', r.id, r.what, coalesce(r.detail, 'no detail');
    END IF;
  END LOOP;
  IF cardinality(v_failed) > 0 THEN
    RAISE EXCEPTION 'PR-5 guards FAILED: % of % assertions failed: % — details: %',
      cardinality(v_failed), v_total, array_to_string(v_failed, ', '),
      (SELECT string_agg((x->>'id') || ' ' || coalesce(x->>'detail', ''), ' | ')
         FROM jsonb_array_elements(r_results) x WHERE NOT (x->>'ok')::boolean);
  END IF;
  RAISE NOTICE 'PR-5 guards: % of % assertions passed', v_total, v_total;
END
$guards$;

ROLLBACK;

-- Reached only when the block above raised nothing. Paste this row back.
SELECT 'PR-5 guards: all assertions passed — E01–E13, S1–S2, R01–R14c, V1–V8, M1–M6 (+M4b), N1–N2, C1–C4 (the resolver default is proven by test-refinery-rc.mjs)' AS result,
       now() AS checked_at;
