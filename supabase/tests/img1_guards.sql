-- IMG-1 · Imagery Layer schema — acceptance checks for migration 183.
--
-- READ ONLY. Run in the Supabase SQL Editor AFTER applying 183 (whole file).
-- Wrapped in BEGIN … ROLLBACK: the test rows it writes to prove each rule
-- BITES are rolled back with everything else. Each check RAISEs EXCEPTION
-- on failure, which stops the script with its FAIL message. A clean run
-- ends with ONE RESULT ROW ("IMG-1 guards: PASS 1-9 …") — paste that row
-- back. Without that row, 'Success. No rows returned' means the file did
-- NOT run whole.
--
-- Every rejection is asserted by SQLSTATE AND by the name of the
-- constraint that fired, so a row refused for the wrong reason fails too.

BEGIN;

DO $$
DECLARE
  t           text;
  v_state     text;
  v_con       text;
  v_msg       text;
  n           integer;
  n_src       integer;
  v_plan      text := '';
  r           record;
  v_obs_ok    bigint;

  -- expect_reject: run p_sql in a sub-transaction; it must fail with
  -- p_state, and (for CHECKs) name p_constraint.
BEGIN
  -- ── 1. Objects exist ────────────────────────────────────────────────────
  FOREACH t IN ARRAY ARRAY['imagery_licences','imagery_aois','imagery_observations','webcams','webcam_liveness'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'FAIL 1a: table public.% does not exist — 183 not applied', t;
    END IF;
  END LOOP;
  IF to_regprocedure('public.imagery_aois_sync()') IS NULL THEN
    RAISE EXCEPTION 'FAIL 1b: function imagery_aois_sync() missing';
  END IF;
  SELECT count(*) INTO n FROM pg_trigger
   WHERE NOT tgisinternal
     AND tgname IN ('imagery_observations_licence_gate','webcams_licence_gate','imagery_licences_downgrade','imagery_aois_frozen');
  IF n <> 4 THEN RAISE EXCEPTION 'FAIL 1c: expected 4 triggers, found %', n; END IF;
  RAISE NOTICE 'PASS 1: 5 tables, sync function, 4 triggers';

  -- ── 2. Access: RLS on, service_role only ───────────────────────────────
  FOREACH t IN ARRAY ARRAY['imagery_licences','imagery_aois','imagery_observations','webcams','webcam_liveness'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION 'FAIL 2a: RLS is off on %', t;
    END IF;
    IF has_table_privilege('anon', 'public.' || t, 'SELECT')
       OR has_table_privilege('authenticated', 'public.' || t, 'SELECT') THEN
      RAISE EXCEPTION 'FAIL 2b: anon or authenticated can read %', t;
    END IF;
    IF NOT has_table_privilege('service_role', 'public.' || t, 'SELECT') THEN
      RAISE EXCEPTION 'FAIL 2c: service_role cannot read %', t;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.imagery_aois_sync()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.imagery_aois_sync()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL 2d: anon or authenticated can execute imagery_aois_sync()';
  END IF;
  RAISE NOTICE 'PASS 2: RLS on all 5 tables · service_role only · sync not executable by anon/authenticated';

  -- ── 3. Seed = source registries (sites, not rows); nothing imaged yet ──
  SELECT count(*) INTO n FROM public.imagery_aois WHERE kind = 'refinery_complex' AND retired_at IS NULL;
  SELECT count(*) INTO n_src FROM public.refinery_complexes c WHERE c.retired_at IS NULL
     AND EXISTS (SELECT 1 FROM public.refinery_complex_members m WHERE m.cluster_key = c.cluster_key AND m.left_at IS NULL);
  IF n <> n_src OR n = 0 THEN RAISE EXCEPTION 'FAIL 3a: refinery_complex AOIs % vs active complexes with members %', n, n_src; END IF;
  SELECT count(*) INTO n FROM public.imagery_aois WHERE kind = 'lng_terminal' AND retired_at IS NULL;
  SELECT count(DISTINCT coalesce(project_id, id)) INTO n_src FROM public.lng_terminals WHERE status = 'operating';
  IF n <> n_src THEN RAISE EXCEPTION 'FAIL 3b: lng_terminal AOIs % vs operating terminal sites %', n, n_src; END IF;
  SELECT count(*) INTO n FROM public.imagery_aois WHERE kind = 'port' AND retired_at IS NULL;
  SELECT count(*) INTO n_src FROM public.ports WHERE harbor_size IN ('L','M');
  IF n <> n_src THEN RAISE EXCEPTION 'FAIL 3c: port AOIs % vs L/M ports %', n, n_src; END IF;
  SELECT count(*) INTO n FROM public.imagery_aois WHERE kind = 'mine' AND retired_at IS NULL;
  -- sites, not rows: a mine listed in two workspaces is one AOI
  SELECT count(DISTINCT (round(latitude::numeric, 3), round(longitude::numeric, 3))) INTO n_src
    FROM public.mines_curated WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
  IF n <> n_src THEN RAISE EXCEPTION 'FAIL 3d: mine AOIs % vs distinct mine sites %', n, n_src; END IF;
  -- IMG-1 images nothing. Once 184 (IMG-2) is applied it switches mines on,
  -- and img2_guards.sql owns that assertion — so this one only holds pre-184.
  IF to_regclass('public.imagery_aoi_checks') IS NULL THEN
    SELECT count(*) INTO n FROM public.imagery_aois WHERE sensors_enabled <> '{}';
    IF n <> 0 THEN RAISE EXCEPTION 'FAIL 3e: % AOIs already have a sensor enabled — IMG-1 must image nothing', n; END IF;
    RAISE NOTICE 'PASS 3: AOIs match their registries by site · no sensor enabled';
  ELSE
    RAISE NOTICE 'PASS 3: AOIs match their registries by site (184 applied: sensor enablement is checked by img2_guards.sql)';
  END IF;

  -- ── 4. Sync is idempotent ──────────────────────────────────────────────
  SELECT coalesce(sum(inserted + refreshed + retired), 0) INTO n FROM public.imagery_aois_sync();
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 4: a second imagery_aois_sync() changed % rows', n; END IF;
  RAISE NOTICE 'PASS 4: second sync inserts, refreshes and retires nothing';

  -- A test AOI for the bite tests (rolled back)
  INSERT INTO public.imagery_aois (aoi_id, kind, name, geom, centroid_lat, centroid_lon, area_km2, buffer_rule)
  VALUES ('anchorage:img1_guard_test', 'anchorage', 'IMG-1 guard test',
          ST_Buffer(ST_SetSRID(ST_MakePoint(50.0, 26.0), 4326)::geography, 1000)::geometry, 26.0, 50.0, 3.14, 'guard test');

  -- ── 5. VOID CHECKs bite, each for its own reason ───────────────────────
  FOR r IN SELECT * FROM (VALUES
    ('io_value_only_when_clear', $q$INSERT INTO public.imagery_observations (aoi_id, sensor, provider_id, acquired_at, coverage_state, cloud_fraction_aoi, aoi_covered_fraction, metric_name, metric_stat, metric_value)
         VALUES ('anchorage:img1_guard_test','s2_l2a','copernicus_cdse','2026-09-01T10:00Z','cloudy',0.9,1,'stockpile_index','median',0.4)$q$),
    ('io_metric_stat',           $q$INSERT INTO public.imagery_observations (aoi_id, sensor, provider_id, acquired_at, coverage_state, cloud_fraction_aoi, aoi_covered_fraction, metric_name, metric_stat, metric_value)
         VALUES ('anchorage:img1_guard_test','s2_l2a','copernicus_cdse','2026-09-01T10:00Z','clear',0.0,1,'stockpile_index','mean',0.4)$q$),
    ('io_sar_no_cloud',          $q$INSERT INTO public.imagery_observations (aoi_id, sensor, provider_id, acquired_at, coverage_state, cloud_fraction_aoi, aoi_covered_fraction, metric_name, metric_stat, metric_value)
         VALUES ('anchorage:img1_guard_test','s1_grd','copernicus_cdse','2026-09-01T10:00Z','clear',0.2,1,'vessel_count','count',12)$q$),
    ('io_clear_optical_has_cloud', $q$INSERT INTO public.imagery_observations (aoi_id, sensor, provider_id, acquired_at, coverage_state, aoi_covered_fraction, metric_name, metric_stat, metric_value)
         VALUES ('anchorage:img1_guard_test','s2_l2a','copernicus_cdse','2026-09-01T10:00Z','clear',1,'stockpile_index','median',0.4)$q$),
    ('io_clear_is_covered',      $q$INSERT INTO public.imagery_observations (aoi_id, sensor, provider_id, acquired_at, coverage_state, aoi_covered_fraction, metric_name, metric_stat, metric_value)
         VALUES ('anchorage:img1_guard_test','s1_grd','copernicus_cdse','2026-09-01T10:00Z','clear',0.5,'vessel_count','count',3)$q$),
    ('io_void_no_chip',          $q$INSERT INTO public.imagery_observations (aoi_id, sensor, provider_id, acquired_at, coverage_state, chip_path)
         VALUES ('anchorage:img1_guard_test','s2_l2a','copernicus_cdse','2026-09-01T10:00Z','no_acquisition','sentinel/x.png')$q$),
    ('io_baseline_pair',         $q$INSERT INTO public.imagery_observations (aoi_id, sensor, provider_id, acquired_at, coverage_state, aoi_covered_fraction, metric_name, metric_stat, metric_value, baseline_median)
         VALUES ('anchorage:img1_guard_test','s1_grd','copernicus_cdse','2026-09-01T10:00Z','clear',1,'vessel_count','count',3,5)$q$),
    ('ia_sensors_known',         $q$UPDATE public.imagery_aois SET sensors_enabled = ARRAY['planet_skysat'] WHERE aoi_id = 'anchorage:img1_guard_test'$q$),
    ('ia_retired_consistent',    $q$UPDATE public.imagery_aois SET retired_at = now(), retired_reason = 'x', sensors_enabled = ARRAY['s2_l2a'] WHERE aoi_id = 'anchorage:img1_guard_test'$q$),
    ('wc_id_format',             $q$INSERT INTO public.webcams (webcam_id, provider_id, provider_cam_id, upstream_url, name, latitude, longitude, category, media_type, attribution_text)
         VALUES ('cam-1','tfl_jamcams','g1','https://example.org/a.jpg','t',51.5,-0.1,'traffic','image','Powered by TfL Open Data')$q$)
  ) AS x(con, sql) LOOP
    BEGIN
      EXECUTE r.sql;
      RAISE EXCEPTION 'FAIL 5: accepted a row % should refuse', r.con USING ERRCODE = 'P0002';
    EXCEPTION
      WHEN check_violation THEN
        GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
        IF v_con IS DISTINCT FROM r.con THEN
          RAISE EXCEPTION 'FAIL 5: expected % to refuse, but % did', r.con, v_con;
        END IF;
    END;
  END LOOP;
  RAISE NOTICE 'PASS 5: 10 CHECKs refuse their own bad row (value only when clear, no mean, SAR no cloud, clear optical has cloud, clear is covered, void has no chip, baseline with n, known sensors, retired images nothing, opaque cam id)';

  -- ── 6. Valid rows are accepted (a guard that refuses everything is not a guard)
  INSERT INTO public.imagery_observations (aoi_id, sensor, provider_id, acquired_at, coverage_state, aoi_covered_fraction, metric_name, metric_stat, metric_value, baseline_median, baseline_n, baseline_window)
  VALUES ('anchorage:img1_guard_test','s1_grd','copernicus_cdse','2026-09-01T10:00Z','clear',1,'vessel_count','count',14,11,8,'2026-07-01..2026-08-31')
  RETURNING id INTO v_obs_ok;
  INSERT INTO public.imagery_observations (aoi_id, sensor, provider_id, acquired_at, coverage_state, cloud_fraction_aoi, aoi_covered_fraction)
  VALUES ('anchorage:img1_guard_test','s2_l2a','copernicus_cdse','2026-09-02T10:00Z','cloudy',0.93,1);
  INSERT INTO public.imagery_observations (aoi_id, sensor, provider_id, acquired_at, coverage_state)
  VALUES ('anchorage:img1_guard_test','s1_grd','copernicus_cdse','2026-09-07T10:00Z','no_acquisition');
  RAISE NOTICE 'PASS 6: a clear SAR count with baseline, a cloudy VOID and a no-acquisition VOID are accepted';

  -- ── 7. Licence gate (triggers) ─────────────────────────────────────────
  BEGIN
    INSERT INTO public.imagery_observations (aoi_id, sensor, provider_id, acquired_at, coverage_state)
    VALUES ('anchorage:img1_guard_test','s1_grd','global_fishing_watch','2026-09-03T10:00Z','no_acquisition');
    RAISE EXCEPTION 'FAIL 7a: stored an observation under a forbidden provider' USING ERRCODE = 'P0002';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT LIKE 'imagery licence gate:%' THEN RAISE EXCEPTION 'FAIL 7a: wrong refusal: %', v_msg; END IF;
  END;
  BEGIN
    INSERT INTO public.webcams (webcam_id, provider_id, provider_cam_id, upstream_url, name, latitude, longitude, category, media_type, attribution_text)
    VALUES ('wc_00000000000000aa','unsecured_ip_cams','x','http://198.51.100.7/cam.jpg','x',1,1,'other','image','x');
    RAISE EXCEPTION 'FAIL 7b: registered a camera from an excluded provider' USING ERRCODE = 'P0002';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT LIKE 'imagery licence gate:%' THEN RAISE EXCEPTION 'FAIL 7b: wrong refusal: %', v_msg; END IF;
  END;
  BEGIN
    INSERT INTO public.webcams (webcam_id, provider_id, provider_cam_id, upstream_url, name, latitude, longitude, category, media_type, attribution_text, is_live)
    VALUES ('wc_00000000000000bb','windy_webcams','w1','https://example.org/w.jpg','w',45,7,'mountain','image','Webcams provided by windy.com', true);
    RAISE EXCEPTION 'FAIL 7c: made a camera live under a licence that is not ok' USING ERRCODE = 'P0002';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT LIKE 'imagery licence gate:%' THEN RAISE EXCEPTION 'FAIL 7c: wrong refusal: %', v_msg; END IF;
  END;
  -- …and the positive case: a live camera under an ok licence, then the licence is downgraded
  INSERT INTO public.webcams (webcam_id, provider_id, provider_cam_id, upstream_url, name, latitude, longitude, category, media_type, attribution_text, is_live)
  VALUES ('wc_00000000000000cc','tfl_jamcams','guard','https://example.org/t.jpg','Guard cam',51.5,-0.12,'traffic','image','Powered by TfL Open Data', true);
  IF NOT (SELECT ST_DWithin(geom, ST_SetSRID(ST_MakePoint(-0.12, 51.5), 4326)::geography, 1) FROM public.webcams WHERE webcam_id = 'wc_00000000000000cc') THEN
    RAISE EXCEPTION 'FAIL 7d: webcams.geom is not derived from latitude/longitude';
  END IF;
  UPDATE public.imagery_licences SET commercial_status = 'unclear' WHERE provider_id = 'tfl_jamcams';
  IF (SELECT is_live FROM public.webcams WHERE webcam_id = 'wc_00000000000000cc') THEN
    RAISE EXCEPTION 'FAIL 7e: downgrading a licence left its camera live';
  END IF;
  RAISE NOTICE 'PASS 7: forbidden provider refused · excluded provider refused · live needs ok · geom derived · downgrade takes cameras down';

  -- ── 8. Frozen footprint and identity ───────────────────────────────────
  BEGIN
    UPDATE public.imagery_aois
       SET geom = ST_Buffer(ST_SetSRID(ST_MakePoint(50.0, 26.0), 4326)::geography, 5000)::geometry
     WHERE aoi_id = 'anchorage:img1_guard_test';
    RAISE EXCEPTION 'FAIL 8a: changed the footprint of an observed AOI' USING ERRCODE = 'P0002';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  BEGIN
    DELETE FROM public.imagery_aois WHERE aoi_id = 'anchorage:img1_guard_test';
    RAISE EXCEPTION 'FAIL 8b: deleted an AOI' USING ERRCODE = 'P0002';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  RAISE NOTICE 'PASS 8: observed footprint frozen · AOIs never deleted';

  -- ── 9. The spatial index is usable ─────────────────────────────────────
  SET LOCAL enable_seqscan = off;
  FOR r IN EXECUTE $q$EXPLAIN SELECT aoi_id FROM public.imagery_aois
                      WHERE geom && ST_MakeEnvelope(49, 25, 51, 27, 4326)$q$ LOOP
    v_plan := v_plan || r."QUERY PLAN" || ' ';
  END LOOP;
  IF v_plan NOT LIKE '%imagery_aois_geom_gist%' THEN
    RAISE EXCEPTION 'FAIL 9: bbox query does not use imagery_aois_geom_gist: %', v_plan;
  END IF;
  RAISE NOTICE 'PASS 9: bbox query uses imagery_aois_geom_gist';
END
$$;

ROLLBACK;

-- RESULT ROW (read-only). Reached only when every check above passed: a FAIL
-- aborts the script before this statement runs. Paste this row back.
SELECT 'IMG-1 guards: PASS 1-9 (objects, access, seed = registries by site, idempotent sync, 10 CHECKs bite, valid rows accepted, licence gate, frozen footprints, GIST used)' AS result,
       (SELECT count(*) FROM public.imagery_aois WHERE retired_at IS NULL)                                   AS active_aois,
       (SELECT count(*) FROM public.imagery_aois WHERE retired_at IS NULL AND kind = 'refinery_complex')     AS refinery_complexes,
       (SELECT count(*) FROM public.imagery_aois WHERE retired_at IS NULL AND kind = 'lng_terminal')         AS lng_terminals,
       (SELECT count(*) FROM public.imagery_aois WHERE retired_at IS NULL AND kind = 'port')                 AS ports,
       (SELECT count(*) FROM public.imagery_aois WHERE retired_at IS NULL AND kind = 'mine')                 AS mines,
       (SELECT count(*) FROM public.imagery_licences WHERE commercial_status = 'ok')                          AS licences_ok,
       (SELECT count(*) FROM public.imagery_observations)                                                     AS observations;
