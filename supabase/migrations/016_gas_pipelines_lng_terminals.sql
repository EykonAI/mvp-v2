-- ═══════════════════════════════════════════════════════════════
-- 016 — gas_pipelines + lng_terminals tables (GEM GGIT)
--
-- Two distinct geometry shapes from the same provider:
--  - gas_pipelines  : LineString / MultiLineString routes (4,246 features
--                     in the Nov 2025 release, 3,534 with usable geometry)
--  - lng_terminals  : Point locations (1,198 features in the Sep 2025 release)
--
-- We avoid PostGIS for spatial indexing on pipelines and instead store
-- a precomputed bounding box (bbox_*) per route — bbox-overlap filtering
-- with B-tree indexes is sufficient at viewport granularity and dodges
-- the PostGIS GEOMETRY column complications around insert/select via the
-- JS client. The full route is stored as raw GeoJSON in `route_geojson`
-- and shipped to MapView as-is for PathLayer rendering.
--
-- LNG terminals stay on the existing GEOGRAPHY(Point, 4326) pattern —
-- same shape as airports / ports / power_plants.
--
-- Idempotent — safe to re-run.
-- ═══════════════════════════════════════════════════════════════

-- ─── Gas pipelines (GGIT routes) ───────────────────────────────
CREATE TABLE IF NOT EXISTS gas_pipelines (
  id              TEXT PRIMARY KEY,             -- ProjectID, e.g. P0061
  pipeline_name   TEXT NOT NULL,
  segment_name   TEXT,
  wiki_url        TEXT,
  status          TEXT,                          -- operating | proposed | construction | cancelled | shelved | retired | mothballed | idle
  fuel            TEXT,                          -- Gas | Hydrogen | Gas and Hydrogen
  countries       TEXT,                          -- "Russia; Belarus; Poland; Germany"
  owner           TEXT,
  parent          TEXT,
  start_year      INTEGER,
  capacity_bcm_y  NUMERIC,                       -- normalised capacity, billion cubic metres / year
  length_km       NUMERIC,                       -- LengthMergedKm
  diameter        TEXT,                          -- "30, 42" — kept as text since multi-valued
  diameter_units  TEXT,
  fuel_source     TEXT,
  start_country   TEXT,
  end_country     TEXT,
  route_accuracy  TEXT,                          -- low | medium | high | no route
  bbox_lat_min    DOUBLE PRECISION,
  bbox_lat_max    DOUBLE PRECISION,
  bbox_lon_min    DOUBLE PRECISION,
  bbox_lon_max    DOUBLE PRECISION,
  route_geojson   JSONB,                         -- GeoJSON geometry (LineString or MultiLineString)
  ingested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gas_pipelines_status   ON gas_pipelines (status);
CREATE INDEX IF NOT EXISTS idx_gas_pipelines_fuel     ON gas_pipelines (fuel);
CREATE INDEX IF NOT EXISTS idx_gas_pipelines_country  ON gas_pipelines (start_country);
-- Two-column B-tree indexes for bbox-overlap queries.
CREATE INDEX IF NOT EXISTS idx_gas_pipelines_bbox_lat ON gas_pipelines (bbox_lat_min, bbox_lat_max);
CREATE INDEX IF NOT EXISTS idx_gas_pipelines_bbox_lon ON gas_pipelines (bbox_lon_min, bbox_lon_max);

-- ─── LNG terminals (GGIT terminals — Point geometry) ───────────
CREATE TABLE IF NOT EXISTS lng_terminals (
  id              TEXT PRIMARY KEY,             -- UnitID, e.g. G100002027401
  project_id      TEXT,                          -- ProjectID, e.g. T100000130274
  terminal_name   TEXT NOT NULL,
  unit_name       TEXT,
  wiki_url        TEXT,
  facility_type   TEXT,                          -- import | export
  fuel            TEXT,                          -- LNG | NH3 | LH2 | eLNG
  status          TEXT,                          -- operating | proposed | construction | cancelled | shelved | retired | mothballed | idled
  country         TEXT,
  region          TEXT,
  subregion       TEXT,
  capacity_mtpa   NUMERIC,
  capacity_bcm_y  NUMERIC,
  owner           TEXT,
  parent          TEXT,
  operator        TEXT,
  start_year      INTEGER,
  offshore        BOOLEAN,
  floating        BOOLEAN,
  latitude        DOUBLE PRECISION NOT NULL,
  longitude       DOUBLE PRECISION NOT NULL,
  geom            GEOGRAPHY(Point, 4326),
  ingested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lng_terminals_geom    ON lng_terminals USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_lng_terminals_status  ON lng_terminals (status);
CREATE INDEX IF NOT EXISTS idx_lng_terminals_country ON lng_terminals (country);
CREATE INDEX IF NOT EXISTS idx_lng_terminals_facility ON lng_terminals (facility_type);
