-- IMG-10 · s1:anchorage_count claim family — acceptance checks for
-- migration 193.
--
-- READ ONLY and LIGHT. BEGIN … ROLLBACK. Six throw-away anchorages with 45
-- weeks of weekly Sentinel-1 looks, a throw-away admission, claims and
-- outcomes — all rolled back. Build-prompt lines under test: "walk-forward
-- skill printed with base rate; family reads 'Calibrating' until 90 judged;
-- a machine source without a resolver resolves VOID, never 0.5". A clean
-- run ends with ONE RESULT ROW ("IMG-10 guards: PASS 1-7 …"); 'Success.
-- No rows returned' means it did NOT run whole.

BEGIN;

DO $$
DECLARE
  r       record;
  n       integer;
  i       integer;
  w       integer;
  v_aoi   text;
  v_aois  text[] := '{}';
  v_mon   date := date_trunc('week', now())::date;           -- this Monday
  v_past  date := (date_trunc('week', now()) - interval '2 weeks')::date;
  v_ctx   jsonb;
  v_pid   uuid;
  levels  double precision[] := ARRAY[900, 1000, 1100];
BEGIN
  -- ── 1. Objects, access, source, scorer order ───────────────────────────
  SELECT count(*) INTO n FROM pg_proc WHERE proname IN
    ('s1_anchorage_resolution','s1_anchorage_backtest','s1_anchorage_walkforward','s1_anchorage_claim_plan');
  IF n <> 4 THEN RAISE EXCEPTION 'FAIL 1a: % of 4 IMG-10 functions — 193 not applied', n; END IF;
  IF has_function_privilege('anon', 'public.s1_anchorage_claim_plan(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.s1_anchorage_resolution(jsonb,timestamp with time zone)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL 1b: anon/authenticated can reach an IMG-10 function';
  END IF;
  IF (SELECT pg_get_constraintdef(oid) NOT LIKE '%s1-anchorage%' FROM pg_constraint WHERE conname = 'predictions_register_source_check')
     OR (SELECT pg_get_constraintdef(oid) NOT LIKE '%refinery-rc%' FROM pg_constraint WHERE conname = 'predictions_register_source_check') THEN
    RAISE EXCEPTION 'FAIL 1c: source list lost a value or lacks s1-anchorage';
  END IF;
  IF (SELECT pg_get_functiondef('public.due_unscored_predictions'::regproc) NOT LIKE '%''refinery-rc'', ''s1-anchorage''%') THEN
    RAISE EXCEPTION 'FAIL 1d: the scorer does not work s1-anchorage last with the other data-clock sources';
  END IF;
  RAISE NOTICE 'PASS 1: 4 functions · service_role only · source added (others kept) · scorer order';

  -- fixture: 6 anchorages, 45 weekly clear looks each cycling 900/1000/1100 m²
  FOR i IN 1..6 LOOP
    v_aoi := 'anchorage:img10_guard_' || i;
    v_aois := v_aois || v_aoi;
    INSERT INTO public.imagery_aois (aoi_id, kind, name, geom, centroid_lat, centroid_lon, area_km2, buffer_rule)
    VALUES (v_aoi, 'anchorage', 'IMG-10 guard ' || i, ST_MakeEnvelope(-20 - i, -58, -19.9 - i, -57.9, 4326), -57.95, -19.95 - i, 70, 'guard fixture');
    FOR w IN 1..45 LOOP
      INSERT INTO public.imagery_observations (aoi_id, sensor, provider_id, acquired_at, coverage_state, aoi_covered_fraction,
                                               metric_name, metric_stat, metric_value)
      VALUES (v_aoi, 's1_grd', 'copernicus_cdse', (v_mon - 7 * w + 2)::timestamptz + interval '6 hours', 'clear', 1,
              'bright_target_area_m2', 'area_m2', levels[((w + i) % 3) + 1]);
    END LOOP;
    INSERT INTO public.imagery_aoi_checks (aoi_id, sensor, window_from, window_to)
    VALUES (v_aoi, 's1_grd', now() - interval '30 days', now() - interval '1 hour');
  END LOOP;

  -- ── 2. Not admitted → nothing measured, nothing issued, claims VOID ────
  INSERT INTO public.imagery_s1_admissions (recorded_by, window_days, study, evaluated_n, admitted_n, method_admitted, rule)
  VALUES ('img10 guard', 60, '[]', 0, 0, false, 'guard fixture');
  SELECT * INTO r FROM public.s1_anchorage_backtest(26);
  IF r.measurable OR r.judged <> 0 THEN RAISE EXCEPTION 'FAIL 2a: a backtest was measured with no admitted method'; END IF;
  SELECT * INTO r FROM public.s1_anchorage_claim_plan(30) LIMIT 1;
  IF r.issuing OR r.reason NOT LIKE 'not issuing: the Sentinel-1 method is not admitted%' THEN
    RAISE EXCEPTION 'FAIL 2b: the plan would issue with no admitted method (%)', r.reason;
  END IF;
  v_ctx := jsonb_build_object('aoi_id', v_aois[1], 'week_start', v_past, 'week_end', v_past + 6, 'baseline_median', 1000);
  IF public.s1_anchorage_resolution(v_ctx)->>'state' <> 'void' THEN
    RAISE EXCEPTION 'FAIL 2c: a claim resolved while the method is not admitted';
  END IF;
  RAISE NOTICE 'PASS 2: not admitted → not measurable, not issuing, claims VOID';

  -- admit the fixture (rolled back)
  INSERT INTO public.imagery_s1_admissions (recorded_by, window_days, study, evaluated_n, admitted_n, admitted_aois, method_admitted, m2_per_vessel, rule)
  VALUES ('img10 guard', 60, '[]', 6, 6, v_aois, true, 1000, 'guard fixture');

  -- ── 3. Walk-forward backtest measured and printed before issuance ──────
  SELECT * INTO r FROM public.s1_anchorage_backtest(26);
  IF NOT r.measurable OR r.judged < 30 OR r.base_rate IS NULL OR r.brier IS NULL OR r.n_half_1 = 0 OR r.n_half_2 = 0 THEN
    RAISE EXCEPTION 'FAIL 3a: backtest not measured/printed (measurable %, judged %, base %, brier %)', r.measurable, r.judged, r.base_rate, r.brier;
  END IF;
  IF r.first_forecast IS DISTINCT FROM 0.5 THEN
    RAISE EXCEPTION 'FAIL 3c: the earliest backtest week was forecast at % — a walk-forward forecast has only the 0.5 prior there', r.first_forecast;
  END IF;
  IF r.base_rate <= 0 OR r.base_rate >= 1 OR r.skill IS NULL THEN
    RAISE EXCEPTION 'FAIL 3b: base rate % / skill % not printed', r.base_rate, r.skill;
  END IF;
  RAISE NOTICE 'PASS 3: backtest judged % weeks · base rate % · Brier % · skill %', r.judged, round(r.base_rate::numeric, 3), round(r.brier::numeric, 3), round(r.skill::numeric, 3);

  -- ── 4. Issuance plan: next week, one claim per anchorage, p at the prior
  SELECT count(*) INTO n FROM public.s1_anchorage_claim_plan(30) x
   WHERE x.issuing AND x.aoi_id = ANY (v_aois) AND x.week_start = v_mon + 7 AND x.week_end = v_mon + 13
     AND x.p = 0.5 AND x.baseline_n >= 3 AND x.family_status = 'Calibrating: 0 of 90 judged claims';
  IF n <> 6 THEN RAISE EXCEPTION 'FAIL 4a: % of 6 plan rows for next week at p = 0.5, Calibrating 0 of 90', n; END IF;
  IF EXISTS (SELECT 1 FROM public.s1_anchorage_claim_plan(1000) x WHERE x.issuing) THEN
    RAISE EXCEPTION 'FAIL 4b: the plan issued with fewer backtest weeks than required';
  END IF;
  RAISE NOTICE 'PASS 4: 6 claims planned for the next ISO week at p = 0.5 · refused below the backtest floor';

  -- ── 5. Resolution: ready / VOID / defer ────────────────────────────────
  -- a past week with a clear look: its median vs the frozen baseline
  SELECT public.s1_anchorage_resolution(jsonb_build_object('aoi_id', v_aois[1], 'week_start', v_past, 'week_end', v_past + 6, 'baseline_median', 950)) INTO v_ctx;
  IF v_ctx->>'state' <> 'ready' OR (v_ctx->>'observed')::int NOT IN (0, 1) THEN RAISE EXCEPTION 'FAIL 5a: past week not judged: %', v_ctx; END IF;
  -- the same week with every look made VOID → VOID, not 0
  UPDATE public.imagery_observations SET coverage_state = 'no_acquisition', metric_value = NULL, metric_name = NULL, metric_stat = NULL, aoi_covered_fraction = NULL
   WHERE aoi_id = v_aois[1] AND sensor = 's1_grd' AND acquired_at >= v_past::timestamptz AND acquired_at < (v_past + 7)::timestamptz;
  SELECT public.s1_anchorage_resolution(jsonb_build_object('aoi_id', v_aois[1], 'week_start', v_past, 'week_end', v_past + 6, 'baseline_median', 950)) INTO v_ctx;
  IF v_ctx->>'state' <> 'void' OR v_ctx->>'void_reason' NOT LIKE 'no clear Sentinel-1 pass%' THEN
    RAISE EXCEPTION 'FAIL 5b: a week with no clear pass was not VOID: %', v_ctx;
  END IF;
  -- this week: the check has not looked past it → defer
  IF public.s1_anchorage_resolution(jsonb_build_object('aoi_id', v_aois[2], 'week_start', v_mon, 'week_end', v_mon + 6, 'baseline_median', 1000))->>'state' <> 'defer' THEN
    RAISE EXCEPTION 'FAIL 5c: a week not yet looked past was judged instead of deferred';
  END IF;
  -- the same, 46 days after the week → VOID
  IF public.s1_anchorage_resolution(jsonb_build_object('aoi_id', v_aois[2], 'week_start', v_mon, 'week_end', v_mon + 6, 'baseline_median', 1000),
                                     (v_mon + 53)::timestamptz)->>'state' <> 'void' THEN
    RAISE EXCEPTION 'FAIL 5d: a week unobserved 45 days on was not VOID';
  END IF;
  IF public.s1_anchorage_resolution('{"aoi_id":"x","week_start":"not a date"}'::jsonb)->>'state' <> 'void' THEN
    RAISE EXCEPTION 'FAIL 5e: malformed context not VOID';
  END IF;
  RAISE NOTICE 'PASS 5: ready on a seen week · VOID with no clear pass · defer before the clock · VOID at 45 days · VOID on malformed';

  -- ── 6. Calibrating until 90 judged; the plan skips a claimed week ──────
  INSERT INTO public.predictions_register (feature, context, predicted_distribution, target_observable, target_window_hours,
                                           resolves_at, statement, source, hash, track)
  VALUES ('s1_anchorage_above_median', jsonb_build_object('aoi_id', v_aois[3]), '{"mean":0.5,"type":"point"}',
          's1:anchorage_count:' || v_aois[3] || ':' || (v_mon + 7), 168, now() + interval '14 days',
          'img10 guard claim', 's1-anchorage', repeat('0', 64), 'machine')
  RETURNING id INTO v_pid;
  SELECT count(*) INTO n FROM public.s1_anchorage_claim_plan(30) x WHERE x.aoi_id = v_aois[3];
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 6a: the plan re-offered an anchorage-week already claimed'; END IF;
  INSERT INTO public.prediction_outcomes (prediction_id, observed_value, observed_at, brier) VALUES (v_pid, 1, now(), 0.25);
  SELECT * INTO r FROM public.s1_anchorage_walkforward(90, 20);
  IF r.status <> 'Calibrating: 1 of 90 judged claims' OR r.p_next <> 11.0 / 21 THEN
    RAISE EXCEPTION 'FAIL 6b: monitor reads % at p_next % — want Calibrating: 1 of 90, p = 11/21', r.status, r.p_next;
  END IF;
  RAISE NOTICE 'PASS 6: claimed week not re-offered · Calibrating 1 of 90 · p_next = (1+10)/(1+20)';

  -- ── 7. A revoked admission VOIDs open claims ───────────────────────────
  INSERT INTO public.imagery_s1_admissions (recorded_by, window_days, study, evaluated_n, admitted_n, method_admitted, rule)
  VALUES ('img10 guard', 60, '[]', 6, 0, false, 'guard fixture: revoked');
  SELECT public.s1_anchorage_resolution(jsonb_build_object('aoi_id', v_aois[4], 'week_start', v_past - 7, 'week_end', v_past - 1, 'baseline_median', 1000)) INTO v_ctx;
  IF v_ctx->>'state' <> 'void' OR v_ctx->>'void_reason' NOT LIKE '%not admitted at resolution%' THEN
    RAISE EXCEPTION 'FAIL 7: a revoked admission did not VOID the claim: %', v_ctx;
  END IF;
  RAISE NOTICE 'PASS 7: revoked admission → VOID';
END
$$;

ROLLBACK;

SELECT 'IMG-10 guards: PASS 1-7 (service_role only + source + scorer order, not admitted = nothing measured/issued/judged, backtest printed with base rate, next-week plan at p = 0.5, ready/VOID/defer rules, Calibrating until 90, revoked = VOID)' AS result,
       (SELECT reason FROM public.s1_anchorage_claim_plan(30) LIMIT 1) AS issuing_now;
