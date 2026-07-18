-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 083 · FIRMS rollup performance + correctness
--
-- FOUND WHILE VERIFYING THE FIRST REAL INGEST (2026-07-18).
-- 11,421 detections and 18 successful ingest runs landed, but
-- firms_facility_observations showed detection_count > 0 on ZERO
-- facilities — while a direct query proved detections sitting
-- 0.03-0.27 km from Plock, Antwerp, Rotterdam, Bahrain, Bandar Abbas
-- and Lavan refineries (gas flares and genuine thermal signatures).
--
-- Root cause: firms_derive_facility_observations joined
--   monitored (13,262 rows)  LEFT JOIN  firms_thermal_anomalies
-- with ST_DWithin(m.geom::geography, f.geom::geography, ...). The
-- per-row cast to geography prevents the GIST indexes on geom (a
-- geometry column) from being used, so the plan degrades toward a
-- cross product — 13,262 x 11,421 — and the statement times out.
-- The rollup therefore never completed after detections arrived.
--
-- Two fixes:
--
-- 1 · Functional GIST indexes on the geography cast, which is what
--     the predicate actually needs. ST_DWithin(geography) is then
--     index-accelerated.
--
-- 2 · Restructure the RPC so the spatial join runs ONLY over the
--     target day's detections against indexed facilities (a few
--     thousand rows), producing a small hits set that is then LEFT
--     JOINed back onto the monitored list. The previous shape paid
--     the spatial cost once per facility including the ~99% with no
--     detections at all; this pays it once per detection.
--
--     The zero-detection rows are still written — that property is
--     load-bearing (a covered day with no fire must be recorded as
--     an observation, not left absent) — they are just no longer
--     computed via an expensive per-facility scan.
--
-- Idempotent and additive. Apply MANUALLY in the Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1 · Functional geography indexes ──────────────────────────
-- These are what ST_DWithin(::geography, ::geography, metres) can use.
-- The plain geometry GIST indexes from 081/082 stay — they serve
-- bbox/geometry-space queries elsewhere.
CREATE INDEX IF NOT EXISTS refineries_geog_idx
  ON refineries USING GIST ((geom::geography));

CREATE INDEX IF NOT EXISTS power_plants_geog_idx
  ON power_plants USING GIST ((geom::geography));

CREATE INDEX IF NOT EXISTS firms_anom_geog_idx
  ON firms_thermal_anomalies USING GIST ((geom::geography));

-- Supports the per-day detection filter that now drives the join.
CREATE INDEX IF NOT EXISTS firms_anom_day_geom_idx
  ON firms_thermal_anomalies (acq_date) INCLUDE (frp);

ANALYZE refineries;
ANALYZE power_plants;
ANALYZE firms_thermal_anomalies;

-- ─── 2 · Detection-driven rollup ───────────────────────────────
CREATE OR REPLACE FUNCTION firms_derive_facility_observations(
  p_day       date,
  p_radius_km numeric DEFAULT 5,
  p_min_mw    numeric DEFAULT 500
) RETURNS int AS $$
DECLARE
  v_rows int;
BEGIN
  WITH monitored AS (
    SELECT 'refinery'::text AS facility_type,
           r.id::text       AS facility_id,
           r.refinery_name  AS facility_name,
           r.country,
           r.geom
      FROM refineries r
     WHERE r.geom IS NOT NULL
    UNION ALL
    SELECT 'power_plant'::text,
           p.id::text,
           p.plant_name,
           p.country,
           p.geom
      FROM power_plants p
     WHERE p.geom IS NOT NULL
       AND p.capacity_mw >= p_min_mw
  ),
  day_detections AS (
    -- Narrow to the target day FIRST; this is the small side.
    SELECT f.id, f.frp, f.geom
      FROM firms_thermal_anomalies f
     WHERE f.acq_date = p_day
       AND f.geom IS NOT NULL
  ),
  hits AS (
    -- Spatial join driven by detections, index-accelerated on the
    -- facility side via the functional geography indexes above.
    SELECT m.facility_type,
           m.facility_id,
           COUNT(*)                                                        AS detection_count,
           MAX(d.frp)                                                      AS max_frp,
           MIN(ST_Distance(m.geom::geography, d.geom::geography)) / 1000.0 AS nearest_km
      FROM day_detections d
      JOIN monitored m
        ON ST_DWithin(m.geom::geography, d.geom::geography, p_radius_km * 1000)
     GROUP BY 1, 2
  )
  INSERT INTO firms_facility_observations (
    facility_type, facility_id, facility_name, country,
    period, detection_count, max_frp, nearest_km, radius_km, computed_at
  )
  SELECT m.facility_type,
         m.facility_id,
         m.facility_name,
         m.country,
         p_day,
         COALESCE(h.detection_count, 0),
         h.max_frp,
         h.nearest_km,
         p_radius_km,
         now()
    FROM monitored m
    LEFT JOIN hits h
      ON h.facility_type = m.facility_type
     AND h.facility_id   = m.facility_id
  ON CONFLICT (facility_type, facility_id, period) DO UPDATE
    SET detection_count = EXCLUDED.detection_count,
        max_frp         = EXCLUDED.max_frp,
        nearest_km      = EXCLUDED.nearest_km,
        radius_km       = EXCLUDED.radius_km,
        computed_at     = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$ LANGUAGE plpgsql;
