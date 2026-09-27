-- IMG-6 · Sentinel-1 go-live behind the admission — acceptance checks for
-- migration 189.
--
-- READ ONLY and LIGHT. BEGIN … ROLLBACK with six throw-away anchorages whose
-- S1 looks track their AIS counts exactly (rho = 1, no share drift), so the
-- study must admit them; everything is rolled back. The fixture values are
-- large so the few real study rows cannot move the shares. A clean run ends
-- with ONE RESULT ROW ("IMG-6 guards: PASS 1-7 …"); 'Success. No rows
-- returned' means it did NOT run whole.

BEGIN;

DO $$
DECLARE
  r        record;
  n        integer;
  i        integer;
  j        integer;
  v_aoi    text;
  v_at     timestamptz;
  v_ais    integer;
  v_cp     text := 'chokepoint:bab-el-mandeb';
  v_now    timestamptz := date_trunc('hour', now());
  pattern  integer[] := ARRAY[10, 20, 30, 40, 50, 60];
BEGIN
  -- ── 1. Objects and access ──────────────────────────────────────────────
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname IN
         ('imagery_s1_record_admission','imagery_s1_status','imagery_s1_readings','imagery_s1_flag_candidates');
  IF n <> 4 OR to_regclass('public.imagery_s1_admissions') IS NULL THEN
    RAISE EXCEPTION 'FAIL 1a: % of 4 IMG-6 functions, or no admissions table — 189 not applied', n;
  END IF;
  IF has_function_privilege('anon', 'public.imagery_s1_readings(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.imagery_s1_record_admission(integer,text)', 'EXECUTE')
     OR has_table_privilege('anon', 'public.imagery_s1_admissions', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL 1b: anon/authenticated can reach an IMG-6 object';
  END IF;
  RAISE NOTICE 'PASS 1: 4 functions + admissions table · service_role only';

  -- ── 2. Six strait windows, small, matching the AIS box slugs ───────────
  SELECT count(*) INTO n FROM public.imagery_aois
   WHERE kind = 'chokepoint' AND retired_at IS NULL
     AND aoi_id IN ('chokepoint:bab-el-mandeb','chokepoint:hormuz','chokepoint:suez',
                    'chokepoint:bosphorus','chokepoint:malacca','chokepoint:panama');
  IF n <> 6 THEN RAISE EXCEPTION 'FAIL 2a: % of 6 chokepoint windows', n; END IF;
  IF (SELECT max(area_km2) FROM public.imagery_aois WHERE kind = 'chokepoint') > 800 THEN
    RAISE EXCEPTION 'FAIL 2b: a chokepoint window is over 800 km² — a pass would cost far more than planned';
  END IF;
  IF (SELECT state FROM public.imagery_s1_status()) <> 'admitted'
     AND EXISTS (SELECT 1 FROM public.imagery_aois WHERE kind = 'chokepoint' AND 's1_grd' = ANY (sensors_enabled)) THEN
    RAISE EXCEPTION 'FAIL 2c: a chokepoint window has s1_grd on without a passing admission';
  END IF;
  RAISE NOTICE 'PASS 2: 6 windows ≤ 800 km², S1 off unless admitted';

  -- ── fixture: four anchorages (then two more), 12 paired looks each, S1 area = 1000 m² × AIS vessels
  FOR i IN 1..4 LOOP
    v_aoi := 'anchorage:img6_guard_' || i;
    INSERT INTO public.imagery_aois (aoi_id, kind, name, geom, centroid_lat, centroid_lon, area_km2, buffer_rule)
    VALUES (v_aoi, 'anchorage', 'IMG-6 guard ' || i,
            ST_MakeEnvelope(-30 - i, -50, -29.9 - i, -49.9, 4326), -49.95, -29.95 - i, 80, 'guard fixture');
    FOR j IN 1..12 LOOP
      v_at  := v_now - make_interval(days => 80 - (j - 1) * 5);     -- days 80 … 25 ago, 6 per half of a 90-day window
      v_ais := pattern[((j - 1) % 6) + 1] * i * 1000;
      INSERT INTO public.ais_aoi_counts (aoi_id, sampled_at, vessels_fresh, vessels_stationary, feed_newest_fix_at)
      VALUES (v_aoi, v_at + interval '10 minutes', v_ais, 0, v_at);
      PERFORM public.imagery_upsert_obs('s1_grd', jsonb_build_array(jsonb_build_object(
        'aoi_id', v_aoi, 'acquired_at', v_at, 'coverage_state', 'clear', 'aoi_covered_fraction', 1,
        'metric_name', 'bright_target_area_m2', 'metric_stat', 'area_m2', 'metric_value', v_ais * 1000.0)));
    END LOOP;
  END LOOP;
  -- the Bab-el-Mandeb window: three ordinary looks, one at 3× its median, one VOID pass
  FOR j IN 1..3 LOOP
    PERFORM public.imagery_upsert_obs('s1_grd', jsonb_build_array(jsonb_build_object(
      'aoi_id', v_cp, 'acquired_at', v_now - make_interval(days => 12 - j), 'coverage_state', 'clear', 'aoi_covered_fraction', 1,
      'metric_name', 'bright_target_area_m2', 'metric_stat', 'area_m2', 'metric_value', 20000)));
  END LOOP;
  PERFORM public.imagery_upsert_obs('s1_grd', jsonb_build_array(
    jsonb_build_object('aoi_id', v_cp, 'acquired_at', v_now - interval '4 days', 'coverage_state', 'clear', 'aoi_covered_fraction', 1,
                       'metric_name', 'bright_target_area_m2', 'metric_stat', 'area_m2', 'metric_value', 60000),
    jsonb_build_object('aoi_id', v_cp, 'acquired_at', v_now - interval '2 days', 'coverage_state', 'no_acquisition')));

  -- ── 3. Not admitted → nothing is shown, nothing can flag ───────────────
  INSERT INTO public.imagery_s1_admissions (recorded_by, window_days, study, evaluated_n, admitted_n, method_admitted, rule)
  VALUES ('img6 guard', 60, '[]', 0, 0, false, 'guard fixture');
  IF (SELECT state FROM public.imagery_s1_status()) <> 'not admitted' THEN RAISE EXCEPTION 'FAIL 3a: status is not "not admitted"'; END IF;
  IF EXISTS (SELECT 1 FROM public.imagery_s1_readings(120)) OR EXISTS (SELECT 1 FROM public.imagery_s1_flag_candidates('-infinity')) THEN
    RAISE EXCEPTION 'FAIL 3b: an S1 reading is shown or flagged while the method is not admitted';
  END IF;
  BEGIN
    INSERT INTO public.imagery_s1_admissions (recorded_by, window_days, study, evaluated_n, admitted_n, admitted_aois, method_admitted, m2_per_vessel, rule)
    VALUES ('img6 guard', 60, '[]', 10, 1, ARRAY['x'], true, 1000, 'guard fixture');
    RAISE EXCEPTION 'FAIL 3c: one admitted anchorage was accepted as an admitted method' USING ERRCODE = 'P0002';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'PASS 3: not admitted → no readings, no flags · a one-anchorage "method" is refused';

  SELECT * INTO r FROM public.imagery_s1_record_admission(90, 'img6 guard');
  IF r.method_admitted OR r.admitted_n <> 4 OR r.chokepoints_enabled <> 0 THEN
    RAISE EXCEPTION 'FAIL 3d: four admitted anchorages (want not a method, 4 admitted, 0 windows on) gave %, %, %', r.method_admitted, r.admitted_n, r.chokepoints_enabled;
  END IF;
  RAISE NOTICE 'PASS 3d: four admitted anchorages are not a method';

  -- ── fixture: anchorages 5 and 6
  FOR i IN 5..6 LOOP
    v_aoi := 'anchorage:img6_guard_' || i;
    INSERT INTO public.imagery_aois (aoi_id, kind, name, geom, centroid_lat, centroid_lon, area_km2, buffer_rule)
    VALUES (v_aoi, 'anchorage', 'IMG-6 guard ' || i,
            ST_MakeEnvelope(-30 - i, -50, -29.9 - i, -49.9, 4326), -49.95, -29.95 - i, 80, 'guard fixture');
    FOR j IN 1..12 LOOP
      v_at  := v_now - make_interval(days => 80 - (j - 1) * 5);     -- days 80 … 25 ago, 6 per half of a 90-day window
      v_ais := pattern[((j - 1) % 6) + 1] * i * 1000;
      INSERT INTO public.ais_aoi_counts (aoi_id, sampled_at, vessels_fresh, vessels_stationary, feed_newest_fix_at)
      VALUES (v_aoi, v_at + interval '10 minutes', v_ais, 0, v_at);
      PERFORM public.imagery_upsert_obs('s1_grd', jsonb_build_array(jsonb_build_object(
        'aoi_id', v_aoi, 'acquired_at', v_at, 'coverage_state', 'clear', 'aoi_covered_fraction', 1,
        'metric_name', 'bright_target_area_m2', 'metric_stat', 'area_m2', 'metric_value', v_ais * 1000.0)));
    END LOOP;
  END LOOP;
  -- ── 4. A passing study, recorded, admits the method and turns S1 on ────
  SELECT * INTO r FROM public.imagery_s1_record_admission(90, 'img6 guard');
  IF NOT r.method_admitted OR r.admitted_n < 6 THEN
    RAISE EXCEPTION 'FAIL 4a: six perfectly tracking anchorages did not admit the method (admitted %, evaluated %)', r.admitted_n, r.evaluated_n;
  END IF;
  IF abs(r.m2_per_vessel - 1000) > 1e-6 THEN RAISE EXCEPTION 'FAIL 4b: calibration % m²/vessel — want 1000', r.m2_per_vessel; END IF;
  IF r.chokepoints_enabled <> 6 THEN RAISE EXCEPTION 'FAIL 4c: % of 6 chokepoint windows switched on', r.chokepoints_enabled; END IF;
  RAISE NOTICE 'PASS 4: admission recorded · 1000 m² per AIS vessel · 6 windows on';

  -- ── 5. Readings: dark-AIS strait shows passes with dates; VOID is not 0 ─
  SELECT * INTO r FROM public.imagery_s1_readings(30) x WHERE x.aoi_id = v_cp AND x.acquired_at = v_now - interval '4 days';
  IF r.vessel_equivalents IS DISTINCT FROM 60::double precision OR r.ratio_to_baseline IS DISTINCT FROM 3::double precision THEN
    RAISE EXCEPTION 'FAIL 5a: Bab-el-Mandeb reading % vessel-eq at % × baseline — want 60 and 3', r.vessel_equivalents, r.ratio_to_baseline;
  END IF;
  SELECT * INTO r FROM public.imagery_s1_readings(30) x WHERE x.aoi_id = v_cp AND x.acquired_at = v_now - interval '2 days';
  IF r.coverage_state IS DISTINCT FROM 'no_acquisition' OR r.bright_area_m2 IS NOT NULL OR r.vessel_equivalents IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 5b: the VOID pass is missing or carries a value';
  END IF;
  RAISE NOTICE 'PASS 5: strait readings carry pass dates · 60 vessel-eq at 3× · VOID pass shown with no value';

  -- ── 6. Convergence: only the clear, baselined, raised look is a candidate
  SELECT count(*) INTO n FROM public.imagery_s1_flag_candidates(v_now - interval '30 days') c WHERE c.aoi_id = v_cp;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 6a: % Bab-el-Mandeb candidates — want 1 (the 3× look; ordinary looks and the VOID pass are not)', n; END IF;
  IF EXISTS (SELECT 1 FROM public.imagery_s1_flag_candidates('-infinity') c WHERE c.bright_area_m2 IS NULL OR c.baseline_n < 3) THEN
    RAISE EXCEPTION 'FAIL 6b: a candidate without a value or without a baseline';
  END IF;
  RAISE NOTICE 'PASS 6: one candidate · a VOID pass contributes nothing';

  -- ── 7. A later failing study revokes: readings gone, windows off ───────
  SELECT * INTO r FROM public.imagery_s1_record_admission(14, 'img6 guard');   -- no fixture pairs in 14 days
  IF r.method_admitted OR r.chokepoints_enabled <> 0 THEN RAISE EXCEPTION 'FAIL 7a: a failing study did not revoke (% windows still on)', r.chokepoints_enabled; END IF;
  IF EXISTS (SELECT 1 FROM public.imagery_s1_readings(120)) THEN RAISE EXCEPTION 'FAIL 7b: readings still shown after revocation'; END IF;
  RAISE NOTICE 'PASS 7: the latest admission rules · revocation hides readings and switches the windows off';
END
$$;

ROLLBACK;

SELECT 'IMG-6 guards: PASS 1-7 (service_role only, 6 small windows S1-off, not admitted = nothing shown, 4 anchorages are not a method, recorded admission + calibration, strait readings with VOID as no value, one convergence candidate, revocation)' AS result,
       (SELECT state FROM public.imagery_s1_status()) AS s1_state,
       (SELECT count(*) FROM public.imagery_s1_admissions) AS admissions_recorded;
