-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 082 · Infrastructure geom backfill + FIRMS monitored-set fix
--
-- FOUND WHILE VERIFYING 081 (2026-07-18). Two defects, both silent:
--
-- 1 · geom is NULL on EVERY row of refineries (0/634), power_plants
--     (0/182,417) and ports (0/3,803). latitude/longitude are fully
--     populated on all three — only the derived geometry column was
--     never computed. conflict_events has the auto-geom trigger and
--     366k populated rows; the infrastructure tables never got it.
--
--     Impact well beyond FIRMS: ANY PostGIS query against these tables
--     (ST_DWithin, ST_Distance, bbox filters) silently returns nothing
--     rather than erroring. This is the "code shipped, data never
--     arrived" failure mode with a spatial index on top.
--
-- 2 · firms_derive_facility_observations required capacity_bpd IS NOT
--     NULL for refineries — but only 1 of 634 rows has that column set.
--     Combined with (1), the monitored set was EMPTY: the FIRMS rollup
--     would have run "successfully" forever and written zero rows.
--
-- Fixes: backfill geom from lat/lon on all three tables, add the same
-- BEFORE INSERT/UPDATE trigger the other geospatial tables use so new
-- rows stay correct, add GIST indexes, and redefine the FIRMS RPC to
-- monitor all located refineries (capacity is metadata, not a
-- prerequisite for watching a site) plus power plants above the floor.
--
-- Idempotent and additive. Apply MANUALLY in the Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1 · Shared geom trigger for lat/lon infrastructure tables ──
CREATE OR REPLACE FUNCTION infra_set_geom() RETURNS trigger AS $$
BEGIN
  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    NEW.geom := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS refineries_set_geom_trg ON refineries;
CREATE TRIGGER refineries_set_geom_trg
  BEFORE INSERT OR UPDATE ON refineries
  FOR EACH ROW EXECUTE FUNCTION infra_set_geom();

DROP TRIGGER IF EXISTS power_plants_set_geom_trg ON power_plants;
CREATE TRIGGER power_plants_set_geom_trg
  BEFORE INSERT OR UPDATE ON power_plants
  FOR EACH ROW EXECUTE FUNCTION infra_set_geom();

DROP TRIGGER IF EXISTS ports_set_geom_trg ON ports;
CREATE TRIGGER ports_set_geom_trg
  BEFORE INSERT OR UPDATE ON ports
  FOR EACH ROW EXECUTE FUNCTION infra_set_geom();

-- ─── 2 · Backfill existing rows ────────────────────────────────
-- Only touches rows that are missing geom but have coordinates, so
-- re-running is a no-op.
UPDATE refineries
   SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
 WHERE geom IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL;

UPDATE power_plants
   SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
 WHERE geom IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL;

UPDATE ports
   SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
 WHERE geom IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL;

-- ─── 3 · Spatial indexes ───────────────────────────────────────
CREATE INDEX IF NOT EXISTS refineries_geom_idx   ON refineries   USING GIST (geom);
CREATE INDEX IF NOT EXISTS power_plants_geom_idx ON power_plants USING GIST (geom);
CREATE INDEX IF NOT EXISTS ports_geom_idx        ON ports        USING GIST (geom);

-- ─── 4 · Redefine the FIRMS monitored set ──────────────────────
-- Change vs 081: refineries no longer require capacity_bpd. A refinery
-- with coordinates is watchable; capacity is descriptive metadata that
-- happens to be absent on 633 of 634 rows. Power plants keep the MW
-- floor, which is a genuine relevance filter (12,628 rows at >= 500MW).
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
  hits AS (
    SELECT m.facility_type,
           m.facility_id,
           m.facility_name,
           m.country,
           COUNT(f.id)                                                     AS detection_count,
           MAX(f.frp)                                                      AS max_frp,
           MIN(ST_Distance(m.geom::geography, f.geom::geography)) / 1000.0 AS nearest_km
      FROM monitored m
      LEFT JOIN firms_thermal_anomalies f
        ON f.acq_date = p_day
       AND f.geom IS NOT NULL
       AND ST_DWithin(m.geom::geography, f.geom::geography, p_radius_km * 1000)
     GROUP BY 1, 2, 3, 4
  )
  INSERT INTO firms_facility_observations (
    facility_type, facility_id, facility_name, country,
    period, detection_count, max_frp, nearest_km, radius_km, computed_at
  )
  SELECT facility_type, facility_id, facility_name, country,
         p_day, detection_count, max_frp, nearest_km, p_radius_km, now()
    FROM hits
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
