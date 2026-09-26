-- ═══════════════════════════════════════════════════════════════════════
-- eYKON.ai — 186 · Anchorage derivation without a temp-file spill
--             (Imagery Layer IMG-3 follow-up). Requires 185.
--
-- WHY — READ ONLY, 2026-09-26, BEFORE THE FIRST DERIVATION WAS RUN
-- 185's imagery_derive_anchorages() counted distinct vessels per cell with
-- count(DISTINCT mmsi) inside a GROUP BY. Postgres can only do that by
-- SORTING the whole input, and production's history is far bigger than 185
-- assumed: ais_position_history holds 3.37 M rows over 7 days (2.5 M
-- stationary; ~18 k rows an hour), not the ~344 k that "2,048 profiled
-- vessels hourly" implies. EXPLAIN (nothing executed) showed a Sort of
-- ~2.26 M rows; temp_file_limit is -1 (unlimited). That is the 2026-09-18
-- incident's shape — a read that spills until the disk is full (brief
-- §16.13) — so the derivation was never run.
--
-- WHAT CHANGES
--   · The cell aggregation moves into imagery_stationary_cells(from, to): a
--     STABLE single-SELECT SQL function the planner INLINES, so EXPLAIN of a
--     call shows its real plan — img3b_guards.sql asserts on it.
--   · Two-step HASH aggregation: first per (cell, vessel), then per cell.
--     No count(DISTINCT), no Sort. distinct_vessels becomes EXACT (it was an
--     upper bound in 185).
--   · The window is capped at 3 days (default 3) and work_mem is 128 MB for
--     the call. EXPLAIN on production at 3 days / 128 MB: HashAggregate →
--     HashAggregate → Index Scan on idx_ais_history_recorded, no planned
--     partitions (i.e. no expected spill).
--   · 185's header called the anchorages tanker-biased because the history
--     held only the profiled fleet. At ~18 k rows an hour that no longer
--     describes the table; which vessels it samples is not asserted here.
--
-- APPLY: after 185, manually, whole file, BEFORE merge. Then
-- supabase/tests/img3b_guards.sql — ONE result row. Replayed under PGlite
-- 0.5.8 + PostGIS 3.6 before hand-off.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.imagery_derive_anchorages(integer,integer)') IS NULL THEN
    RAISE EXCEPTION '186 requires 185 (Sentinel-1 study) — apply 185 first';
  END IF;
END $$;

-- ─── 1 · The cell aggregation (inlinable: STABLE, one SELECT, no SET) ──
CREATE OR REPLACE FUNCTION public.imagery_stationary_cells(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (cy integer, cx integer, vessel_hours integer, distinct_vessels integer)
LANGUAGE sql
STABLE
AS $function$
  SELECT v.cy, v.cx, sum(v.n)::integer, count(*)::integer
    FROM (SELECT floor(h.latitude  / 0.02)::integer AS cy,
                 floor(h.longitude / 0.02)::integer AS cx,
                 h.mmsi,
                 count(*) AS n
            FROM public.ais_position_history h
           WHERE h.recorded_at >= p_from AND h.recorded_at < p_to
             AND h.speed IS NOT NULL AND h.speed < 0.5
             AND h.latitude IS NOT NULL AND h.longitude IS NOT NULL
           GROUP BY 1, 2, 3) v
   GROUP BY v.cy, v.cx
$function$;

COMMENT ON FUNCTION public.imagery_stationary_cells(timestamptz, timestamptz) IS
  'IMG-3 (mig 186). Stationary (< 0.5 kn) AIS samples binned to 0.02° cells: vessel-hours and EXACT distinct vessels per cell, by two hash aggregations — no count(DISTINCT), no sort. Inlined by the planner, so EXPLAIN of a call shows the real plan (img3b_guards.sql checks it).';

-- ─── 2 · The derivation, rebuilt on it ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.imagery_derive_anchorages(
  p_days integer DEFAULT 3,
  p_min_vessel_hours integer DEFAULT 24)
RETURNS TABLE (aoi_id text, port_id text, port_name text, cells integer, vessel_hours integer,
               distinct_vessels integer, area_km2 double precision, inserted boolean)
LANGUAGE plpgsql
AS $function$
-- the RETURNS TABLE names (aoi_id, port_id, …) are also column names below
#variable_conflict use_column
DECLARE
  -- mig 186: at most 3 days (3.37 M history rows / 7 days on 2026-09-26)
  v_from timestamptz := now() - make_interval(days => least(greatest(p_days, 1), 3));
  v_to   timestamptz := now();
  c_cell constant double precision := 0.02;
BEGIN
  SET LOCAL statement_timeout = '120s';
  SET LOCAL work_mem = '128MB';

  RETURN QUERY
  WITH cells AS (
    SELECT s.cy, s.cx, s.vessel_hours AS vh, s.distinct_vessels AS dv
      FROM public.imagery_stationary_cells(v_from, v_to) s
  ), located AS (
    SELECT c.*, p.id AS pid, p.port_name AS pname,
           ST_MakeEnvelope(c.cx * c_cell, c.cy * c_cell, (c.cx + 1) * c_cell, (c.cy + 1) * c_cell, 4326) AS cell_geom
      FROM cells c
      CROSS JOIN LATERAL (
        SELECT pt.id, pt.port_name, pt.geom
          FROM public.ports pt
         WHERE pt.harbor_size IN ('Large','Medium') AND pt.geom IS NOT NULL
           AND ST_DWithin(pt.geom, ST_SetSRID(ST_MakePoint((c.cx + 0.5) * c_cell, (c.cy + 0.5) * c_cell), 4326)::geography, 30000)
         ORDER BY pt.geom <-> ST_SetSRID(ST_MakePoint((c.cx + 0.5) * c_cell, (c.cy + 0.5) * c_cell), 4326)::geography
         LIMIT 1) p
     WHERE NOT ST_DWithin(p.geom, ST_SetSRID(ST_MakePoint((c.cx + 0.5) * c_cell, (c.cy + 0.5) * c_cell), 4326)::geography, 3000)
  ), per_port AS (
    SELECT l.pid, min(l.pname) AS pname, count(*)::integer AS ncells,
           sum(l.vh)::integer AS vh,
           -- summed per cell: a vessel seen in two cells counts twice, so this
           -- stays an upper bound at PORT level (exact per cell)
           sum(l.dv)::integer AS dv_upper,
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
  'IMG-3 (mig 186). One anchorage AOI per Large/Medium port from stationary AIS 3–30 km out, over at most 3 days, via imagery_stationary_cells() (two hash aggregations, work_mem 128 MB, 120 s timeout — no sort, no expected spill). Existing anchorages are never moved. distinct_vessels is exact per cell and an upper bound per port.';

REVOKE EXECUTE ON FUNCTION public.imagery_stationary_cells(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.imagery_derive_anchorages(integer, integer)        FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.imagery_stationary_cells(timestamptz, timestamptz) TO service_role;
GRANT  EXECUTE ON FUNCTION public.imagery_derive_anchorages(integer, integer)        TO service_role;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════
-- VERIFY — read-only (EXPLAIN executes nothing). Paste these rows back.
-- Expect: HashAggregate lines, NO "Sort" line, NO "Planned Partitions" line.
-- ═══════════════════════════════════════════════════════════════════════
BEGIN;
SET LOCAL work_mem = '128MB';
EXPLAIN SELECT * FROM public.imagery_stationary_cells(now() - interval '3 days', now());
ROLLBACK;
