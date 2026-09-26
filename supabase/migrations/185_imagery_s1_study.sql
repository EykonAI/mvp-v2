-- ═══════════════════════════════════════════════════════════════════════
-- eYKON.ai — 185 · Sentinel-1 measurement study: anchorage AOIs from AIS,
--             hourly AIS counts per anchorage, S1 write path, the study
--             (Imagery Layer build prompt rev A, IMG-3). Requires 183, 184.
--
-- PURPOSE — MEASURE BEFORE BUILDING (brief §8.6)
-- Before a Sentinel-1 radar reading scores, alerts or enters convergence,
-- it must be shown to measure ships, not the instrument (brief §6.7). This
-- migration builds the study that decides that — and nothing a user sees.
--
--   1 · ANCHORAGES FROM AIS. imagery_derive_anchorages() finds where
--       profiled vessels sit still (speed < 0.5 kn) 3–30 km from a large or
--       medium port — outside the 3 km berth ring port_calls already uses —
--       and mints one 'anchorage' AOI per port from those cells. Positions
--       are binned to ~2 km cells BEFORE the port join, so the large table
--       is scanned once, by its recorded_at index, and aggregated in memory
--       (the 2026-09-18 temp-disk incident, brief §16.13).
--       KNOWN BIAS: ais_position_history holds only the ~2,048 profiled
--       (shadow-fleet) vessels, so anchorages are found where THAT fleet
--       waits — tanker-heavy. Stated, not corrected.
--
--   2 · THE MISSING COMPARISON, STARTED NOW. There is no historical AIS for
--       ALL vessels: vessel_positions keeps one current row per vessel and
--       the history table only the profiled fleet. So "how many ships did AIS
--       show inside this anchorage when Sentinel-1 passed" does not exist
--       until it is recorded. ais_aoi_counts records it hourly (pg_cron) from
--       vessel_positions: vessels with a fix inside the polygon in the last
--       30 minutes. When the AIS feed itself is stale (newest fix anywhere
--       older than 30 min) the row is VOID — counts NULL — never zero.
--
--   3 · S1 WRITE PATH. imagery_upsert_obs(sensor, rows) — the generic form of
--       184's S2 writer (same median baseline, n ≥ 3), used for s1_grd. The
--       S1 metric is bright_target_area_m2 (stat 'area_m2'): VV backscatter
--       area above a pinned threshold inside the polygon. Not a vessel count:
--       counting objects needs connected components the Statistical API
--       cannot compute. Area is enough for the study — Spearman ρ compares
--       ranks, not units.
--
--   4 · THE STUDY. imagery_s1_study(days) pairs every clear S1 look with the
--       AIS count sampled nearest to it (±30 min) and reports, per anchorage:
--       pairs, Spearman ρ (average ranks for ties), and the share-of-region
--       drift between the first and second half of the window. ADMISSION
--       (build prompt §4.4): ρ ≥ 0.70 on ≥ 10 pairs AND |share drift| ≤
--       ln 1.5. The study can fail; a failed study ends the S1 track and the
--       PR says so.
--
--   5 · STUDY SET. imagery_enable_s1_study(n) switches s1_grd on for the n
--       anchorages with the densest AIS — median hourly count over the last
--       72 h, needing ≥ 48 non-VOID samples. Called by hand once the hourly
--       counts have run for three days; never by this migration.
--
-- ACCESS: RLS on, service_role only. The pg_cron job runs as its owner.
-- APPLY: after 183 and 184, manually, BEFORE merge, whole file. Then
-- supabase/tests/img3_guards.sql — ONE result row. Replayed under PGlite
-- 0.5.8 + PostGIS 3.6 before hand-off (pg_cron stubbed there, and said so).
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.imagery_upsert_s2(jsonb)') IS NULL THEN
    RAISE EXCEPTION '185 requires 184 (Sentinel-2 engine) — apply 183 and 184 first';
  END IF;
END $$;

