-- IMG-5c · "frozen" means the same frame 30+ minutes apart — acceptance
-- checks for migration 190.
--
-- READ ONLY and LIGHT. BEGIN … ROLLBACK with a throw-away test provider:
-- no real camera is touched. A clean run ends with ONE RESULT ROW
-- ("IMG-5c guards: PASS 1-4 …"); 'Success. No rows returned' means it did
-- NOT run whole.

BEGIN;

DO $$
DECLARE
  r      record;
  v_id   text := 'wc_' || left(encode(sha256(convert_to('img5c_guard_test:A', 'UTF8')), 'hex'), 16);
  t0     timestamptz := date_trunc('minute', now()) - interval '5 hours';
  h_a    text := encode(sha256(convert_to('frame A', 'UTF8')), 'hex');
  h_b    text := encode(sha256(convert_to('frame B', 'UTF8')), 'hex');
BEGIN
  -- ── 1. The 190 rule is in place, service_role only ─────────────────────
  IF (SELECT prosrc NOT LIKE '%30 minutes%' FROM pg_proc WHERE oid = 'public.webcam_record_liveness(jsonb)'::regprocedure) THEN
    RAISE EXCEPTION 'FAIL 1a: webcam_record_liveness has no 30-minute interval — 190 not applied';
  END IF;
  IF has_function_privilege('anon', 'public.webcam_record_liveness(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.webcam_record_liveness(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL 1b: anon/authenticated can execute webcam_record_liveness';
  END IF;
  RAISE NOTICE 'PASS 1: 30-minute rule · service_role only';

  INSERT INTO public.imagery_licences (provider_id, provider_name, feed_kind, commercial_status, attribution_text)
  VALUES ('img5c_guard_test', 'IMG-5c guard test', 'webcam', 'ok', 'Guard test credit');
  PERFORM public.webcams_upsert('img5c_guard_test', jsonb_build_array(
    jsonb_build_object('provider_cam_id','A','name','Cam A','latitude',-61.5,'longitude',-45.5,'upstream_url','https://example.org/a.jpg')));
  PERFORM public.webcam_record_liveness(jsonb_build_array(jsonb_build_object(
    'webcam_id', v_id, 'checked_at', t0, 'outcome', 'ok', 'http_status', 200, 'bytes_len', 1000, 'bytes_sha256', h_a)));

  -- ── 2. The same frame 2 minutes later is NOT frozen (the 2026-09-27 case)
  SELECT * INTO r FROM public.webcam_record_liveness(jsonb_build_array(jsonb_build_object(
    'webcam_id', v_id, 'checked_at', t0 + interval '2 minutes', 'outcome', 'ok', 'http_status', 200, 'bytes_len', 1000, 'bytes_sha256', h_a)));
  IF r.frozen <> 0 OR NOT (SELECT is_live FROM public.webcams WHERE webcam_id = v_id) THEN
    RAISE EXCEPTION 'FAIL 2: the same frame 2 minutes apart hid the camera as frozen';
  END IF;
  RAISE NOTICE 'PASS 2: same frame 2 min apart → still live';

  -- ── 3. The same frame an hour later IS frozen, and hidden ──────────────
  SELECT * INTO r FROM public.webcam_record_liveness(jsonb_build_array(jsonb_build_object(
    'webcam_id', v_id, 'checked_at', t0 + interval '62 minutes', 'outcome', 'ok', 'http_status', 200, 'bytes_len', 1000, 'bytes_sha256', h_a)));
  IF r.frozen <> 1 OR (SELECT is_live FROM public.webcams WHERE webcam_id = v_id) THEN
    RAISE EXCEPTION 'FAIL 3: the same frame an hour apart was not treated as frozen';
  END IF;
  RAISE NOTICE 'PASS 3: same frame 1 h apart → frozen, hidden';

  -- ── 4. A new frame brings it back ─────────────────────────────────────
  SELECT * INTO r FROM public.webcam_record_liveness(jsonb_build_array(jsonb_build_object(
    'webcam_id', v_id, 'checked_at', t0 + interval '2 hours', 'outcome', 'ok', 'http_status', 200, 'bytes_len', 1100, 'bytes_sha256', h_b)));
  IF r.live <> 1 OR NOT (SELECT is_live FROM public.webcams WHERE webcam_id = v_id) THEN
    RAISE EXCEPTION 'FAIL 4: a new frame did not bring the camera back';
  END IF;
  RAISE NOTICE 'PASS 4: new frame → live again';
END
$$;

ROLLBACK;

SELECT 'IMG-5c guards: PASS 1-4 (30-minute rule + service_role only, same frame 2 min apart stays live, same frame 1 h apart is frozen, new frame restores)' AS result,
       (SELECT count(*) FROM public.webcams WHERE is_live) AS live_cameras;
