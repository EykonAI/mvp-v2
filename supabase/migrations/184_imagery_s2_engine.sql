-- ═══════════════════════════════════════════════════════════════════════
-- eYKON.ai — 184 · Sentinel-2 observation engine: due list, check log,
--             the one write path, the globe read, mines switched on
--             (Imagery Layer build prompt rev A, IMG-2). Requires 183.
--
-- PURPOSE
-- 183 gave imagery a schema. This migration gives the Sentinel-2 cron
-- (app/api/cron/ingest-imagery-s2) everything it needs in the database,
-- so the rules live next to the data rather than in a route:
--
--   1 · imagery_aoi_checks — one row per AOI × sensor × cron look: the
--       window asked for, how many acquisitions came back, how many rows
--       were written, any error. It is what makes "we looked and saw
--       nothing" distinguishable from "we never looked" (brief §0.2), and
--       it drives the due list.
--
--   2 · imagery_s2_due(limit, min_age_hours) — AOIs with 's2_l2a'
--       enabled, least-recently-checked first, with the window to ask
--       for: from the end of the last checked window MINUS 5 DAYS (a
--       Sentinel-2 L2A product can publish a day or more after sensing;
--       re-reading the tail means a late product is picked up, not lost —
--       the §8.6 publication-lag lesson), capped at 30 days back.
--
--   3 · imagery_upsert_s2(jsonb) — the ONE write path for S2 rows. It
--       upserts on the natural key (183's expression index, which
--       PostgREST cannot target), computes the baseline IN SQL as the
--       MEDIAN of the AOI's previous clear values of the same metric over
--       120 days (stored only with n ≥ 3), and so every row carries its
--       anchor or none. The 183 CHECKs and licence trigger still apply.
--
--   4 · imagery_latest(bbox) — the globe read: per active AOI in the bbox
--       with any S2 look, the LATEST look whatever its state (so a cloudy
--       week reads "cloudy on <date>", never a stale chip passed off as
--       current) and, separately, the latest CLEAR look with its chip.
--       Uses the GIST index.
--
--   5 · Mines switched on. sensors_enabled = {s2_l2a}, priority 1, for
--       the mine AOIs — the same sites the retired monthly cron imaged, so
--       the processing-unit spend stays in the same order. Refinery
--       complexes, LNG terminals and ports stay OFF until the measured PU
--       per request has been read from imagery_observations.pu_cost (a
--       founder budget decision, not a code default).
--
-- ACCESS: RLS on, service_role only (REVOKE by role name).
-- APPLY: AFTER 183, manually in the SQL Editor, BEFORE merge, whole file.
-- Then run supabase/tests/img2_guards.sql; its last statement returns ONE
-- result row. Replayed under PGlite 0.5.8 + PostGIS 3.6 before hand-off.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.imagery_observations') IS NULL THEN
    RAISE EXCEPTION '184 requires 183 (imagery schema) — apply 183 first';
  END IF;
END $$;

-- ─── 1 · Check log ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.imagery_aoi_checks (
  aoi_id              text        NOT NULL REFERENCES public.imagery_aois (aoi_id),
  sensor              text        NOT NULL,
  checked_at          timestamptz NOT NULL DEFAULT now(),
  window_from         timestamptz NOT NULL,
  window_to           timestamptz NOT NULL,
  acquisitions_found  integer,
  rows_written        integer,
  pu_estimate         numeric,
  error               text,
  PRIMARY KEY (aoi_id, sensor, checked_at),
  CONSTRAINT iac_sensor CHECK (sensor IN ('s2_l2a','s1_grd','gibs_true_colour','landsat_c2l2')),
  CONSTRAINT iac_window CHECK (window_to > window_from),
  -- a check either failed (error, no counts) or ran (counts, no error)
  CONSTRAINT iac_outcome CHECK (
    (error IS NOT NULL AND acquisitions_found IS NULL AND rows_written IS NULL)
    OR (error IS NULL AND acquisitions_found >= 0 AND rows_written >= 0 AND rows_written <= acquisitions_found))
);

CREATE INDEX IF NOT EXISTS imagery_aoi_checks_latest_idx
  ON public.imagery_aoi_checks (aoi_id, sensor, checked_at DESC);

COMMENT ON TABLE public.imagery_aoi_checks IS
  'IMG-2 (mig 184). One row per AOI × sensor × cron look: the window asked for, acquisitions returned, rows written, estimated PU, or the error. Distinguishes "looked, nothing acquired" from "never looked"; drives imagery_s2_due().';

