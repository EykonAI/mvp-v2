-- IMG-9 · Webcams wave 2 — acceptance checks for migration 192.
--
-- Build-prompt line under test: "the licence row for each provider is OK
-- before its cams render". READ ONLY and LIGHT: BEGIN … ROLLBACK; a
-- throw-away 511NY camera is registered, cleared, downgraded — all rolled
-- back, including any status change. A clean run ends with ONE RESULT ROW
-- ("IMG-9 guards: PASS 1-6 …"); 'Success. No rows returned' means it did
-- NOT run whole.

BEGIN;

DO $$
DECLARE
  r      record;
  n      integer;
  v_id   text := 'wc_' || left(encode(sha256(convert_to('ny_511:IMG9-GUARD', 'UTF8')), 'hex'), 16);
  v_st   text;
BEGIN
  -- ── 1. Rows and access ─────────────────────────────────────────────────
  SELECT count(*) INTO n FROM public.imagery_licences
   WHERE provider_id IN ('ny_511', 'ohio_ohgo') AND feed_kind = 'webcam' AND length(attribution_text) > 0;
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL 1a: % of 2 wave-2 licence rows (with credit) — 192 not applied', n; END IF;
  IF has_function_privilege('anon', 'public.imagery_licence_set_status(text,text,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.imagery_licence_set_status(text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL 1b: anon/authenticated can change a licence status';
  END IF;
  RAISE NOTICE 'PASS 1: ny_511 + ohio_ohgo rows with credit · status change is service_role only';

  -- Start from 'unclear' whatever production says today (rolled back).
  SELECT commercial_status INTO v_st FROM public.imagery_licences WHERE provider_id = 'ny_511';
  IF v_st <> 'unclear' THEN
    PERFORM public.imagery_licence_set_status('ny_511', 'unclear', 'img9 guard', 'guard fixture: start from unclear');
  END IF;

  -- ── 2. Not cleared → a camera registers but can never be live ──────────
  PERFORM public.webcams_upsert('ny_511', jsonb_build_array(jsonb_build_object(
    'provider_cam_id', 'IMG9-GUARD', 'name', 'IMG-9 guard camera', 'latitude', 44.9, 'longitude', -74.9,
    'upstream_url', 'https://511ny.org/map/Cctv/999999')));
  PERFORM public.webcam_record_liveness(jsonb_build_array(jsonb_build_object(
    'webcam_id', v_id, 'checked_at', now() - interval '2 hours', 'outcome', 'ok', 'http_status', 200,
    'bytes_len', 1000, 'bytes_sha256', repeat('a', 64))));
  IF (SELECT is_live FROM public.webcams WHERE webcam_id = v_id) THEN
    RAISE EXCEPTION 'FAIL 2a: a camera went live under an uncleared (unclear) licence';
  END IF;
  IF EXISTS (SELECT 1 FROM public.webcams_in_bbox(-75, 44.8, -74.8, 45, 100) b WHERE b.webcam_id = v_id) THEN
    RAISE EXCEPTION 'FAIL 2b: an uncleared provider''s camera renders on the globe';
  END IF;
  IF EXISTS (SELECT 1 FROM public.webcam_liveness_due(2000) d WHERE d.webcam_id = v_id) THEN
    RAISE EXCEPTION 'FAIL 2c: liveness would fetch images from an uncleared provider';
  END IF;
  RAISE NOTICE 'PASS 2: unclear → registered, never live, never rendered, never fetched';

  -- ── 3. The clearance is recorded — who, when, why ──────────────────────
  BEGIN
    PERFORM public.imagery_licence_set_status('ny_511', 'ok', '', 'no name given');
    RAISE EXCEPTION 'FAIL 3a: a clearance with no name was accepted' USING ERRCODE = 'P0002';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  SELECT * INTO r FROM public.imagery_licence_set_status('ny_511', 'ok', 'img9 guard', 'guard fixture: DAA read, company redistribution allowed');
  IF r.commercial_status <> 'ok' OR r.cleared_by <> 'img9 guard' OR r.cleared_at IS NULL THEN
    RAISE EXCEPTION 'FAIL 3b: clearance not recorded (who / when)';
  END IF;
  IF (SELECT notes NOT LIKE '%unclear → ok by img9 guard%' FROM public.imagery_licences WHERE provider_id = 'ny_511') THEN
    RAISE EXCEPTION 'FAIL 3c: the reason was not appended to the licence notes';
  END IF;
  RAISE NOTICE 'PASS 3: clearance needs a name and a reason, and records both';

  -- ── 4. Cleared → a good fetch makes it live and it renders ─────────────
  PERFORM public.webcam_record_liveness(jsonb_build_array(jsonb_build_object(
    'webcam_id', v_id, 'checked_at', now() - interval '1 hour', 'outcome', 'ok', 'http_status', 200,
    'bytes_len', 1100, 'bytes_sha256', repeat('b', 64))));
  IF NOT EXISTS (SELECT 1 FROM public.webcams_in_bbox(-75, 44.8, -74.8, 45, 100) b WHERE b.webcam_id = v_id
                   AND b.attribution_text LIKE '%511NY%') THEN
    RAISE EXCEPTION 'FAIL 4: a cleared provider''s camera does not render, or renders without its credit';
  END IF;
  RAISE NOTICE 'PASS 4: ok → live, rendered with the 511NY credit';

  -- ── 5. A downgrade takes it down at once ───────────────────────────────
  PERFORM public.imagery_licence_set_status('ny_511', 'confirm_in_writing', 'img9 guard', 'guard fixture: downgrade test');
  IF (SELECT is_live FROM public.webcams WHERE webcam_id = v_id)
     OR EXISTS (SELECT 1 FROM public.webcam_upstream(v_id)) THEN
    RAISE EXCEPTION 'FAIL 5: a downgraded provider''s camera stayed live or resolvable';
  END IF;
  RAISE NOTICE 'PASS 5: downgrade → not live, not resolvable';

  -- ── 6. Excluded is final ───────────────────────────────────────────────
  BEGIN
    PERFORM public.imagery_licence_set_status('unsecured_ip_cams', 'unclear', 'img9 guard', 'guard fixture: must be refused');
    RAISE EXCEPTION 'FAIL 6: an excluded provider was re-opened' USING ERRCODE = 'P0002';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  RAISE NOTICE 'PASS 6: excluded cannot be re-opened';
END
$$;

ROLLBACK;

SELECT 'IMG-9 guards: PASS 1-6 (wave-2 rows + service_role only, uncleared = never live/rendered/fetched, clearance records who/when/why, cleared = live with credit, downgrade = down, excluded is final)' AS result,
       (SELECT string_agg(provider_id || '=' || commercial_status, ', ' ORDER BY provider_id)
          FROM public.imagery_licences WHERE provider_id IN ('ny_511', 'ohio_ohgo')) AS wave2_status;