-- ─── 1 · Anchorages from AIS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.imagery_anchorage_stats (
  aoi_id            text        PRIMARY KEY REFERENCES public.imagery_aois (aoi_id),
  port_id           text        NOT NULL,
  cells             integer     NOT NULL,
  vessel_hours      integer     NOT NULL,
  distinct_vessels  integer     NOT NULL,
  window_from       timestamptz NOT NULL,
  window_to         timestamptz NOT NULL,
  derived_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ias_counts CHECK (cells > 0 AND vessel_hours > 0 AND distinct_vessels > 0 AND distinct_vessels <= vessel_hours)
);

COMMENT ON TABLE public.imagery_anchorage_stats IS
  'IMG-3 (mig 185). How each anchorage AOI was found: stationary profiled-fleet samples 3–30 km from its port, over the stated window. Profiled (shadow-fleet) vessels only — a tanker-biased view of where ships wait.';

CREATE OR REPLACE FUNCTION public.imagery_derive_anchorages(
  p_days integer DEFAULT 7,
  p_min_vessel_hours integer DEFAULT 24)
RETURNS TABLE (aoi_id text, port_id text, port_name text, cells integer, vessel_hours integer,
               distinct_vessels integer, area_km2 double precision, inserted boolean)
LANGUAGE plpgsql
AS $function$
-- the RETURNS TABLE names (aoi_id, port_id, …) are also column names below
#variable_conflict use_column
DECLARE
  v_from timestamptz := now() - make_interval(days => least(greatest(p_days, 1), 14));
  v_to   timestamptz := now();
  c_cell constant double precision := 0.02;   -- ≈ 2.2 km of latitude
BEGIN
  -- a bounded, read-mostly scan: never more than 14 days of history
  SET LOCAL statement_timeout = '120s';
  SET LOCAL work_mem = '64MB';

  RETURN QUERY
  WITH cells AS (            -- 1. bin stationary samples to cells FIRST (small result)
    SELECT floor(h.latitude / c_cell)::integer  AS cy,
           floor(h.longitude / c_cell)::integer AS cx,
           count(*)::integer                    AS vh,
           count(DISTINCT h.mmsi)::integer       AS dv
      FROM public.ais_position_history h
     WHERE h.recorded_at >= v_from AND h.recorded_at < v_to
       AND h.speed IS NOT NULL AND h.speed < 0.5
       AND h.latitude IS NOT NULL AND h.longitude IS NOT NULL
     GROUP BY 1, 2
  ), located AS (            -- 2. then attach each cell to its nearest L/M port, 3–30 km out
    SELECT c.*, p.id AS pid, p.port_name AS pname,
           ST_MakeEnvelope(c.cx * c_cell, c.cy * c_cell, (c.cx + 1) * c_cell, (c.cy + 1) * c_cell, 4326) AS cell_geom
      FROM cells c
      CROSS JOIN LATERAL (
        SELECT pt.id, pt.port_name, pt.geom
          FROM public.ports pt
         WHERE pt.harbor_size IN ('L','M') AND pt.geom IS NOT NULL
           AND ST_DWithin(pt.geom, ST_SetSRID(ST_MakePoint((c.cx + 0.5) * c_cell, (c.cy + 0.5) * c_cell), 4326)::geography, 30000)
         ORDER BY pt.geom <-> ST_SetSRID(ST_MakePoint((c.cx + 0.5) * c_cell, (c.cy + 0.5) * c_cell), 4326)::geography
         LIMIT 1) p
     WHERE NOT ST_DWithin(p.geom, ST_SetSRID(ST_MakePoint((c.cx + 0.5) * c_cell, (c.cy + 0.5) * c_cell), 4326)::geography, 3000)
  ), per_port AS (           -- 3. per port: keep it only with enough vessel-hours
    SELECT l.pid, min(l.pname) AS pname, count(*)::integer AS ncells,
           sum(l.vh)::integer AS vh, sum(l.dv)::integer AS dv_upper,
           -- the largest connected piece of the cell union, +500 m
           (SELECT d.geom FROM ST_Dump(ST_Union(l.cell_geom)) d ORDER BY ST_Area(d.geom) DESC LIMIT 1) AS piece
      FROM located l
     GROUP BY l.pid
    HAVING sum(l.vh) >= p_min_vessel_hours
  ), shaped AS (
    SELECT pp.*, ST_Buffer(pp.piece::geography, 500)::geometry AS geom
      FROM per_port pp
  ), ins AS (
    INSERT INTO public.imagery_aois AS a
      (aoi_id, kind, source_table, source_id, name, country_iso, geom, centroid_lat, centroid_lon, area_km2, buffer_rule)
    SELECT 'anchorage:' || s.pid, 'anchorage', 'ports', s.pid, s.pname || ' anchorage',
           (SELECT CASE WHEN pt.country_code ~ '^[A-Z]{2}$' THEN pt.country_code END FROM public.ports pt WHERE pt.id = s.pid),
           s.geom, ST_Y(ST_Centroid(s.geom)), ST_X(ST_Centroid(s.geom)), ST_Area(s.geom::geography) / 1e6,
           'largest connected union of 0.02° cells with stationary AIS 3–30 km from the port, + 500 m'
      FROM shaped s
     WHERE ST_Area(s.geom::geography) / 1e6 < 2500
    ON CONFLICT (aoi_id) DO NOTHING
    RETURNING a.aoi_id
  ), st AS (
    INSERT INTO public.imagery_anchorage_stats AS x
      (aoi_id, port_id, cells, vessel_hours, distinct_vessels, window_from, window_to)
    SELECT 'anchorage:' || s.pid, s.pid, s.ncells, s.vh, least(s.dv_upper, s.vh), v_from, v_to
      FROM shaped s
     WHERE ST_Area(s.geom::geography) / 1e6 < 2500
    ON CONFLICT ON CONSTRAINT imagery_anchorage_stats_pkey DO UPDATE SET
      cells = EXCLUDED.cells, vessel_hours = EXCLUDED.vessel_hours,
      distinct_vessels = EXCLUDED.distinct_vessels, window_from = EXCLUDED.window_from,
      window_to = EXCLUDED.window_to, derived_at = now()
    RETURNING x.aoi_id
  )
  SELECT 'anchorage:' || s.pid, s.pid, s.pname, s.ncells, s.vh, least(s.dv_upper, s.vh),
         ST_Area(s.geom::geography) / 1e6,
         EXISTS (SELECT 1 FROM ins WHERE ins.aoi_id = 'anchorage:' || s.pid)
    FROM shaped s
   WHERE ST_Area(s.geom::geography) / 1e6 < 2500
   ORDER BY s.vh DESC;
