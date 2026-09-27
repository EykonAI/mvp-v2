-- IMG-5 · Webcams wave 1 — acceptance checks for migration 187.
--
-- READ ONLY and LIGHT. BEGIN … ROLLBACK with a throw-away test provider:
-- no real camera is touched. A clean run ends with ONE RESULT ROW
-- ("IMG-5 guards: PASS 1-7 …"); 'Success. No rows returned' means it did
-- NOT run whole.

BEGIN;

DO $$
DECLARE
  r      record;
  n      integer;
  v_id   text;
  v_res  text;
  t0     timestamptz := date_trunc('minute', now()) - interval '10 hours';
BEGIN
  -- ── 1. Objects and access ──────────────────────────────────────────────
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname IN
         ('webcams_upsert','webcam_record_liveness','webcam_liveness_due','webcams_in_bbox','webcam_upstream');
  IF n <> 5 THEN RAISE EXCEPTION 'FAIL 1a: % of 5 IMG-5 functions — 187 not applied', n; END IF;
  IF has_function_privilege('anon', 'public.webcam_upstream(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.webcams_upsert(text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL 1b: anon/authenticated can reach an IMG-5 function';
  END IF;
  RAISE NOTICE 'PASS 1: 5 functions · service_role only';

  -- throw-away provider (rolled back)
  INSERT INTO public.imagery_licences (provider_id, provider_name, feed_kind, commercial_status, attribution_text)
  VALUES ('img5_guard_test', 'IMG-5 guard test', 'webcam', 'ok', 'Guard test credit');

  -- ── 2. Upsert: opaque derived ids, not live, retire the missing ────────
  SELECT * INTO r FROM public.webcams_upsert('img5_guard_test', jsonb_build_array(
    jsonb_build_object('provider_cam_id','A','name','Cam A','latitude',-60.1,'longitude',-40.1,'upstream_url','https://example.org/a.jpg'),
    jsonb_build_object('provider_cam_id','B','name','Cam B','latitude',-60.2,'longitude',-40.2,'upstream_url','https://example.org/b.jpg'),
    jsonb_build_object('provider_cam_id','C','name','Cam C','latitude',-60.3,'longitude',-40.3,'upstream_url','https://example.org/c.jpg'),
    jsonb_build_object('provider_cam_id','Z','name','Null island','latitude',0,'longitude',0,'upstream_url','https://example.org/z.jpg')));
  IF r.inserted <> 3 OR r.active <> 3 THEN RAISE EXCEPTION 'FAIL 2a: inserted % active % — want 3 | 3 (0,0 dropped)', r.inserted, r.active; END IF;
  v_id := 'wc_' || left(encode(sha256(convert_to('img5_guard_test:A', 'UTF8')), 'hex'), 16);
  IF NOT EXISTS (SELECT 1 FROM public.webcams WHERE webcam_id = v_id AND NOT is_live) THEN
    RAISE EXCEPTION 'FAIL 2b: camera A missing, id not derived as sha256, or already live';
  END IF;
  SELECT * INTO r FROM public.webcams_upsert('img5_guard_test', jsonb_build_array(
    jsonb_build_object('provider_cam_id','A','name','Cam A','latitude',-60.1,'longitude',-40.1,'upstream_url','https://example.org/a.jpg'),
    jsonb_build_object('provider_cam_id','B','name','Cam B','latitude',-60.2,'longitude',-40.2,'upstream_url','https://example.org/b.jpg')));
  IF r.inserted <> 0 OR r.updated <> 2 OR r.retired <> 1 OR r.active <> 2 THEN
    RAISE EXCEPTION 'FAIL 2c: second upsert % / % / % / % — want 0 new, 2 updated, 1 retired, 2 active', r.inserted, r.updated, r.retired, r.active;
  END IF;
  BEGIN
    PERFORM public.webcams_upsert('img5_guard_test', '[]'::jsonb);
    RAISE EXCEPTION 'FAIL 2d: an empty list was accepted (it would retire every camera)' USING ERRCODE = 'P0002';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  RAISE NOTICE 'PASS 2: ids = wc_ + sha256 · new cameras not live · (0,0) dropped · missing retired · empty list refused';

  -- ── 3. Liveness: ok → live; same bytes → frozen, hidden; new bytes → live ─
  PERFORM public.webcam_record_liveness(jsonb_build_array(jsonb_build_object(
    'webcam_id', v_id, 'checked_at', t0, 'outcome', 'ok', 'http_status', 200, 'bytes_len', 1000, 'bytes_sha256', repeat('a', 64))));
  IF NOT (SELECT is_live FROM public.webcams WHERE webcam_id = v_id) THEN RAISE EXCEPTION 'FAIL 3a: a good fetch did not make the camera live'; END IF;
  SELECT * INTO r FROM public.webcam_record_liveness(jsonb_build_array(jsonb_build_object(
    'webcam_id', v_id, 'checked_at', t0 + interval '3 hours', 'outcome', 'ok', 'http_status', 200, 'bytes_len', 1000, 'bytes_sha256', repeat('a', 64))));
  IF r.frozen <> 1 OR (SELECT is_live FROM public.webcams WHERE webcam_id = v_id) THEN
    RAISE EXCEPTION 'FAIL 3b: identical bytes 3 h later were not treated as frozen';
  END IF;
  PERFORM public.webcam_record_liveness(jsonb_build_array(jsonb_build_object(
    'webcam_id', v_id, 'checked_at', t0 + interval '6 hours', 'outcome', 'ok', 'http_status', 200, 'bytes_len', 1200, 'bytes_sha256', repeat('b', 64))));
  IF NOT (SELECT is_live FROM public.webcams WHERE webcam_id = v_id) THEN RAISE EXCEPTION 'FAIL 3c: new bytes did not bring the camera back'; END IF;
  PERFORM public.webcam_record_liveness(jsonb_build_array(jsonb_build_object(
    'webcam_id', v_id, 'checked_at', t0 + interval '7 hours', 'outcome', 'timeout')));
  IF (SELECT is_live FROM public.webcams WHERE webcam_id = v_id) THEN RAISE EXCEPTION 'FAIL 3d: a timed-out camera stayed live'; END IF;
  PERFORM public.webcam_record_liveness(jsonb_build_array(jsonb_build_object(
    'webcam_id', v_id, 'checked_at', t0 + interval '8 hours', 'outcome', 'ok', 'http_status', 200, 'bytes_len', 900, 'bytes_sha256', repeat('c', 64))));
  RAISE NOTICE 'PASS 3: good fetch → live · same bytes → frozen, hidden · new bytes → live · timeout → hidden';

  -- ── 4. Globe read: live only, and no upstream URL in its result ────────
  SELECT pg_get_function_result('public.webcams_in_bbox(double precision,double precision,double precision,double precision,integer)'::regprocedure) INTO v_res;
  IF v_res ILIKE '%upstream%' THEN RAISE EXCEPTION 'FAIL 4a: webcams_in_bbox returns an upstream column: %', v_res; END IF;
  SELECT count(*) INTO n FROM public.webcams_in_bbox(-41, -61, -39, -59, 100) b WHERE b.provider_id = 'img5_guard_test';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 4b: bbox read returned % test cameras — want 1 (only A is live)', n; END IF;
  RAISE NOTICE 'PASS 4: globe read has no upstream column and returns live cameras only';

  -- ── 5. Proxy resolver: live → URL; not live → nothing ──────────────────
  IF (SELECT upstream_url FROM public.webcam_upstream(v_id)) IS DISTINCT FROM 'https://example.org/a.jpg' THEN
    RAISE EXCEPTION 'FAIL 5a: live camera A did not resolve';
  END IF;
  SELECT count(*) INTO n FROM public.webcam_upstream('wc_' || left(encode(sha256(convert_to('img5_guard_test:B', 'UTF8')), 'hex'), 16));
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 5b: a never-checked camera resolved to an upstream URL'; END IF;
  RAISE NOTICE 'PASS 5: resolver serves live cameras only';

  -- ── 6. Licence downgrade takes cameras down, resolver goes quiet ───────
  UPDATE public.imagery_licences SET commercial_status = 'unclear' WHERE provider_id = 'img5_guard_test';
  IF (SELECT is_live FROM public.webcams WHERE webcam_id = v_id) THEN RAISE EXCEPTION 'FAIL 6a: downgrade left camera A live'; END IF;
  SELECT count(*) INTO n FROM public.webcam_upstream(v_id);
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 6b: resolver still serves a camera whose licence is no longer ok'; END IF;
  RAISE NOTICE 'PASS 6: licence downgrade → not live, not resolvable';

  -- ── 7. Excluded providers cannot register cameras ──────────────────────
  BEGIN
    PERFORM public.webcams_upsert('unsecured_ip_cams', jsonb_build_array(
      jsonb_build_object('provider_cam_id','x','name','x','latitude',1,'longitude',1,'upstream_url','http://198.51.100.7/c.jpg')));
    RAISE EXCEPTION 'FAIL 7: an excluded provider registered a camera' USING ERRCODE = 'P0002';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  RAISE NOTICE 'PASS 7: excluded provider refused';
END
$$;

ROLLBACK;

SELECT 'IMG-5 guards: PASS 1-7 (access, derived opaque ids + retire, frozen = hidden, globe read without upstream, live-only resolver, licence downgrade, excluded refused)' AS result,
       (SELECT count(*) FROM public.webcams WHERE retired_at IS NULL) AS webcams,
       (SELECT count(*) FROM public.webcams WHERE is_live)            AS live_webcams;