-- ─── 2 · Due list ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.imagery_s2_due(p_limit integer DEFAULT 25, p_min_age_hours integer DEFAULT 20)
RETURNS TABLE (
  aoi_id text, kind text, name text, geojson text,
  xmin double precision, ymin double precision, xmax double precision, ymax double precision,
  area_km2 double precision, last_checked_at timestamptz,
  window_from timestamptz, window_to timestamptz
)
LANGUAGE sql
STABLE
AS $function$
  WITH last AS (
    SELECT DISTINCT ON (c.aoi_id) c.aoi_id, c.checked_at, c.window_to
      FROM public.imagery_aoi_checks c
     WHERE c.sensor = 's2_l2a' AND c.error IS NULL
     ORDER BY c.aoi_id, c.checked_at DESC
  )
  SELECT a.aoi_id, a.kind, a.name, ST_AsGeoJSON(a.geom, 7),
         ST_XMin(a.geom), ST_YMin(a.geom), ST_XMax(a.geom), ST_YMax(a.geom),
         a.area_km2, l.checked_at,
         greatest(coalesce(l.window_to - interval '5 days', now() - interval '30 days'),
                  now() - interval '30 days'),
         now()
    FROM public.imagery_aois a
    LEFT JOIN last l ON l.aoi_id = a.aoi_id
   WHERE a.retired_at IS NULL
     AND 's2_l2a' = ANY (a.sensors_enabled)
     AND (l.checked_at IS NULL OR l.checked_at < now() - make_interval(hours => greatest(p_min_age_hours, 1)))
   ORDER BY a.priority DESC, l.checked_at ASC NULLS FIRST, a.aoi_id
   LIMIT greatest(least(p_limit, 200), 1)
$function$;

COMMENT ON FUNCTION public.imagery_s2_due(integer, integer) IS
  'IMG-2 (mig 184). AOIs with s2_l2a enabled, least-recently-checked first, each with its window: from the last checked window_to minus 5 days (late L2A products are re-read, not lost), never more than 30 days back.';

-- ─── 3 · The one write path ────────────────────────────────────────────
-- p_rows: jsonb array of objects with the imagery_observations columns
-- (aoi_id, acquired_at, coverage_state, cloud_fraction_aoi,
-- aoi_covered_fraction, metric_name, metric_stat, metric_value, chip_path,
-- pu_cost, request_id). sensor and provider are fixed here.
CREATE OR REPLACE FUNCTION public.imagery_upsert_s2(p_rows jsonb)
RETURNS TABLE (written integer, with_baseline integer)
LANGUAGE plpgsql
AS $function$
DECLARE
  r        jsonb;
  v_base   double precision;
  v_n      integer;
  n_w      integer := 0;
  n_b      integer := 0;
  v_value  double precision;
  v_metric text;
  v_at     timestamptz;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'imagery_upsert_s2: p_rows must be a jsonb array';
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_value  := (r->>'metric_value')::double precision;
    v_metric := r->>'metric_name';
    v_at     := (r->>'acquired_at')::timestamptz;
    v_base := NULL; v_n := NULL;
    IF v_value IS NOT NULL AND r->>'coverage_state' = 'clear' THEN
      -- the AOI's OWN baseline: median of previous clear values, 120 days
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY o.metric_value), count(*)
        INTO v_base, v_n
        FROM public.imagery_observations o
       WHERE o.aoi_id = r->>'aoi_id' AND o.sensor = 's2_l2a'
         AND o.metric_name = v_metric AND o.coverage_state = 'clear'
         AND o.metric_value IS NOT NULL
         AND o.acquired_at < v_at AND o.acquired_at >= v_at - interval '120 days';
      IF v_n < 3 THEN v_base := NULL; v_n := NULL; END IF;
    END IF;

    INSERT INTO public.imagery_observations AS o
      (aoi_id, sensor, provider_id, acquired_at, coverage_state, cloud_fraction_aoi, aoi_covered_fraction,
       metric_name, metric_stat, metric_value, baseline_median, baseline_n, baseline_window,
       chip_path, pu_cost, request_id)
    VALUES
      (r->>'aoi_id', 's2_l2a', 'copernicus_cdse', v_at, r->>'coverage_state',
       (r->>'cloud_fraction_aoi')::numeric, (r->>'aoi_covered_fraction')::numeric,
       v_metric, r->>'metric_stat', v_value,
       v_base, v_n, CASE WHEN v_n IS NOT NULL THEN 'previous 120 days, clear looks only' END,
       r->>'chip_path', (r->>'pu_cost')::numeric, r->>'request_id')
    ON CONFLICT (aoi_id, sensor, acquired_at, coalesce(metric_name, ''))
    DO UPDATE SET
      coverage_state       = EXCLUDED.coverage_state,
      cloud_fraction_aoi   = EXCLUDED.cloud_fraction_aoi,
      aoi_covered_fraction = EXCLUDED.aoi_covered_fraction,
      metric_stat          = EXCLUDED.metric_stat,
      metric_value         = EXCLUDED.metric_value,
      baseline_median      = EXCLUDED.baseline_median,
      baseline_n           = EXCLUDED.baseline_n,
      baseline_window      = EXCLUDED.baseline_window,
      -- a re-read without a new chip keeps the chip already stored
      chip_path            = coalesce(EXCLUDED.chip_path, o.chip_path),
      pu_cost              = EXCLUDED.pu_cost,
      request_id           = EXCLUDED.request_id,
      ingested_at          = now();
    n_w := n_w + 1;
    IF v_n IS NOT NULL THEN n_b := n_b + 1; END IF;
  END LOOP;
  written := n_w; with_baseline := n_b;
  RETURN NEXT;