END
$function$;

COMMENT ON FUNCTION public.imagery_derive_anchorages(integer, integer) IS
  'IMG-3 (mig 185). Mint one anchorage AOI per L/M port from stationary profiled-fleet AIS 3–30 km out (window ≤ 14 days, 120 s timeout, binned before the port join). Existing anchorage AOIs are never moved (ON CONFLICT DO NOTHING; footprints freeze once observed). distinct_vessels is an UPPER bound (summed per cell).';

-- ─── 2 · Hourly AIS counts per anchorage ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.ais_aoi_counts (
  aoi_id              text        NOT NULL REFERENCES public.imagery_aois (aoi_id),
  sampled_at          timestamptz NOT NULL,
  vessels_fresh       integer,
  vessels_stationary  integer,
  feed_newest_fix_at  timestamptz,
  PRIMARY KEY (aoi_id, sampled_at),
  -- VOID: a stale feed stores NULL counts, never zero
  CONSTRAINT aac_pair CHECK ((vessels_fresh IS NULL) = (vessels_stationary IS NULL)),
  CONSTRAINT aac_counts CHECK (vessels_fresh IS NULL OR (vessels_fresh >= 0 AND vessels_stationary BETWEEN 0 AND vessels_fresh))
);

COMMENT ON TABLE public.ais_aoi_counts IS
  'IMG-3 (mig 185). Hourly count of vessels with an AIS fix inside each anchorage polygon in the previous 30 minutes (vessel_positions.updated_at). NULL counts = the AIS feed was stale when sampled — absence of a look, never zero ships.';

