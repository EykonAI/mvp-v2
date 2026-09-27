-- IMG-5b · the webcams globe read without a geography envelope — acceptance
-- checks for migration 188.
--
-- READ ONLY and LIGHT. BEGIN … ROLLBACK with a throw-away test provider:
-- no real camera is touched. A clean run ends with ONE RESULT ROW
-- ("IMG-5b guards: PASS 1-5 …"); 'Success. No rows returned' means it did
-- NOT run whole.

BEGIN;

DO $$
DECLARE
  n      integer;
  v_src  text;
  v_ids  text[];
  t0     timestamptz := date_trunc('minute', now()) - interval '1 hour';
  k      text;
BEGIN
  -- ── 1. The 188 function is in place, service_role only ─────────────────
  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.oid = 'public.webcams_in_bbox(double precision,double precision,double precision,double precision,integer)'::regprocedure;
  IF v_src ILIKE '%geography%' OR v_src ILIKE '%ST_MakeEnvelope%' THEN
    RAISE EXCEPTION 'FAIL 1a: webcams_in_bbox still builds a geography envelope — 188 not applied';
  END IF;
  IF has_function_privilege('anon', 'public.webcams_in_bbox(double precision,double precision,double precision,double precision,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.webcams_in_bbox(double precision,double precision,double precision,double precision,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL 1b: anon/authenticated can execute webcams_in_bbox';
  END IF;
  RAISE NOTICE 'PASS 1: plain lat/lon filter · service_role only';

  -- throw-away provider and three cameras in the empty Southern Ocean (rolled back)
  INSERT INTO public.imagery_licences (provider_id, provider_name, feed_kind, commercial_status, attribution_text)
  VALUES ('img5b_guard_test', 'IMG-5b guard test', 'webcam', 'ok', 'Guard test credit');
  PERFORM public.webcams_upsert('img5b_guard_test', jsonb_build_array(
    jsonb_build_object('provider_cam_id','E','name','East of the line','latitude',-62,'longitude', 175,'upstream_url','https://example.org/e.jpg'),
    jsonb_build_object('provider_cam_id','W','name','West of the line','latitude',-62,'longitude',-175,'upstream_url','https://example.org/w.jpg'),
    jsonb_build_object('provider_cam_id','M','name','Mid ocean',       'latitude',-62,'longitude',  10,'upstream_url','https://example.org/m.jpg'),
    jsonb_build_object('provider_cam_id','D','name','Never checked',   'latitude',-62,'longitude',  11,'upstream_url','https://example.org/d.jpg')));
  FOREACH k IN ARRAY ARRAY['E','W','M'] LOOP
    PERFORM public.webcam_record_liveness(jsonb_build_array(jsonb_build_object(
      'webcam_id', 'wc_' || left(encode(sha256(convert_to('img5b_guard_test:' || k, 'UTF8')), 'hex'), 16),
      'checked_at', t0, 'outcome', 'ok', 'http_status', 200, 'bytes_len', 1000, 'bytes_sha256', encode(sha256(convert_to(k, 'UTF8')), 'hex'))));
  END LOOP;

  -- ── 2. The whole world answers (the production 502) ────────────────────
  SELECT count(*) INTO n FROM public.webcams_in_bbox(-180, -90, 180, 90, 5000) b WHERE b.provider_id = 'img5b_guard_test';
  IF n <> 3 THEN RAISE EXCEPTION 'FAIL 2: whole-world read returned % test cameras — want 3 (E, W, M live; D never checked)', n; END IF;
  RAISE NOTICE 'PASS 2: whole-world bbox answers, live cameras only';

  -- ── 3. A wide viewport (> 180° of longitude) answers ───────────────────
  SELECT count(*) INTO n FROM public.webcams_in_bbox(-179, -70, 60, -50, 5000) b WHERE b.provider_id = 'img5b_guard_test';
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL 3: 239°-wide viewport returned % test cameras — want 2 (W, M)', n; END IF;
  RAISE NOTICE 'PASS 3: a viewport wider than half the globe answers';

  -- ── 4. An ordinary viewport keeps its edges ────────────────────────────
  SELECT array_agg(b.name ORDER BY b.name) INTO v_ids FROM public.webcams_in_bbox(5, -65, 15, -60, 100) b WHERE b.provider_id = 'img5b_guard_test';
  IF v_ids IS DISTINCT FROM ARRAY['Mid ocean'] THEN
    RAISE EXCEPTION 'FAIL 4: ordinary viewport returned % — want {Mid ocean}', v_ids;
  END IF;
  RAISE NOTICE 'PASS 4: ordinary viewport returns what is inside it, live only';

  -- ── 5. A viewport across the antimeridian (lon_min > lon_max) ──────────
  SELECT array_agg(b.name ORDER BY b.name) INTO v_ids FROM public.webcams_in_bbox(170, -65, -170, -60, 100) b WHERE b.provider_id = 'img5b_guard_test';
  IF v_ids IS DISTINCT FROM ARRAY['East of the line', 'West of the line'] THEN
    RAISE EXCEPTION 'FAIL 5: 170 → -170 returned % — want both sides of the antimeridian and nothing else', v_ids;
  END IF;
  RAISE NOTICE 'PASS 5: antimeridian viewport returns both sides';
END
$$;

ROLLBACK;

SELECT 'IMG-5b guards: PASS 1-5 (188 in place + service_role only, whole world answers, >180° viewport answers, ordinary viewport, antimeridian viewport)' AS result,
       (SELECT count(*) FROM public.webcams_in_bbox(-180, -90, 180, 90, 5000)) AS live_cameras_world;
