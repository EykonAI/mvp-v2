-- ═══════════════════════════════════════════════════════════════
-- 015 — power_plants table (Global Energy Monitor — GIPT)
--
-- Backs the infrastructure.power-plants sub-layer with unit-level data
-- from the Global Integrated Power Tracker. The unit grain matters: a
-- single plant with N reactors / turbines / panels lands as N rows that
-- share lat/lon and plant_name but each carry their own unit_name and
-- capacity_mw.
--
-- Populated by /api/cron/ingest-gem-power, which fetches the operator-
-- supplied CSV (GEM has no public API — quarterly bulk download only).
--
-- Idempotent — safe to re-run.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS power_plants (
  id                  TEXT PRIMARY KEY,             -- GEM unit/phase ID, e.g. G100000104857
  plant_name          TEXT NOT NULL,                 -- "Plant / Project name"
  unit_name           TEXT,                          -- "Unit / Phase name"
  fuel_type           TEXT,                          -- bioenergy | coal | oil/gas | utility-scale solar | wind | hydropower | nuclear | geothermal
  technology          TEXT,
  capacity_mw         NUMERIC,
  status              TEXT,                          -- operating | retired | construction | pre-construction | announced | cancelled | shelved | mothballed
  start_year          INTEGER,
  retired_year        INTEGER,
  country             TEXT,
  region              TEXT,
  subregion           TEXT,
  city                TEXT,
  subnational_unit    TEXT,
  owner               TEXT,
  operator            TEXT,
  parent              TEXT,
  gem_location_id     TEXT,                          -- Plant-level group id (multi-unit plants share this)
  gem_wiki_url        TEXT,
  latitude            DOUBLE PRECISION NOT NULL,
  longitude           DOUBLE PRECISION NOT NULL,
  geom                GEOGRAPHY(Point, 4326),
  ingested_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_power_plants_geom     ON power_plants USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_power_plants_status   ON power_plants (status);
CREATE INDEX IF NOT EXISTS idx_power_plants_fuel     ON power_plants (fuel_type);
CREATE INDEX IF NOT EXISTS idx_power_plants_country  ON power_plants (country);
CREATE INDEX IF NOT EXISTS idx_power_plants_location ON power_plants (gem_location_id);
-- Read pattern: "operating plants worth showing on a regional zoom".
CREATE INDEX IF NOT EXISTS idx_power_plants_significant
  ON power_plants (status, capacity_mw)
  WHERE status = 'operating';