CREATE OR REPLACE FUNCTION public.imagery_sample_ais_counts()
RETURNS integer
LANGUAGE plpgsql
AS $function$
DECLARE
  v_now    timestamptz := date_trunc('minute', now());
  v_newest timestamptz;
  v_fresh  boolean;
  n        integer;
BEGIN
  SELECT max(updated_at) INTO v_newest FROM public.vessel_positions;   -- idx_vessel_updated_at
  v_fresh := v_newest IS NOT NULL AND v_newest >= v_now - interval '30 minutes';

  INSERT INTO public.ais_aoi_counts (aoi_id, sampled_at, vessels_fresh, vessels_stationary, feed_newest_fix_at)
  SELECT a.aoi_id, v_now,
         CASE WHEN v_fresh THEN c.n_all END,
         CASE WHEN v_fresh THEN c.n_still END,
         v_newest
    FROM public.imagery_aois a
    CROSS JOIN LATERAL (
      SELECT count(*)::integer AS n_all,
             count(*) FILTER (WHERE vp.speed IS NOT NULL AND vp.speed < 0.5)::integer AS n_still
        FROM public.vessel_positions vp
       WHERE v_fresh
         AND vp.geom && a.geom::geography                -- GIST on vessel_positions.geom
         AND ST_Intersects(vp.geom, a.geom::geography)
         AND vp.updated_at >= v_now - interval '30 minutes') c
   WHERE a.kind = 'anchorage' AND a.retired_at IS NULL
  ON CONFLICT (aoi_id, sampled_at) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;

  -- keep 120 days: enough for the 60-day study and its re-runs
  DELETE FROM public.ais_aoi_counts WHERE sampled_at < v_now - interval '120 days';
  RETURN n;
END
$function$;

COMMENT ON FUNCTION public.imagery_sample_ais_counts() IS
  'IMG-3 (mig 185). One ais_aoi_counts row per active anchorage per call; counts NULL when the newest AIS fix anywhere is older than 30 minutes. Scheduled hourly by pg_cron (imagery-ais-aoi-counts). Prunes rows older than 120 days.';

-- ─── 3 · Generic write path (s1_grd uses it) ───────────────────────────
CREATE OR REPLACE FUNCTION public.imagery_upsert_obs(p_sensor text, p_rows jsonb)
RETURNS TABLE (written integer, with_baseline integer)
LANGUAGE plpgsql
AS $function$
DECLARE
  r jsonb; v_base double precision; v_n integer; n_w integer := 0; n_b integer := 0;
  v_value double precision; v_metric text; v_at timestamptz;
BEGIN
  IF p_sensor NOT IN ('s1_grd','s2_l2a','landsat_c2l2') THEN
    RAISE EXCEPTION 'imagery_upsert_obs: unsupported sensor %', p_sensor;
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'imagery_upsert_obs: p_rows must be a jsonb array';
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_value := (r->>'metric_value')::double precision; v_metric := r->>'metric_name';
    v_at := (r->>'acquired_at')::timestamptz; v_base := NULL; v_n := NULL;
    IF v_value IS NOT NULL AND r->>'coverage_state' = 'clear' THEN
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY o.metric_value), count(*)
        INTO v_base, v_n
        FROM public.imagery_observations o
       WHERE o.aoi_id = r->>'aoi_id' AND o.sensor = p_sensor AND o.metric_name = v_metric
         AND o.coverage_state = 'clear' AND o.metric_value IS NOT NULL
         AND o.acquired_at < v_at AND o.acquired_at >= v_at - interval '120 days';
      IF v_n < 3 THEN v_base := NULL; v_n := NULL; END IF;
    END IF;
    INSERT INTO public.imagery_observations AS o
      (aoi_id, sensor, provider_id, acquired_at, coverage_state, cloud_fraction_aoi, aoi_covered_fraction,
       metric_name, metric_stat, metric_value, baseline_median, baseline_n, baseline_window, chip_path, pu_cost, request_id)
    VALUES
      (r->>'aoi_id', p_sensor, 'copernicus_cdse', v_at, r->>'coverage_state',
       (r->>'cloud_fraction_aoi')::numeric, (r->>'aoi_covered_fraction')::numeric,
       v_metric, r->>'metric_stat', v_value, v_base, v_n,
       CASE WHEN v_n IS NOT NULL THEN 'previous 120 days, clear looks only' END,
       r->>'chip_path', (r->>'pu_cost')::numeric, r->>'request_id')
    ON CONFLICT (aoi_id, sensor, acquired_at, coalesce(metric_name, ''))
    DO UPDATE SET coverage_state = EXCLUDED.coverage_state, cloud_fraction_aoi = EXCLUDED.cloud_fraction_aoi,
      aoi_covered_fraction = EXCLUDED.aoi_covered_fraction, metric_stat = EXCLUDED.metric_stat,
      metric_value = EXCLUDED.metric_value, baseline_median = EXCLUDED.baseline_median,
      baseline_n = EXCLUDED.baseline_n, baseline_window = EXCLUDED.baseline_window,
      chip_path = coalesce(EXCLUDED.chip_path, o.chip_path), pu_cost = EXCLUDED.pu_cost,
      request_id = EXCLUDED.request_id, ingested_at = now();
    n_w := n_w + 1; IF v_n IS NOT NULL THEN n_b := n_b + 1; END IF;
  END LOOP;
  written := n_w; with_baseline := n_b; RETURN NEXT;
