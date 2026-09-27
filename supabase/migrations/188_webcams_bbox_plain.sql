-- ═══════════════════════════════════════════════════════════════════════
-- 188 · Webcams — the globe read without a geography envelope (IMG-5 fix)
--
-- WHY: /api/webcams answered 502 on its first production read (2026-09-26):
--   "webcams_in_bbox: Antipodal (180 degrees long) edge detected!"
-- 187 filtered with ST_MakeEnvelope(...)::geography. A geography polygon
-- cannot have an edge 180° or more long, so the whole-world bbox the route
-- sends by default (-180..180), and any viewport wider than half the globe
-- at low zoom, raised instead of returning cameras. Reproduced under
-- PGlite + PostGIS before this fix: world → ERROR, Europe → OK.
--
-- WHAT: webcams_in_bbox filters on the plain latitude / longitude columns
-- (the same values geom is generated from). A bbox with lon_min > lon_max
-- is read as crossing the antimeridian (e.g. 170 → -170). Same signature,
-- same result columns, same rule: LIVE cameras only, no upstream URL.
-- A partial index on (longitude, latitude) for live cameras backs the scan.
--
-- ACCESS: service_role only. APPLY: after 187, manually, whole file,
-- BEFORE merge. Then supabase/tests/img5b_guards.sql — ONE result row.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.webcams_in_bbox(double precision,double precision,double precision,double precision,integer)') IS NULL THEN
    RAISE EXCEPTION '188 requires 187 (webcams wave 1) — apply 187 first';
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS webcams_live_lonlat_idx
  ON public.webcams (longitude, latitude)
  WHERE is_live AND retired_at IS NULL;

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
     AND w.latitude BETWEEN least(p_lat_min, p_lat_max) AND greatest(p_lat_min, p_lat_max)
     AND CASE WHEN p_lon_min <= p_lon_max
              THEN w.longitude BETWEEN p_lon_min AND p_lon_max          -- ordinary viewport
              ELSE w.longitude >= p_lon_min OR w.longitude <= p_lon_max -- crosses the antimeridian
         END
   ORDER BY w.webcam_id
   LIMIT greatest(least(p_limit, 5000), 1)
$function$;

REVOKE EXECUTE ON FUNCTION public.webcams_in_bbox(double precision, double precision, double precision, double precision, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.webcams_in_bbox(double precision, double precision, double precision, double precision, integer) TO service_role;

COMMIT;

-- VERIFY (read only): a whole-world read must now answer, not raise.
SELECT '188 applied' AS result,
       (SELECT count(*) FROM public.webcams_in_bbox(-180, -90, 180, 90, 5000)) AS live_cameras_world,
       (SELECT count(*) FROM public.webcams WHERE is_live AND retired_at IS NULL) AS live_cameras_table;