END
$function$;

COMMENT ON FUNCTION public.imagery_upsert_s2(jsonb) IS
  'IMG-2 (mig 184). The one write path for Sentinel-2 observations: upsert on the natural key, baseline = median of the AOI''s previous clear values of the same metric over 120 days, stored only with n >= 3. The 183 CHECKs and licence trigger still apply to every row.';

-- ─── 4 · The globe read ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.imagery_latest(
  p_lon_min double precision, p_lat_min double precision,
  p_lon_max double precision, p_lat_max double precision,
  p_limit integer DEFAULT 2000)
RETURNS TABLE (
  aoi_id text, kind text, name text, country_iso text,
  latitude double precision, longitude double precision,
  latest_acquired_at timestamptz, latest_state text, latest_cloud_fraction numeric,
  clear_acquired_at timestamptz, clear_chip_path text,
  clear_metric_name text, clear_metric_value double precision,
  clear_baseline_median double precision, clear_baseline_n integer,
  attribution_text text
)
LANGUAGE sql
STABLE
AS $function$
  SELECT a.aoi_id, a.kind, a.name, a.country_iso, a.centroid_lat, a.centroid_lon,
         lt.acquired_at, lt.coverage_state, lt.cloud_fraction_aoi,
         cl.acquired_at, cl.chip_path, cl.metric_name, cl.metric_value,
         cl.baseline_median, cl.baseline_n,
         replace(lic.attribution_text, '{year}',
                 to_char(coalesce(cl.acquired_at, lt.acquired_at), 'YYYY'))
    FROM public.imagery_aois a
    CROSS JOIN LATERAL (
      SELECT o.acquired_at, o.coverage_state, o.cloud_fraction_aoi
        FROM public.imagery_observations o
       WHERE o.aoi_id = a.aoi_id AND o.sensor = 's2_l2a'
       ORDER BY o.acquired_at DESC LIMIT 1) lt
    LEFT JOIN LATERAL (
      SELECT o.acquired_at, o.chip_path, o.metric_name, o.metric_value, o.baseline_median, o.baseline_n
        FROM public.imagery_observations o
       WHERE o.aoi_id = a.aoi_id AND o.sensor = 's2_l2a' AND o.coverage_state = 'clear'
       ORDER BY o.acquired_at DESC LIMIT 1) cl ON true
    JOIN public.imagery_licences lic ON lic.provider_id = 'copernicus_cdse'
   WHERE a.retired_at IS NULL
     AND a.geom && ST_MakeEnvelope(p_lon_min, p_lat_min, p_lon_max, p_lat_max, 4326)
   ORDER BY a.priority DESC, a.aoi_id
   LIMIT greatest(least(p_limit, 5000), 1)
$function$;

COMMENT ON FUNCTION public.imagery_latest(double precision, double precision, double precision, double precision, integer) IS
  'IMG-2 (mig 184). Globe read: per active AOI in the bbox with any S2 look, the latest look in whatever state it was AND the latest clear look with its chip — so a cloudy latest pass is shown as cloudy, never hidden behind an older clear chip. Attribution year filled from the acquisition.';

-- ─── 5 · Mines switched on ─────────────────────────────────────────────
UPDATE public.imagery_aois
   SET sensors_enabled = ARRAY['s2_l2a'], priority = 1, updated_at = now()
 WHERE kind = 'mine' AND retired_at IS NULL AND NOT ('s2_l2a' = ANY (sensors_enabled));

-- ─── 6 · Access: service_role only ─────────────────────────────────────
ALTER TABLE public.imagery_aoi_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.imagery_aoi_checks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.imagery_aoi_checks TO service_role;

REVOKE EXECUTE ON FUNCTION public.imagery_s2_due(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.imagery_upsert_s2(jsonb)         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.imagery_latest(double precision, double precision, double precision, double precision, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.imagery_s2_due(integer, integer) TO service_role;
GRANT  EXECUTE ON FUNCTION public.imagery_upsert_s2(jsonb)         TO service_role;
GRANT  EXECUTE ON FUNCTION public.imagery_latest(double precision, double precision, double precision, double precision, integer) TO service_role;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════
-- VERIFY — read-only. Paste these rows back.
-- ═══════════════════════════════════════════════════════════════════════
-- V1 · what is switched on — expect mine only
SELECT kind, count(*) FILTER (WHERE 's2_l2a' = ANY (sensors_enabled)) AS s2_enabled, count(*) AS active
  FROM public.imagery_aois WHERE retired_at IS NULL GROUP BY kind ORDER BY kind;
-- V2 · the first due list — expect every mine AOI, window 30 days, no previous check
SELECT count(*) AS due_now, min(window_from) AS window_from, max(window_to) AS window_to,
       count(*) FILTER (WHERE last_checked_at IS NOT NULL) AS previously_checked
  FROM public.imagery_s2_due(200, 20);