END
$function$;

-- Generic due list (same window rule as imagery_s2_due)
CREATE OR REPLACE FUNCTION public.imagery_sensor_due(p_sensor text, p_limit integer DEFAULT 25, p_min_age_hours integer DEFAULT 20)
RETURNS TABLE (
  aoi_id text, kind text, name text, geojson text,
  xmin double precision, ymin double precision, xmax double precision, ymax double precision,
  area_km2 double precision, last_checked_at timestamptz, window_from timestamptz, window_to timestamptz)
LANGUAGE sql
STABLE
AS $function$
  WITH last AS (
    SELECT DISTINCT ON (c.aoi_id) c.aoi_id, c.checked_at, c.window_to
      FROM public.imagery_aoi_checks c
     WHERE c.sensor = p_sensor AND c.error IS NULL
     ORDER BY c.aoi_id, c.checked_at DESC)
  SELECT a.aoi_id, a.kind, a.name, ST_AsGeoJSON(a.geom, 7),
         ST_XMin(a.geom), ST_YMin(a.geom), ST_XMax(a.geom), ST_YMax(a.geom), a.area_km2, l.checked_at,
         greatest(coalesce(l.window_to - interval '5 days', now() - interval '30 days'), now() - interval '30 days'),
         now()
    FROM public.imagery_aois a
    LEFT JOIN last l ON l.aoi_id = a.aoi_id
   WHERE a.retired_at IS NULL AND p_sensor = ANY (a.sensors_enabled)
     AND (l.checked_at IS NULL OR l.checked_at < now() - make_interval(hours => greatest(p_min_age_hours, 1)))
   ORDER BY a.priority DESC, l.checked_at ASC NULLS FIRST, a.aoi_id
   LIMIT greatest(least(p_limit, 200), 1)
$function$;

-- ─── 4 · The study ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.imagery_s1_study(p_days integer DEFAULT 60, p_max_gap_minutes integer DEFAULT 30)
RETURNS TABLE (
  aoi_id text, pairs integer, spearman_rho double precision,
  s1_share_w1 double precision, s1_share_w2 double precision,
  ais_share_w1 double precision, ais_share_w2 double precision,
  share_drift double precision, rho_ok boolean, share_ok boolean, admitted boolean)
