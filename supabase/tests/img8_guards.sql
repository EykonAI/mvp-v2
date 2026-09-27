-- IMG-8 · Imagery into NOTIF, BRIEFS and posture — acceptance checks for
-- migration 191.
--
-- READ ONLY and LIGHT. BEGIN … ROLLBACK with two throw-away mine sites, a
-- throw-away rule (owned by an existing account, rolled back) and their
-- looks. The build-prompt line under test: "a rule on a cloudy week fires
-- nothing and logs VOID; the brief omits VOID AOIs". A clean run ends with
-- ONE RESULT ROW ("IMG-8 guards: PASS 1-7 …"); 'Success. No rows returned'
-- means it did NOT run whole.

BEGIN;

DO $$
DECLARE
  n        integer;
  r        record;
  v_user   uuid;
  v_rule   uuid;
  v_rule2  uuid;
  v_a      text := 'mine:img8_guard_a';
  v_b      text := 'mine:img8_guard_b';
  v_now    timestamptz := date_trunc('hour', now());
  v_s1     text;
BEGIN
  -- ── 1. Objects and access ──────────────────────────────────────────────
  IF (SELECT pg_get_constraintdef(oid) NOT LIKE '%imagery_change%' FROM pg_constraint
       WHERE conname = 'user_notification_rules_rule_type_check') THEN
    RAISE EXCEPTION 'FAIL 1a: rule type imagery_change not allowed — 191 not applied';
  END IF;
  IF (SELECT pg_get_indexdef('public.idx_user_notification_rules_cheap_active'::regclass) NOT LIKE '%imagery_change%') THEN
    RAISE EXCEPTION 'FAIL 1b: the cheap-rules index does not cover imagery_change';
  END IF;
  IF has_function_privilege('anon', 'public.imagery_weekly_movements(integer,double precision)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.imagery_rule_evaluate(uuid,text,text,text,text,double precision,timestamp with time zone)', 'EXECUTE')
     OR has_table_privilege('anon', 'public.imagery_rule_evaluations', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL 1c: anon/authenticated can reach an IMG-8 object';
  END IF;
  RAISE NOTICE 'PASS 1: rule type + index + service_role only';

  -- fixture sites and looks (rolled back)
  INSERT INTO public.imagery_aois (aoi_id, kind, name, geom, centroid_lat, centroid_lon, area_km2, buffer_rule)
  VALUES (v_a, 'mine', 'IMG-8 guard A', ST_MakeEnvelope(-40.1, -55.1, -40.0, -55.0, 4326), -55.05, -40.05, 70, 'guard fixture'),
         (v_b, 'mine', 'IMG-8 guard B', ST_MakeEnvelope(-41.1, -55.1, -41.0, -55.0, 4326), -55.05, -41.05, 70, 'guard fixture');
  -- A: three ordinary looks (no baseline yet), +30 %, a cloudy week, then an ordinary +5 %
  PERFORM public.imagery_upsert_obs('s2_l2a', jsonb_build_array(
    jsonb_build_object('aoi_id', v_a, 'acquired_at', v_now - interval '40 days', 'coverage_state', 'clear', 'cloud_fraction_aoi', 0, 'aoi_covered_fraction', 1, 'metric_name', 'ndvi_median', 'metric_stat', 'median', 'metric_value', 0.10)));
  PERFORM public.imagery_upsert_obs('s2_l2a', jsonb_build_array(
    jsonb_build_object('aoi_id', v_a, 'acquired_at', v_now - interval '35 days', 'coverage_state', 'clear', 'cloud_fraction_aoi', 0, 'aoi_covered_fraction', 1, 'metric_name', 'ndvi_median', 'metric_stat', 'median', 'metric_value', 0.10)));
  PERFORM public.imagery_upsert_obs('s2_l2a', jsonb_build_array(
    jsonb_build_object('aoi_id', v_a, 'acquired_at', v_now - interval '30 days', 'coverage_state', 'clear', 'cloud_fraction_aoi', 0, 'aoi_covered_fraction', 1, 'metric_name', 'ndvi_median', 'metric_stat', 'median', 'metric_value', 0.10)));
  PERFORM public.imagery_upsert_obs('s2_l2a', jsonb_build_array(
    jsonb_build_object('aoi_id', v_a, 'acquired_at', v_now - interval '25 days', 'coverage_state', 'clear', 'cloud_fraction_aoi', 0, 'aoi_covered_fraction', 1, 'metric_name', 'ndvi_median', 'metric_stat', 'median', 'metric_value', 0.13)));
  PERFORM public.imagery_upsert_obs('s2_l2a', jsonb_build_array(
    jsonb_build_object('aoi_id', v_a, 'acquired_at', v_now - interval '6 days', 'coverage_state', 'cloudy', 'cloud_fraction_aoi', 0.9, 'aoi_covered_fraction', 1),
    jsonb_build_object('aoi_id', v_a, 'acquired_at', v_now - interval '4 days', 'coverage_state', 'partly_cloudy', 'cloud_fraction_aoi', 0.5, 'aoi_covered_fraction', 1),
    jsonb_build_object('aoi_id', v_a, 'acquired_at', v_now - interval '3 days', 'coverage_state', 'no_acquisition')));
  -- B: baseline, a +40 % look this week, then a cloudy look after it
  PERFORM public.imagery_upsert_obs('s2_l2a', jsonb_build_array(
    jsonb_build_object('aoi_id', v_b, 'acquired_at', v_now - interval '30 days', 'coverage_state', 'clear', 'cloud_fraction_aoi', 0, 'aoi_covered_fraction', 1, 'metric_name', 'ndvi_median', 'metric_stat', 'median', 'metric_value', 0.20)));
  PERFORM public.imagery_upsert_obs('s2_l2a', jsonb_build_array(
    jsonb_build_object('aoi_id', v_b, 'acquired_at', v_now - interval '25 days', 'coverage_state', 'clear', 'cloud_fraction_aoi', 0, 'aoi_covered_fraction', 1, 'metric_name', 'ndvi_median', 'metric_stat', 'median', 'metric_value', 0.20)));
  PERFORM public.imagery_upsert_obs('s2_l2a', jsonb_build_array(
    jsonb_build_object('aoi_id', v_b, 'acquired_at', v_now - interval '20 days', 'coverage_state', 'clear', 'cloud_fraction_aoi', 0, 'aoi_covered_fraction', 1, 'metric_name', 'ndvi_median', 'metric_stat', 'median', 'metric_value', 0.20)));
  PERFORM public.imagery_upsert_obs('s2_l2a', jsonb_build_array(
    jsonb_build_object('aoi_id', v_b, 'acquired_at', v_now - interval '5 days', 'coverage_state', 'clear', 'cloud_fraction_aoi', 0, 'aoi_covered_fraction', 1, 'metric_name', 'ndvi_median', 'metric_stat', 'median', 'metric_value', 0.28)));
  PERFORM public.imagery_upsert_obs('s2_l2a', jsonb_build_array(
    jsonb_build_object('aoi_id', v_b, 'acquired_at', v_now - interval '2 days', 'coverage_state', 'cloudy', 'cloud_fraction_aoi', 0.95, 'aoi_covered_fraction', 1)));

  SELECT id INTO v_user FROM auth.users LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'FAIL 0: no account to own the throw-away rule'; END IF;
  INSERT INTO public.user_notification_rules (user_id, name, rule_type, config, channel_ids)
  VALUES (v_user, 'img8 guard — cloudy week', 'imagery_change', '{"sensor":"s2_l2a","aoi_id":"mine:img8_guard_a","direction":"either","min_change_pct":20}', '{}')
  RETURNING id INTO v_rule;
  INSERT INTO public.user_notification_rules (user_id, name, rule_type, config, channel_ids)
  VALUES (v_user, 'img8 guard — full window', 'imagery_change', '{"sensor":"s2_l2a","aoi_id":"mine:img8_guard_a","direction":"either","min_change_pct":20}', '{}')
  RETURNING id INTO v_rule2;

  -- ── 2. A rule on a cloudy week fires nothing and logs VOID ─────────────
  PERFORM public.imagery_rule_evaluate(v_rule, 's2_l2a', v_a, NULL, 'either', 20, v_now - interval '7 days');
  SELECT count(*) INTO n FROM public.imagery_rule_evaluations e WHERE e.rule_id = v_rule AND e.outcome = 'fired';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 2a: a cloudy week fired % time(s)', n; END IF;
  SELECT count(*) INTO n FROM public.imagery_rule_evaluations e
   WHERE e.rule_id = v_rule AND e.outcome = 'void' AND e.value IS NULL AND e.change_pct IS NULL;
  IF n <> 3 THEN RAISE EXCEPTION 'FAIL 2b: % VOID rows logged for the cloudy week — want 3 (cloudy, partly cloudy, no acquisition)', n; END IF;
  RAISE NOTICE 'PASS 2: cloudy week → 0 fired, 3 VOID rows logged with no value';

  -- ── 3. Over the full window: one fire, and every look judged once ──────
  PERFORM public.imagery_rule_evaluate(v_rule2, 's2_l2a', v_a, NULL, 'either', 20, v_now - interval '60 days');
  SELECT count(*) INTO n FROM public.imagery_rule_evaluations WHERE rule_id = v_rule2;
  IF n <> 7 OR (SELECT count(*) FROM public.imagery_rule_evaluations WHERE rule_id = v_rule2 AND outcome = 'fired' AND change_pct = 30) <> 1
     OR (SELECT count(*) FROM public.imagery_rule_evaluations WHERE rule_id = v_rule2 AND outcome = 'no_baseline') <> 3 THEN
    RAISE EXCEPTION 'FAIL 3a: full window judged % looks — want 7: 3 no_baseline, 1 fired at +30 %%, 3 void', n;
  END IF;
  SELECT count(*) INTO n FROM public.imagery_rule_evaluate(v_rule2, 's2_l2a', v_a, NULL, 'either', 20, v_now - interval '60 days');
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 3b: a second evaluation re-judged % look(s)', n; END IF;
  RAISE NOTICE 'PASS 3: 3 no_baseline · 1 fired (+30 %%) · 3 void · judged once';

  -- ── 4. Direction and threshold ─────────────────────────────────────────
  SELECT count(*) INTO n FROM public.imagery_rule_evaluate(v_rule2, 's2_l2a', v_b, NULL, 'down', 20, v_now - interval '60 days') x WHERE x.outcome = 'fired';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 4a: a "down" rule fired on a +40 %% look'; END IF;
  BEGIN
    PERFORM public.imagery_rule_evaluate(v_rule2, 's2_l2a', v_a, NULL, 'either', 5, v_now);
    RAISE EXCEPTION 'FAIL 4b: a 5 %% threshold was accepted' USING ERRCODE = 'P0002';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  RAISE NOTICE 'PASS 4: direction respected · threshold floor 10 %%';

  -- ── 5. Sentinel-1 rules see nothing until admitted ─────────────────────
  SELECT state INTO v_s1 FROM public.imagery_s1_status();
  IF v_s1 <> 'admitted' THEN
    SELECT count(*) INTO n FROM public.imagery_rule_evaluate(v_rule2, 's1_grd', NULL, 'chokepoint', 'either', 20, v_now - interval '60 days');
    IF n <> 0 THEN RAISE EXCEPTION 'FAIL 5: an S1 rule judged % look(s) with no admission', n; END IF;
  END IF;
  RAISE NOTICE 'PASS 5: S1 rule silent while S1 is %', v_s1;

  -- ── 6. The weekly brief omits VOID looks ──────────────────────────────
  IF EXISTS (SELECT 1 FROM public.imagery_weekly_movements(7, 20) w WHERE w.aoi_id = v_a) THEN
    RAISE EXCEPTION 'FAIL 6a: site A (only VOID looks this week) is in the brief';
  END IF;
  SELECT * INTO r FROM public.imagery_weekly_movements(7, 20) w WHERE w.aoi_id = v_b;
  IF r.acquired_at IS DISTINCT FROM v_now - interval '5 days' OR r.change_pct IS DISTINCT FROM 40::double precision THEN
    RAISE EXCEPTION 'FAIL 6b: site B should appear once, dated its clear look (+40 %%), not its later cloudy one';
  END IF;
  RAISE NOTICE 'PASS 6: brief lists B at its clear +40 %% look, omits A (VOID week)';

  -- ── 7. Posture term: NULL without admitted sites ───────────────────────
  IF v_s1 <> 'admitted' AND (SELECT share FROM public.imagery_theatre_term(11, 14, 42, 45, 14)) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 7a: a theatre imagery term exists with no admitted S1 site';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'posture_scores' AND column_name = 'composite_formula') THEN
    RAISE EXCEPTION 'FAIL 7b: posture_scores.composite_formula missing';
  END IF;
  RAISE NOTICE 'PASS 7: posture imagery term NULL until admitted · formula column present';
END
$$;

ROLLBACK;

SELECT 'IMG-8 guards: PASS 1-7 (rule type + service_role only, cloudy week = 0 fired + VOID logged, judged once, direction/threshold, S1 silent until admitted, brief omits VOID, posture term NULL until admitted)' AS result,
       (SELECT count(*) FROM public.imagery_weekly_movements(7, 20)) AS weekly_items_now;
