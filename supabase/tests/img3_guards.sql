-- IMG-3 · Sentinel-1 study — acceptance checks for migration 185.
--
-- READ ONLY and LIGHT. Run in the Supabase SQL Editor AFTER 183, 184, 185.
-- BEGIN … ROLLBACK: every test row is rolled back. It never runs
-- imagery_derive_anchorages() over the real AIS history and never writes to
-- vessel_positions (brief §16.13: production reads stay light) — derivation
-- is proven in the PGlite replay attached to the PR. A clean run ends with
-- ONE RESULT ROW ("IMG-3 guards: PASS 1-6 …"); 'Success. No rows returned'
-- means it did NOT run whole.

BEGIN;

DO $$
DECLARE
  n     integer;
  r     record;
  v_con text;
  t0    timestamptz := date_trunc('hour', now()) - interval '50 days';
  i     integer;
BEGIN
  -- ── 1. Objects, access, schedule ───────────────────────────────────────
  IF to_regclass('public.ais_aoi_counts') IS NULL OR to_regclass('public.imagery_anchorage_stats') IS NULL THEN
    RAISE EXCEPTION 'FAIL 1a: 185 tables missing — 185 not applied';
  END IF;
  IF to_regprocedure('public.imagery_s1_study(integer,integer)') IS NULL
     OR to_regprocedure('public.imagery_upsert_obs(text,jsonb)') IS NULL
     OR to_regprocedure('public.imagery_derive_anchorages(integer,integer)') IS NULL THEN
    RAISE EXCEPTION 'FAIL 1b: a 185 function is missing';
  END IF;
  IF has_table_privilege('anon', 'public.ais_aoi_counts', 'SELECT')
     OR has_function_privilege('authenticated', 'public.imagery_derive_anchorages(integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL 1c: anon/authenticated can reach a 185 object';
  END IF;
  SELECT count(*) INTO n FROM cron.job WHERE jobname = 'imagery-ais-aoi-counts' AND active;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 1d: pg_cron job imagery-ais-aoi-counts: % active rows, want 1', n; END IF;
  RAISE NOTICE 'PASS 1: objects · service_role only · hourly AIS-count job active';

  -- test anchorage, isolated (South Atlantic, no real AIS there)
  INSERT INTO public.imagery_aois (aoi_id, kind, name, geom, centroid_lat, centroid_lon, area_km2, buffer_rule)
  VALUES ('anchorage:img3_guard_test', 'anchorage', 'IMG-3 guard test',
          ST_Buffer(ST_SetSRID(ST_MakePoint(-30.0, -50.0), 4326)::geography, 3000)::geometry, -50.0, -30.0, 28.2, 'guard test');

  -- ── 2. AIS counts: VOID is NULL, never zero ────────────────────────────
  BEGIN
    INSERT INTO public.ais_aoi_counts (aoi_id, sampled_at, vessels_fresh, vessels_stationary)
    VALUES ('anchorage:img3_guard_test', t0, 5, NULL);
    RAISE EXCEPTION 'FAIL 2a: a half-VOID count row was stored' USING ERRCODE = 'P0002';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con <> 'aac_pair' THEN RAISE EXCEPTION 'FAIL 2a: refused by % not aac_pair', v_con; END IF;
  END;
  BEGIN
    INSERT INTO public.ais_aoi_counts (aoi_id, sampled_at, vessels_fresh, vessels_stationary)
    VALUES ('anchorage:img3_guard_test', t0, 3, 4);
    RAISE EXCEPTION 'FAIL 2b: more stationary than fresh vessels was stored' USING ERRCODE = 'P0002';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- the real sampler, on the one test AOI plus any real anchorages (none at apply time)
  n := public.imagery_sample_ais_counts();
  SELECT * INTO r FROM public.ais_aoi_counts
   WHERE aoi_id = 'anchorage:img3_guard_test' AND sampled_at = date_trunc('minute', now());
  IF r.aoi_id IS NULL THEN RAISE EXCEPTION 'FAIL 2c: the sampler wrote no row for an active anchorage'; END IF;
  IF r.feed_newest_fix_at IS DISTINCT FROM (SELECT max(updated_at) FROM public.vessel_positions) THEN
    RAISE EXCEPTION 'FAIL 2d: feed_newest_fix_at % is not the newest AIS fix', r.feed_newest_fix_at;
  END IF;
  IF r.feed_newest_fix_at < now() - interval '30 minutes' AND r.vessels_fresh IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 2e: feed is stale (% ) but the count is % — must be NULL', r.feed_newest_fix_at, r.vessels_fresh;
  END IF;
  RAISE NOTICE 'PASS 2: half-VOID refused · stationary <= fresh · sampler writes a row, NULL when the feed is stale (feed newest fix %)', r.feed_newest_fix_at;

  -- ── 3. S1 write path: no cloud on radar; clear area rows accepted ──────
  BEGIN
    PERFORM public.imagery_upsert_obs('s1_grd', jsonb_build_array(jsonb_build_object(
      'aoi_id','anchorage:img3_guard_test','acquired_at',t0,'coverage_state','clear','cloud_fraction_aoi',0.1,
      'aoi_covered_fraction',1,'metric_name','bright_target_area_m2','metric_stat','area_m2','metric_value',1000)));
    RAISE EXCEPTION 'FAIL 3a: an S1 row with a cloud fraction was stored' USING ERRCODE = 'P0002';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con <> 'io_sar_no_cloud' THEN RAISE EXCEPTION 'FAIL 3a: refused by % not io_sar_no_cloud', v_con; END IF;
  END;
  BEGIN
    PERFORM public.imagery_upsert_obs('gibs_true_colour', '[]'::jsonb);
    RAISE EXCEPTION 'FAIL 3b: imagery_upsert_obs accepted an unsupported sensor' USING ERRCODE = 'P0002';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  RAISE NOTICE 'PASS 3: radar with a cloud fraction refused by io_sar_no_cloud · unsupported sensor refused';

  -- ── 4. The study pairs, ranks and ADMITS a real relationship ──────────
  -- 12 clear S1 looks, 5 days apart; AIS rises with S1 (monotone → rho = 1)
  FOR i IN 0..11 LOOP
    PERFORM public.imagery_upsert_obs('s1_grd', jsonb_build_array(jsonb_build_object(
      'aoi_id','anchorage:img3_guard_test','acquired_at', t0 + make_interval(days => 4 * i, mins => 10),
      'coverage_state','clear','aoi_covered_fraction',1,
      'metric_name','bright_target_area_m2','metric_stat','area_m2','metric_value', 1000 + 500 * i)));
    INSERT INTO public.ais_aoi_counts (aoi_id, sampled_at, vessels_fresh, vessels_stationary)
    VALUES ('anchorage:img3_guard_test', t0 + make_interval(days => 4 * i), 3 + 2 * i, 2 + i);
  END LOOP;
  SELECT * INTO r FROM public.imagery_s1_study(60, 30) s WHERE s.aoi_id = 'anchorage:img3_guard_test';
  IF r.pairs IS DISTINCT FROM 12 OR abs(r.spearman_rho - 1) > 1e-9 THEN
    RAISE EXCEPTION 'FAIL 4a: pairs % rho % — want 12 pairs, rho 1', r.pairs, r.spearman_rho;
  END IF;
  IF NOT r.rho_ok THEN RAISE EXCEPTION 'FAIL 4b: rho 1 on 12 pairs not rho_ok'; END IF;
  RAISE NOTICE 'PASS 4: 12 looks paired within ±30 min · Spearman rho = 1 · rho_ok';

  -- ── 5. …and REFUSES when the AIS side says otherwise ───────────────────
  UPDATE public.ais_aoi_counts SET vessels_fresh = 30 - 2 * (extract(epoch FROM (sampled_at - t0)) / 345600)::integer,
                                   vessels_stationary = 0
   WHERE aoi_id = 'anchorage:img3_guard_test' AND sampled_at < date_trunc('minute', now()) - interval '1 day';
  SELECT * INTO r FROM public.imagery_s1_study(60, 30) s WHERE s.aoi_id = 'anchorage:img3_guard_test';
  IF r.spearman_rho IS NULL OR r.spearman_rho > -0.99 OR r.rho_ok OR r.admitted THEN
    RAISE EXCEPTION 'FAIL 5a: anti-correlated series read rho % rho_ok % admitted %', r.spearman_rho, r.rho_ok, r.admitted;
  END IF;
  -- VOID AIS pairs with nothing
  UPDATE public.ais_aoi_counts SET vessels_fresh = NULL, vessels_stationary = NULL
   WHERE aoi_id = 'anchorage:img3_guard_test' AND sampled_at < date_trunc('minute', now()) - interval '1 day';
  SELECT count(*) INTO n FROM public.imagery_s1_study(60, 30) s WHERE s.aoi_id = 'anchorage:img3_guard_test';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 5b: VOID AIS samples were paired (% rows)', n; END IF;
  RAISE NOTICE 'PASS 5: anti-correlated → rho -1, not admitted · VOID AIS pairs with nothing';

  -- ── 6. Pairing respects the ±30 min gap ────────────────────────────────
  UPDATE public.ais_aoi_counts SET vessels_fresh = 5, vessels_stationary = 1, sampled_at = sampled_at - interval '45 minutes'
   WHERE aoi_id = 'anchorage:img3_guard_test' AND sampled_at < date_trunc('minute', now()) - interval '1 day';
  SELECT count(*) INTO n FROM public.imagery_s1_study(60, 30) s WHERE s.aoi_id = 'anchorage:img3_guard_test';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 6: AIS samples 55 min from the pass were paired'; END IF;
  RAISE NOTICE 'PASS 6: samples outside ±30 min are not paired';
END
$$;

ROLLBACK;

SELECT 'IMG-3 guards: PASS 1-6 (access + hourly job, AIS VOID never zero, S1 write path, study admits rho=1, refuses rho=-1 and VOID, ±30 min pairing)' AS result,
       (SELECT count(*) FROM public.imagery_aois WHERE kind = 'anchorage' AND retired_at IS NULL) AS anchorage_aois,
       (SELECT count(*) FROM public.ais_aoi_counts)                                                 AS ais_count_rows,
       (SELECT max(updated_at) FROM public.vessel_positions)                                        AS ais_feed_newest_fix;
