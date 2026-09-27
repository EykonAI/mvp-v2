-- ═══════════════════════════════════════════════════════════════════════
-- 190 · Webcams — "frozen" means the same frame 30+ minutes apart (IMG-5 fix)
--
-- WHY: the first production liveness runs (2026-09-27, four back-to-back
-- ?limit=2000 calls over 5,353 cameras) marked 131 cameras frozen in the
-- third run. The third run wrapped round to cameras checked a minute or two
-- earlier; many serve the same JPEG for several minutes, so identical bytes
-- one minute apart were read as a frozen feed and the cameras were hidden.
-- 187's own header says "identical bytes on consecutive checks HOURS
-- apart"; the code compared with the previous fetch at any distance.
--
-- WHAT: webcam_record_liveness compares a new good fetch only with the
-- newest good fetch at least 30 minutes older. Nothing else changes: the
-- fetcher's Last-Modified > 24 h rule still marks stale cameras frozen on
-- their first check. Cameras hidden by the old rule come back on their next
-- check (the hourly cron, or a manual run).
--
-- ACCESS: service_role only. APPLY: after 187, manually, whole file,
-- BEFORE merge. Then supabase/tests/img5c_guards.sql — ONE result row.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.webcam_record_liveness(jsonb)') IS NULL THEN
    RAISE EXCEPTION '190 requires 187 (webcams wave 1) — apply 187 first';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.webcam_record_liveness(p_rows jsonb)
RETURNS TABLE (recorded integer, live integer, frozen integer, failed integer)
LANGUAGE plpgsql
AS $function$
DECLARE
  r jsonb; v_prev text; v_outcome text; v_at timestamptz;
  n_rec integer := 0; n_live integer := 0; n_frozen integer := 0; n_fail integer := 0;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_outcome := r->>'outcome';
    v_at := coalesce((r->>'checked_at')::timestamptz, now());
    IF v_outcome = 'ok' THEN
      -- compare with the newest good fetch at least 30 minutes older: a
      -- camera that refreshes every 2-5 min can serve the same frame twice
      -- in one minute, and that is not a frozen camera (190)
      SELECT l.bytes_sha256 INTO v_prev
        FROM public.webcam_liveness l
       WHERE l.webcam_id = r->>'webcam_id' AND l.outcome IN ('ok', 'frozen')
         AND l.checked_at <= v_at - interval '30 minutes'
       ORDER BY l.checked_at DESC LIMIT 1;
      -- same bytes as a good fetch >= 30 min earlier = a frozen frame, not a live camera
      IF v_prev IS NOT NULL AND v_prev = r->>'bytes_sha256' THEN v_outcome := 'frozen'; END IF;
    END IF;

    INSERT INTO public.webcam_liveness (webcam_id, checked_at, outcome, http_status, bytes_len, bytes_sha256)
    VALUES (r->>'webcam_id', v_at, v_outcome, (r->>'http_status')::smallint,
            (r->>'bytes_len')::integer, r->>'bytes_sha256')
    ON CONFLICT (webcam_id, checked_at) DO NOTHING;

    UPDATE public.webcams w
       SET is_live = (v_outcome = 'ok' AND w.retired_at IS NULL
                      AND public.imagery_licence_status(w.provider_id) = 'ok'),
           last_ok_at = CASE WHEN v_outcome = 'ok' THEN v_at ELSE w.last_ok_at END,
           updated_at = now()
     WHERE w.webcam_id = r->>'webcam_id';

    n_rec := n_rec + 1;
    IF v_outcome = 'ok' THEN n_live := n_live + 1;
    ELSIF v_outcome = 'frozen' THEN n_frozen := n_frozen + 1;
    ELSE n_fail := n_fail + 1; END IF;
  END LOOP;

  DELETE FROM public.webcam_liveness WHERE checked_at < now() - interval '7 days';
  recorded := n_rec; live := n_live; frozen := n_frozen; failed := n_fail;
  RETURN NEXT;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.webcam_record_liveness(jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.webcam_record_liveness(jsonb) TO service_role;

COMMIT;

-- VERIFY (read only): the rule is in place; cameras hidden as frozen today.
SELECT (SELECT prosrc LIKE '%30 minutes%' FROM pg_proc WHERE oid = 'public.webcam_record_liveness(jsonb)'::regprocedure) AS rule_190,
       (SELECT count(*) FROM public.webcams WHERE is_live)                                                             AS live_cameras,
       (SELECT count(*) FROM (SELECT DISTINCT ON (webcam_id) outcome FROM public.webcam_liveness
                               ORDER BY webcam_id, checked_at DESC) x WHERE x.outcome = 'frozen')                      AS latest_check_frozen;