LANGUAGE sql
STABLE
AS $function$
  WITH w AS (
    SELECT now() - make_interval(days => p_days) AS w_from, now() - make_interval(days => p_days / 2) AS w_mid
  ), s1 AS (      -- clear S1 looks in the window
    SELECT o.aoi_id, o.acquired_at, o.metric_value AS s1
      FROM public.imagery_observations o, w
     WHERE o.sensor = 's1_grd' AND o.metric_name = 'bright_target_area_m2'
       AND o.coverage_state = 'clear' AND o.metric_value IS NOT NULL
       AND o.acquired_at >= w.w_from
  ), paired AS (  -- nearest non-VOID AIS sample within ±gap
    SELECT s1.aoi_id, s1.acquired_at, s1.s1, a.vessels_fresh::double precision AS ais
      FROM s1
      CROSS JOIN LATERAL (
        SELECT c.vessels_fresh FROM public.ais_aoi_counts c
         WHERE c.aoi_id = s1.aoi_id AND c.vessels_fresh IS NOT NULL
           AND c.sampled_at BETWEEN s1.acquired_at - make_interval(mins => p_max_gap_minutes)
                                AND s1.acquired_at + make_interval(mins => p_max_gap_minutes)
         ORDER BY abs(extract(epoch FROM (c.sampled_at - s1.acquired_at))) LIMIT 1) a
  ), ranked AS (  -- average ranks (ties share the mean rank) → Pearson on ranks = Spearman
    SELECT p.*,
           rank() OVER (PARTITION BY p.aoi_id ORDER BY p.s1)
             + (count(*) OVER (PARTITION BY p.aoi_id, p.s1) - 1) / 2.0 AS r_s1,
           rank() OVER (PARTITION BY p.aoi_id ORDER BY p.ais)
             + (count(*) OVER (PARTITION BY p.aoi_id, p.ais) - 1) / 2.0 AS r_ais
      FROM paired p
  ), per_aoi AS (
    SELECT r.aoi_id, count(*)::integer AS n, corr(r.r_s1, r.r_ais) AS rho,
           sum(r.s1)  FILTER (WHERE r.acquired_at <  (SELECT w_mid FROM w)) AS s1_w1,
           sum(r.s1)  FILTER (WHERE r.acquired_at >= (SELECT w_mid FROM w)) AS s1_w2,
           sum(r.ais) FILTER (WHERE r.acquired_at <  (SELECT w_mid FROM w)) AS ais_w1,
           sum(r.ais) FILTER (WHERE r.acquired_at >= (SELECT w_mid FROM w)) AS ais_w2
      FROM ranked r GROUP BY r.aoi_id
  ), shares AS (  -- each AOI's share of the study set, per half-window
    SELECT a.*,
           a.s1_w1  / nullif(sum(a.s1_w1)  OVER (), 0) AS sh_s1_1,
           a.s1_w2  / nullif(sum(a.s1_w2)  OVER (), 0) AS sh_s1_2,
           a.ais_w1 / nullif(sum(a.ais_w1) OVER (), 0) AS sh_ais_1,
           a.ais_w2 / nullif(sum(a.ais_w2) OVER (), 0) AS sh_ais_2
      FROM per_aoi a
  )
  SELECT s.aoi_id, s.n, s.rho, s.sh_s1_1, s.sh_s1_2, s.sh_ais_1, s.sh_ais_2,
         ln(s.sh_s1_2 / s.sh_s1_1) - ln(s.sh_ais_2 / s.sh_ais_1),
         coalesce(s.n >= 10 AND s.rho >= 0.70, false),
         coalesce(abs(ln(s.sh_s1_2 / s.sh_s1_1) - ln(s.sh_ais_2 / s.sh_ais_1)) <= ln(1.5), false),
         coalesce(s.n >= 10 AND s.rho >= 0.70
                  AND abs(ln(s.sh_s1_2 / s.sh_s1_1) - ln(s.sh_ais_2 / s.sh_ais_1)) <= ln(1.5), false)
    FROM shares s
   ORDER BY s.aoi_id
$function$;

COMMENT ON FUNCTION public.imagery_s1_study(integer, integer) IS
  'IMG-3 (mig 185). Pairs each clear S1 bright-target-area look with the nearest non-VOID hourly AIS count (±30 min) and reports per anchorage: pairs, Spearman rho (average ranks), share of the study set per half-window and its drift vs AIS. Admission (build prompt §4.4): rho >= 0.70 on >= 10 pairs AND |share drift| <= ln 1.5. Any missing share or rho = not admitted.';

