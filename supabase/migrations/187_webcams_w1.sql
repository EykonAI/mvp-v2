-- ═══════════════════════════════════════════════════════════════════════
-- eYKON.ai — 187 · Webcams wave 1: registry upsert, liveness with frozen-
--             frame detection, the globe read, the upstream resolver
--             (Imagery Layer build prompt rev A, IMG-5). Requires 183.
--
-- PURPOSE
-- 183 created webcams and webcam_liveness with their CHECKs and licence
-- gate. This migration adds the functions the IMG-5 crons and routes call,
-- so the rules live next to the data:
--
--   1 · webcams_upsert(provider, rows) — the one writer of the registry.
--       webcam_id is DERIVED IN SQL: 'wc_' + first 16 hex of
--       sha256(provider || ':' || provider_cam_id) — stable, opaque, never
--       the upstream URL. nearest_aoi_id is the closest active AOI within
--       5 km. A camera missing from its provider's list is retired, never
--       deleted. New cameras start NOT live; only a liveness check makes one
--       live (and 183's trigger allows that only under an 'ok' licence).
--
--   2 · webcam_record_liveness(rows) — one row per fetch. A camera is live
--       only if its newest fetch returned an image whose bytes DIFFER from
--       the previous good fetch; identical bytes on consecutive checks
--       hours apart = 'frozen' (looks-alive-but-isn't, brief §0.2), and a
--       frozen, failed or timed-out camera is hidden. The fetcher also
--       reports 'frozen' when the upstream Last-Modified is > 24 h old (a
--       USGS camera's newest image was from March 2025 on 2026-09-26), so a
--       stale camera is never live even on its first check. Keeps 7 days.
--
--   3 · webcams_in_bbox(bbox) — the globe read: live cameras only, and NO
--       upstream_url (it is service-role only and never sent to a client —
--       the Argos Atlas relay leaks it in base64; eYKON does not).
--
--   4 · webcam_upstream(id) — the proxy's resolver: upstream URL, provider,
--       attribution, for a LIVE camera only.
--
--   5 · webcam_liveness_due(limit) — least-recently-checked cameras first.
--
-- Also: the Singapore feed arrives via data.gov.sg (the LTA traffic images
-- under the Singapore Open Data Licence), so sg_lta's credit says so.
--
-- ACCESS: service_role only. APPLY: after 183 (any of 184–186 may or may
-- not be applied), manually, whole file, BEFORE merge. Then
-- supabase/tests/img5_guards.sql — ONE result row.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.webcams') IS NULL THEN
    RAISE EXCEPTION '187 requires 183 (imagery schema) — apply 183 first';
  END IF;
END $$;

UPDATE public.imagery_licences
   SET attribution_text = 'Traffic images: Land Transport Authority, via data.gov.sg (Singapore Open Data Licence)',
       terms_url = 'https://data.gov.sg/open-data-licence',
       notes = 'Wave 1 reads the LTA traffic images through api.data.gov.sg (no key; 8 cameras on 2026-09-26). Image URLs change every refresh and are resolved per request.'
 WHERE provider_id = 'sg_lta';

CREATE INDEX IF NOT EXISTS webcam_liveness_recent_idx
  ON public.webcam_liveness (webcam_id, checked_at DESC);

-- ─── 1 · Registry upsert ───────────────────────────────────────────────
-- p_rows: [{provider_cam_id, name, latitude, longitude, heading_deg,
--           category, media_type, upstream_url}]
CREATE OR REPLACE FUNCTION public.webcams_upsert(p_provider text, p_rows jsonb)
RETURNS TABLE (inserted integer, updated integer, retired integer, active integer)
LANGUAGE plpgsql
AS $function$
#variable_conflict use_column
DECLARE
  v_attr text;
  n_ins integer := 0; n_upd integer := 0; n_ret integer;
BEGIN
  SELECT attribution_text INTO v_attr FROM public.imagery_licences WHERE provider_id = p_provider;
  IF v_attr IS NULL THEN
    RAISE EXCEPTION 'webcams_upsert: provider % has no licence row with an attribution', p_provider;
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) = 0 THEN
    -- an empty list would retire every camera of the provider: refuse, loudly
    RAISE EXCEPTION 'webcams_upsert: empty or non-array list for % — refusing to retire everything', p_provider;
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _wc_src (
    webcam_id text PRIMARY KEY, provider_cam_id text, name text, latitude double precision,
    longitude double precision, heading_deg smallint, category text, media_type text, upstream_url text
  ) ON COMMIT DROP;
  TRUNCATE _wc_src;

  INSERT INTO _wc_src
  SELECT DISTINCT ON (r->>'provider_cam_id')
         'wc_' || left(encode(sha256(convert_to(p_provider || ':' || (r->>'provider_cam_id'), 'UTF8')), 'hex'), 16),
         r->>'provider_cam_id', left(coalesce(nullif(r->>'name', ''), r->>'provider_cam_id'), 200),
         (r->>'latitude')::double precision, (r->>'longitude')::double precision,
         CASE WHEN (r->>'heading_deg') ~ '^[0-9]+(\.[0-9]+)?$' THEN ((r->>'heading_deg')::numeric % 360)::smallint END,
         coalesce(r->>'category', 'traffic'), coalesce(r->>'media_type', 'image'), r->>'upstream_url'
    FROM jsonb_array_elements(p_rows) r
   WHERE (r->>'provider_cam_id') IS NOT NULL
     AND (r->>'latitude') ~ '^-?[0-9]+(\.[0-9]+)?$' AND (r->>'longitude') ~ '^-?[0-9]+(\.[0-9]+)?$'
     AND abs((r->>'latitude')::double precision) <= 90 AND abs((r->>'longitude')::double precision) <= 180
     AND NOT ((r->>'latitude')::double precision = 0 AND (r->>'longitude')::double precision = 0)
     AND (r->>'upstream_url') ~ '^https?://'
   ORDER BY r->>'provider_cam_id';

  WITH up AS (
    INSERT INTO public.webcams AS w
      (webcam_id, provider_id, provider_cam_id, upstream_url, name, latitude, longitude,
       heading_deg, category, media_type, attribution_text, nearest_aoi_id)
    SELECT s.webcam_id, p_provider, s.provider_cam_id, s.upstream_url, s.name, s.latitude, s.longitude,
           s.heading_deg, s.category, s.media_type, v_attr,
           (SELECT a.aoi_id FROM public.imagery_aois a
             WHERE a.retired_at IS NULL
               AND a.geom && ST_Expand(ST_SetSRID(ST_MakePoint(s.longitude, s.latitude), 4326), 0.06)
               AND ST_DWithin(a.geom::geography, ST_SetSRID(ST_MakePoint(s.longitude, s.latitude), 4326)::geography, 5000)
             ORDER BY a.geom::geography <-> ST_SetSRID(ST_MakePoint(s.longitude, s.latitude), 4326)::geography
             LIMIT 1)
      FROM _wc_src s
    ON CONFLICT (webcam_id) DO UPDATE SET
      upstream_url = EXCLUDED.upstream_url, name = EXCLUDED.name, latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude, heading_deg = EXCLUDED.heading_deg, category = EXCLUDED.category,
      media_type = EXCLUDED.media_type, attribution_text = EXCLUDED.attribution_text,
      nearest_aoi_id = EXCLUDED.nearest_aoi_id, retired_at = NULL, updated_at = now()
    RETURNING (w.xmax = 0) AS was_insert
  )
  SELECT count(*) FILTER (WHERE was_insert), count(*) FILTER (WHERE NOT was_insert) INTO n_ins, n_upd FROM up;

  UPDATE public.webcams w
     SET retired_at = now(), is_live = false, updated_at = now()
   WHERE w.provider_id = p_provider AND w.retired_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM _wc_src s WHERE s.webcam_id = w.webcam_id);
  GET DIAGNOSTICS n_ret = ROW_COUNT;

  inserted := n_ins; updated := n_upd; retired := n_ret;
  SELECT count(*) INTO active FROM public.webcams w WHERE w.provider_id = p_provider AND w.retired_at IS NULL;
  RETURN NEXT;
END
$function$;

-- ─── 2 · Liveness ──────────────────────────────────────────────────────
-- p_rows: [{webcam_id, checked_at, outcome ('ok'|'http_error'|'timeout'|
--           'decode_error'), http_status, bytes_len, bytes_sha256}]
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
      SELECT l.bytes_sha256 INTO v_prev
        FROM public.webcam_liveness l
       WHERE l.webcam_id = r->>'webcam_id' AND l.outcome IN ('ok', 'frozen') AND l.checked_at < v_at
       ORDER BY l.checked_at DESC LIMIT 1;
      -- same bytes as the previous good fetch = a frozen frame, not a live camera
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

CREATE OR REPLACE FUNCTION public.webcam_liveness_due(p_limit integer DEFAULT 500)
RETURNS TABLE (webcam_id text, provider_id text, upstream_url text)
LANGUAGE sql
STABLE
AS $function$
  SELECT w.webcam_id, w.provider_id, w.upstream_url
    FROM public.webcams w
    LEFT JOIN LATERAL (SELECT max(l.checked_at) AS last FROM public.webcam_liveness l WHERE l.webcam_id = w.webcam_id) l ON true
   WHERE w.retired_at IS NULL AND public.imagery_licence_status(w.provider_id) = 'ok'
   ORDER BY l.last ASC NULLS FIRST, w.webcam_id
   LIMIT greatest(least(p_limit, 2000), 1)
$function$;

-- ─── 3 · Globe read (no upstream URL) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.webcams_in_bbox(
  p_lon_min double precision, p_lat_min double precision,
  p_lon_max double precision, p_lat_max double precision, p_limit integer DEFAULT 3000)
RETURNS TABLE (webcam_id text, provider_id text, name text, latitude double precision, longitude double precision,
               heading_deg smallint, category text, attribution_text text, last_ok_at timestamptz,
               nearest_aoi_id text, nearest_aoi_name text)
LANGUAGE sql
STABLE
AS $function$
  SELECT w.webcam_id, w.provider_id, w.name, w.latitude, w.longitude, w.heading_deg, w.category,
         w.attribution_text, w.last_ok_at, w.nearest_aoi_id, a.name
    FROM public.webcams w
    LEFT JOIN public.imagery_aois a ON a.aoi_id = w.nearest_aoi_id
   WHERE w.is_live AND w.retired_at IS NULL
     AND w.geom && ST_MakeEnvelope(p_lon_min, p_lat_min, p_lon_max, p_lat_max, 4326)::geography
   ORDER BY w.webcam_id
   LIMIT greatest(least(p_limit, 5000), 1)
$function$;

-- ─── 4 · Proxy resolver (live cameras only) ────────────────────────────
CREATE OR REPLACE FUNCTION public.webcam_upstream(p_webcam_id text)
RETURNS TABLE (upstream_url text, provider_id text, attribution_text text, last_ok_at timestamptz)
LANGUAGE sql
STABLE
AS $function$
  SELECT w.upstream_url, w.provider_id, w.attribution_text, w.last_ok_at
    FROM public.webcams w
   WHERE w.webcam_id = p_webcam_id AND w.is_live AND w.retired_at IS NULL
     AND public.imagery_licence_status(w.provider_id) = 'ok'
$function$;

-- ─── 5 · Access ────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.webcams_upsert(text, jsonb)          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.webcam_record_liveness(jsonb)        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.webcam_liveness_due(integer)         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.webcams_in_bbox(double precision, double precision, double precision, double precision, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.webcam_upstream(text)                FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.webcams_upsert(text, jsonb)          TO service_role;
GRANT  EXECUTE ON FUNCTION public.webcam_record_liveness(jsonb)        TO service_role;
GRANT  EXECUTE ON FUNCTION public.webcam_liveness_due(integer)         TO service_role;
GRANT  EXECUTE ON FUNCTION public.webcams_in_bbox(double precision, double precision, double precision, double precision, integer) TO service_role;
GRANT  EXECUTE ON FUNCTION public.webcam_upstream(text)                TO service_role;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════
-- VERIFY — read-only. Expect: 5 functions · sg_lta credit mentions
-- data.gov.sg · 0 webcams (the registry cron fills them).
-- ═══════════════════════════════════════════════════════════════════════
SELECT (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname IN
         ('webcams_upsert','webcam_record_liveness','webcam_liveness_due','webcams_in_bbox','webcam_upstream')) AS functions_187,
       (SELECT attribution_text FROM public.imagery_licences WHERE provider_id = 'sg_lta')             AS sg_credit,
       (SELECT count(*) FROM public.webcams)                                                           AS webcams;
