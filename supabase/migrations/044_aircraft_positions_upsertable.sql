-- ═══════════════════════════════════════════════════════════════
-- 044 — aircraft_positions: enable upsert-by-icao24 for ADS-B ingest
--
-- The original aircraft_positions table (migration 001) was
-- append-only. The new services/adsb-ingest worker writes one row per
-- aircraft and refreshes it in place (mirroring how services/ais-ingest
-- + migration 012 made vessel_positions upsertable by mmsi), so we need
-- a UNIQUE constraint on icao24 to support ON CONFLICT (icao24) DO
-- UPDATE. The existing non-unique idx_aircraft_icao is then redundant
-- with the constraint's implicit unique index and is dropped.
--
-- geom is still maintained by the auto_geom_aircraft BEFORE INSERT OR
-- UPDATE trigger from migration 001 — the worker only writes lat/lon.
--
-- Idempotent — safe to re-run.
-- ═══════════════════════════════════════════════════════════════

-- Drop any duplicate icao24 rows that may have accumulated under the
-- old append model so the UNIQUE constraint can be added cleanly.
DELETE FROM aircraft_positions a
USING aircraft_positions b
WHERE a.id < b.id AND a.icao24 = b.icao24;

-- Unique constraint enables upsert-by-icao24.
ALTER TABLE aircraft_positions
  DROP CONSTRAINT IF EXISTS aircraft_positions_icao24_key;
ALTER TABLE aircraft_positions
  ADD CONSTRAINT aircraft_positions_icao24_key UNIQUE (icao24);

-- Redundant now that the UNIQUE constraint provides an icao24 index.
DROP INDEX IF EXISTS idx_aircraft_icao;