-- ─── 5 · Study set ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.imagery_enable_s1_study(p_n integer DEFAULT 10)
RETURNS TABLE (aoi_id text, median_hourly_vessels double precision, samples integer)
LANGUAGE sql
AS $function$
  WITH dens AS (
    SELECT c.aoi_id, percentile_cont(0.5) WITHIN GROUP (ORDER BY c.vessels_fresh) AS med, count(*)::integer AS n
      FROM public.ais_aoi_counts c
     WHERE c.sampled_at >= now() - interval '72 hours' AND c.vessels_fresh IS NOT NULL
     GROUP BY c.aoi_id
    HAVING count(*) >= 48
  ), pick AS (
    SELECT d.* FROM dens d
      JOIN public.imagery_aois a ON a.aoi_id = d.aoi_id
     WHERE a.kind = 'anchorage' AND a.retired_at IS NULL AND d.med > 0
     ORDER BY d.med DESC, d.aoi_id
     LIMIT greatest(least(p_n, 20), 1)
  ), upd AS (
    UPDATE public.imagery_aois a
       SET sensors_enabled = ARRAY(SELECT DISTINCT unnest(a.sensors_enabled || ARRAY['s1_grd'])),
           priority = greatest(a.priority, 2), updated_at = now()
      FROM pick p WHERE a.aoi_id = p.aoi_id
    RETURNING a.aoi_id)
  SELECT p.aoi_id, p.med, p.n FROM pick p JOIN upd u ON u.aoi_id = p.aoi_id ORDER BY p.med DESC
$function$;

COMMENT ON FUNCTION public.imagery_enable_s1_study(integer) IS
  'IMG-3 (mig 185). Switch s1_grd on for the n (≤ 20) anchorages with the densest AIS: median hourly count over 72 h, ≥ 48 non-VOID samples, median > 0. Called by hand after three days of hourly counts.';

-- ─── 6 · Access ────────────────────────────────────────────────────────
ALTER TABLE public.imagery_anchorage_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ais_aoi_counts          ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.imagery_anchorage_stats, public.ais_aoi_counts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.imagery_anchorage_stats TO service_role;
GRANT SELECT, INSERT, DELETE ON public.ais_aoi_counts TO service_role;

REVOKE EXECUTE ON FUNCTION public.imagery_derive_anchorages(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.imagery_sample_ais_counts()                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.imagery_upsert_obs(text, jsonb)            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.imagery_sensor_due(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.imagery_s1_study(integer, integer)         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.imagery_enable_s1_study(integer)           FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.imagery_derive_anchorages(integer, integer) TO service_role;
GRANT  EXECUTE ON FUNCTION public.imagery_sample_ais_counts()                TO service_role;
GRANT  EXECUTE ON FUNCTION public.imagery_upsert_obs(text, jsonb)            TO service_role;
GRANT  EXECUTE ON FUNCTION public.imagery_sensor_due(text, integer, integer) TO service_role;
GRANT  EXECUTE ON FUNCTION public.imagery_s1_study(integer, integer)         TO service_role;
GRANT  EXECUTE ON FUNCTION public.imagery_enable_s1_study(integer)           TO service_role;

-- ─── 7 · Schedule (unschedule-if-exists, then schedule) ────────────────
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'imagery-ais-aoi-counts';
SELECT cron.schedule('imagery-ais-aoi-counts', '7 * * * *',
                     $job$ SELECT public.imagery_sample_ais_counts() $job$);

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════
-- VERIFY — read-only. Paste these rows back.
-- ═══════════════════════════════════════════════════════════════════════
-- V1 · the job is scheduled — expect one row, active
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'imagery-ais-aoi-counts';
-- V2 · nothing is derived or switched on by this migration — expect 0 | 0 | 0
SELECT (SELECT count(*) FROM public.imagery_aois WHERE kind = 'anchorage')                        AS anchorage_aois,
       (SELECT count(*) FROM public.imagery_aois WHERE 's1_grd' = ANY (sensors_enabled))            AS s1_enabled,
       (SELECT count(*) FROM public.ais_aoi_counts)                                                 AS ais_count_rows;
