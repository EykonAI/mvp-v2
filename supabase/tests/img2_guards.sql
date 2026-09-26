-- IMG-2 · Sentinel-2 engine — acceptance checks for migration 184.
--
-- READ ONLY. Run in the Supabase SQL Editor AFTER applying 183 and 184.
-- Wrapped in BEGIN … ROLLBACK: the test AOI and observations it writes
-- are rolled back. Each check RAISEs EXCEPTION on failure. A clean run ends
-- with ONE RESULT ROW ("IMG-2 guards: PASS 1-7 …") — paste it back;
-- 'Success. No rows returned' means the file did NOT run whole.

BEGIN;

DO $$
DECLARE
  n        integer;
  n_src    integer;
  r        record;
  v_con    text;
  v_state  text;
  t0       timestamptz := date_trunc('day', now()) - interval '40 days';
BEGIN
  -- ── 1. Objects and access ──────────────────────────────────────────────
  IF to_regclass('public.imagery_aoi_checks') IS NULL THEN
    RAISE EXCEPTION 'FAIL 1a: imagery_aoi_checks missing — 184 not applied';
  END IF;
  IF to_regprocedure('public.imagery_s2_due(integer,integer)') IS NULL
     OR to_regprocedure('public.imagery_upsert_s2(jsonb)') IS NULL
     OR to_regprocedure('public.imagery_latest(double precision,double precision,double precision,double precision,integer)') IS NULL THEN
    RAISE EXCEPTION 'FAIL 1b: a 184 function is missing';
  END IF;
  IF has_table_privilege('anon', 'public.imagery_aoi_checks', 'SELECT')
     OR has_function_privilege('anon', 'public.imagery_upsert_s2(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.imagery_latest(double precision,double precision,double precision,double precision,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL 1c: anon/authenticated can reach a 184 object';
  END IF;
  RAISE NOTICE 'PASS 1: objects exist · service_role only';

  -- ── 2. Only mines are switched on, and all of them ─────────────────────
  SELECT count(*) INTO n FROM public.imagery_aois
   WHERE retired_at IS NULL AND 's2_l2a' = ANY (sensors_enabled) AND kind <> 'mine';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 2a: % non-mine AOIs have s2_l2a enabled', n; END IF;
  SELECT count(*) FILTER (WHERE 's2_l2a' = ANY (sensors_enabled)), count(*) INTO n, n_src
    FROM public.imagery_aois WHERE retired_at IS NULL AND kind = 'mine';
  IF n <> n_src THEN RAISE EXCEPTION 'FAIL 2b: % of % mine AOIs enabled', n, n_src; END IF;
  RAISE NOTICE 'PASS 2: s2_l2a on for all % mine AOIs and nothing else', n;

  -- test AOI, top priority, isolated from real sites
  INSERT INTO public.imagery_aois (aoi_id, kind, name, geom, centroid_lat, centroid_lon, area_km2, buffer_rule, sensors_enabled, priority)
  VALUES ('anchorage:img2_guard_test', 'anchorage', 'IMG-2 guard test',
          ST_Buffer(ST_SetSRID(ST_MakePoint(-40.0, -60.0), 4326)::geography, 2000)::geometry,
          -60.0, -40.0, 12.5, 'guard test', ARRAY['s2_l2a'], 3);

  -- ── 3. Due list: never-checked = 30-day window; checked = not due; re-read tail ──
  SELECT * INTO r FROM public.imagery_s2_due(1, 20);
  IF r.aoi_id IS DISTINCT FROM 'anchorage:img2_guard_test' OR r.last_checked_at IS NOT NULL
     OR abs(extract(epoch FROM (r.window_to - r.window_from)) - 30 * 86400) > 120 THEN
    RAISE EXCEPTION 'FAIL 3a: first due row % / window % → % (want the test AOI, 30 days)', r.aoi_id, r.window_from, r.window_to;
  END IF;
  INSERT INTO public.imagery_aoi_checks (aoi_id, sensor, checked_at, window_from, window_to, acquisitions_found, rows_written)
  -- checked 3 h ago (now() is constant inside a transaction, so the fixture
  -- must sit clearly past the 1-hour floor for the min_age-0 call below)
  VALUES ('anchorage:img2_guard_test', 's2_l2a', now() - interval '3 hours', now() - interval '30 days', now() - interval '3 hours', 0, 0);
  SELECT count(*) INTO n FROM public.imagery_s2_due(200, 20) d WHERE d.aoi_id = 'anchorage:img2_guard_test';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 3b: an AOI checked 3 h ago is due again at min_age 20 h'; END IF;
  SELECT * INTO r FROM public.imagery_s2_due(200, 0) d WHERE d.aoi_id = 'anchorage:img2_guard_test';
  -- a missing row must FAIL, not compare NULL and pass
  IF r.aoi_id IS NULL THEN RAISE EXCEPTION 'FAIL 3c: the checked AOI is not due at min_age 0'; END IF;
  IF abs(extract(epoch FROM (r.window_from - (now() - interval '3 hours' - interval '5 days')))) > 120 THEN
    RAISE EXCEPTION 'FAIL 3c: re-check window starts % — want last window_to minus 5 days', r.window_from;
  END IF;
  RAISE NOTICE 'PASS 3: first look = 30 days · checked AOI not due · next window re-reads the last 5 days';

  -- ── 4. Write path: baseline = median of previous clear values, n ≥ 3 ────
  PERFORM public.imagery_upsert_s2(jsonb_build_array(
    jsonb_build_object('aoi_id','anchorage:img2_guard_test','acquired_at',t0,'coverage_state','clear','cloud_fraction_aoi',0.02,'aoi_covered_fraction',1,'metric_name','ndvi_median','metric_stat','median','metric_value',0.10,'chip_path','sentinel/imagery/t0.png'),
    jsonb_build_object('aoi_id','anchorage:img2_guard_test','acquired_at',t0 + interval '5 days','coverage_state','clear','cloud_fraction_aoi',0.00,'aoi_covered_fraction',1,'metric_name','ndvi_median','metric_stat','median','metric_value',0.90),
    jsonb_build_object('aoi_id','anchorage:img2_guard_test','acquired_at',t0 + interval '10 days','coverage_state','clear','cloud_fraction_aoi',0.01,'aoi_covered_fraction',1,'metric_name','ndvi_median','metric_stat','median','metric_value',0.20)));
  SELECT * INTO r FROM public.imagery_upsert_s2(jsonb_build_array(
    jsonb_build_object('aoi_id','anchorage:img2_guard_test','acquired_at',t0 + interval '15 days','coverage_state','clear','cloud_fraction_aoi',0.03,'aoi_covered_fraction',1,'metric_name','ndvi_median','metric_stat','median','metric_value',0.25,'chip_path','sentinel/imagery/t15.png')));
  SELECT baseline_median, baseline_n INTO r FROM public.imagery_observations
   WHERE aoi_id = 'anchorage:img2_guard_test' AND acquired_at = t0 + interval '15 days';
  -- median of {0.10, 0.90, 0.20} is 0.20; a MEAN would be 0.40 — the check tells them apart
  IF r.baseline_n IS DISTINCT FROM 3 OR abs(r.baseline_median - 0.20) > 1e-9 THEN
    RAISE EXCEPTION 'FAIL 4a: baseline % (n %) — want median 0.20 over n 3', r.baseline_median, r.baseline_n;
  END IF;
  SELECT count(*) INTO n FROM public.imagery_observations
   WHERE aoi_id = 'anchorage:img2_guard_test' AND acquired_at < t0 + interval '15 days' AND baseline_n IS NOT NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 4b: % rows carry a baseline built on fewer than 3 looks', n; END IF;
  RAISE NOTICE 'PASS 4: baseline is the MEDIAN of previous clear looks (0.20, not the mean 0.40), and absent below n 3';

  -- ── 5. VOID through the write path; re-read is idempotent and keeps the chip ─
  BEGIN
    PERFORM public.imagery_upsert_s2(jsonb_build_array(
      jsonb_build_object('aoi_id','anchorage:img2_guard_test','acquired_at',t0 + interval '20 days','coverage_state','cloudy','cloud_fraction_aoi',0.8,'aoi_covered_fraction',1,'metric_name','ndvi_median','metric_stat','median','metric_value',0.3)));
    RAISE EXCEPTION 'FAIL 5a: a cloudy look with a value was written' USING ERRCODE = 'P0002';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con <> 'io_value_only_when_clear' THEN RAISE EXCEPTION 'FAIL 5a: refused by % not io_value_only_when_clear', v_con; END IF;
  END;
  PERFORM public.imagery_upsert_s2(jsonb_build_array(
    jsonb_build_object('aoi_id','anchorage:img2_guard_test','acquired_at',t0 + interval '20 days','coverage_state','cloudy','cloud_fraction_aoi',0.8,'aoi_covered_fraction',1)));
  -- re-read of an existing clear look, arriving without a chip
  PERFORM public.imagery_upsert_s2(jsonb_build_array(
    jsonb_build_object('aoi_id','anchorage:img2_guard_test','acquired_at',t0 + interval '15 days','coverage_state','clear','cloud_fraction_aoi',0.03,'aoi_covered_fraction',1,'metric_name','ndvi_median','metric_stat','median','metric_value',0.25)));
  SELECT count(*) INTO n FROM public.imagery_observations WHERE aoi_id = 'anchorage:img2_guard_test';
  IF n <> 5 THEN RAISE EXCEPTION 'FAIL 5b: % rows after a re-read — want 5 (4 clear + 1 cloudy)', n; END IF;
  IF (SELECT chip_path FROM public.imagery_observations WHERE aoi_id = 'anchorage:img2_guard_test' AND acquired_at = t0 + interval '15 days')
     IS DISTINCT FROM 'sentinel/imagery/t15.png' THEN
    RAISE EXCEPTION 'FAIL 5c: a re-read without a chip erased the stored chip';
  END IF;
  RAISE NOTICE 'PASS 5: cloudy-with-value refused by io_value_only_when_clear · cloudy VOID written · re-read idempotent, chip kept';

  -- ── 6. Globe read: the latest look shows its real state ────────────────
  SELECT * INTO r FROM public.imagery_latest(-41, -61, -39, -59, 50) l WHERE l.aoi_id = 'anchorage:img2_guard_test';
  IF r.latest_state IS DISTINCT FROM 'cloudy' OR r.latest_acquired_at <> t0 + interval '20 days' THEN
    RAISE EXCEPTION 'FAIL 6a: latest look reads % on % — want cloudy on the newest date', r.latest_state, r.latest_acquired_at;
  END IF;
  IF r.clear_chip_path IS DISTINCT FROM 'sentinel/imagery/t15.png' OR r.clear_acquired_at <> t0 + interval '15 days' THEN
    RAISE EXCEPTION 'FAIL 6b: latest clear look % / % is wrong', r.clear_acquired_at, r.clear_chip_path;
  END IF;
  IF r.attribution_text NOT LIKE 'Contains modified Copernicus Sentinel data 20__' THEN
    RAISE EXCEPTION 'FAIL 6c: attribution "%" — year not filled', r.attribution_text;
  END IF;
  SELECT count(*) INTO n FROM public.imagery_latest(10, 10, 11, 11, 50) l WHERE l.aoi_id = 'anchorage:img2_guard_test';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 6d: an AOI outside the bbox was returned'; END IF;
  RAISE NOTICE 'PASS 6: latest = cloudy (not hidden behind the older clear chip) · clear chip separate · credit with year · bbox honoured';

  -- ── 7. Check log CHECKs bite ───────────────────────────────────────────
  BEGIN
    INSERT INTO public.imagery_aoi_checks (aoi_id, sensor, window_from, window_to, acquisitions_found, rows_written, error)
    VALUES ('anchorage:img2_guard_test','s2_l2a', now() - interval '2 days', now(), 3, 3, 'HTTP 500');
    RAISE EXCEPTION 'FAIL 7a: a check with both an error and counts was stored' USING ERRCODE = 'P0002';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.imagery_aoi_checks (aoi_id, sensor, window_from, window_to, acquisitions_found, rows_written)
    VALUES ('anchorage:img2_guard_test','s2_l2a', now() - interval '2 days', now(), 1, 2);
    RAISE EXCEPTION 'FAIL 7b: a check wrote more rows than acquisitions found' USING ERRCODE = 'P0002';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'PASS 7: check log refuses error-with-counts and rows > acquisitions';
END
$$;

ROLLBACK;

-- RESULT ROW (read-only). Reached only when every check above passed.
SELECT 'IMG-2 guards: PASS 1-7 (access, mines only switched on, due windows re-read 5 days, median baseline n>=3, VOID via write path, latest look shows its state, check log)' AS result,
       (SELECT count(*) FROM public.imagery_aois WHERE retired_at IS NULL AND 's2_l2a' = ANY (sensors_enabled)) AS s2_enabled_aois,
       (SELECT count(*) FROM public.imagery_s2_due(200, 20))                                                 AS due_now,
       (SELECT count(*) FROM public.imagery_observations WHERE sensor = 's2_l2a')                            AS s2_observations;
