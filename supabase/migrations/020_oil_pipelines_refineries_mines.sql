-- ═══════════════════════════════════════════════════════════════
-- 020 — oil_pipelines + refineries + mines tables
--
-- Three new infrastructure feeds backing the long-stubbed
-- /api/infrastructure → 25-hardcoded-rows fallback. Each table mirrors
-- the established 016 (gas_pipelines / lng_terminals) and 015
-- (power_plants) shapes:
--   - oil_pipelines  : LineString / MultiLineString routes (GEM GOIT,
--                      ~1,800 features, ~1,400 with usable geometry —
--                      same downsample + bbox + JSONB pattern as
--                      gas_pipelines).
--   - refineries     : Point locations (OSM Overpass — `man_made=works`
--                      with `product=oil` or `industrial=oil_refinery`,
--                      ~1,000-1,500 globally, free no-key feed).
--   - mines          : Point locations (USGS MRDS — frozen since 2011,
--                      304k records globally, public domain).
--
-- Idempotent — safe to re-run.
-- ═══════════════════════════════════════════════════════════════

-- ─── Oil pipelines (GOIT routes) ───────────────────────────────
-- Same shape as gas_pipelines (016) — only fuel + capacity unit differ
-- (oil/NGL in barrels-of-oil-equivalent / day vs gas in bcm/year).
CREATE TABLE IF NOT EXISTS oil_pipelines (
  id              TEXT PRIMARY KEY,             -- ProjectID, e.g. P0001
  pipeline_name   TEXT NOT NULL,
  segment_name    TEXT,
  wiki_url        TEXT,
  status          TEXT,                          -- operating | proposed | construction | cancelled | shelved | retired | mothballed | idle
  fuel            TEXT,                          -- Oil | NGL | Crude oil | Refined products
  countries       TEXT,                          -- "Canada, United States"
  owner           TEXT,
  parent          TEXT,
  start_year      INTEGER,
  capacity_boed   NUMERIC,                       -- normalised barrels of oil equivalent / day
  capacity_raw    TEXT,                          -- e.g. "450,000.00" — unit varies (bpd, mtpa, m3/d)
  capacity_units  TEXT,                          -- bpd | bbl/day | mtpa | m3/d
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

CREATE INDEX IF NOT EXISTS idx_oil_pipelines_status   ON oil_pipelines (status);
CREATE INDEX IF NOT EXISTS idx_oil_pipelines_fuel     ON oil_pipelines (fuel);
CREATE INDEX IF NOT EXISTS idx_oil_pipelines_country  ON oil_pipelines (start_country);
CREATE INDEX IF NOT EXISTS idx_oil_pipelines_bbox_lat ON oil_pipelines (bbox_lat_min, bbox_lat_max);
CREATE INDEX IF NOT EXISTS idx_oil_pipelines_bbox_lon ON oil_pipelines (bbox_lon_min, bbox_lon_max);

-- ─── Refineries (OSM Overpass — Point geometry) ─────────────────
-- OSM IDs are signed bigints — we keep them as TEXT and prefix with
-- the OSM element type ('node:'|'way:'|'relation:') to namespace
-- across element types. Centroid lat/lon for ways/relations.
CREATE TABLE IF NOT EXISTS refineries (
  id              TEXT PRIMARY KEY,             -- e.g. "way:23484321"
  osm_type        TEXT NOT NULL,                 -- node | way | relation
  osm_id          BIGINT NOT NULL,
  refinery_name   TEXT,                          -- name / name:en / operator (best-effort)
  operator        TEXT,
  owner           TEXT,
  product         TEXT,                          -- oil | refined_petroleum | …
  capacity_bpd    NUMERIC,                       -- when capacity:capacity_bpd / capacity tag is set
  start_date      TEXT,                          -- OSM start_date — keep raw (often partial dates)
  country         TEXT,                          -- addr:country / nominal country (resolved at ingest)
  iso_country     TEXT,                          -- ISO 3166-1 alpha-2 when resolvable
  city            TEXT,                          -- addr:city
  wiki_url        TEXT,                          -- wikidata / wikipedia
  source_tags     JSONB,                         -- raw OSM tags for forensic / future enrichment
  latitude        DOUBLE PRECISION NOT NULL,
  longitude       DOUBLE PRECISION NOT NULL,
  geom            GEOGRAPHY(Point, 4326),
  ingested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refineries_geom    ON refineries USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_refineries_country ON refineries (iso_country);
CREATE INDEX IF NOT EXISTS idx_refineries_product ON refineries (product);

-- ─── Mines (USGS MRDS — Point geometry, 304k global records) ────
-- MRDS is frozen at 2011 — fine for a v1 layer since most large
-- deposits haven't moved. Future swap-in candidates: USGS USMIN
-- (US-only, current) or Mindat (requires contributor status).
CREATE TABLE IF NOT EXISTS mines (
  id              TEXT PRIMARY KEY,             -- MRDS dep_id, e.g. "10000001"
  site_name       TEXT,
  dev_stat        TEXT,                          -- Producer | Past Producer | Prospect | Occurrence | Plant | Unknown
  country         TEXT,                          -- "United States"
  iso_country     TEXT,                          -- ISO 3166-1 alpha-2
  state           TEXT,                          -- US state / province / equivalent
  county          TEXT,
  commod1         TEXT,                          -- primary commodity (Copper, Gold, Lithium, Rare Earths, …)
  commod2         TEXT,
  commod3         TEXT,
  commodities     TEXT[],                        -- denormalised array for `?commodity=…` filtering
  ore             TEXT,
  dep_type        TEXT,                          -- e.g. Porphyry, Vein, Placer
  url             TEXT,                          -- mrdata.usgs.gov record URL
  latitude        DOUBLE PRECISION NOT NULL,
  longitude       DOUBLE PRECISION NOT NULL,
  geom            GEOGRAPHY(Point, 4326),
  ingested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mines_geom        ON mines USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_mines_dev_stat    ON mines (dev_stat);
CREATE INDEX IF NOT EXISTS idx_mines_country     ON mines (iso_country);
CREATE INDEX IF NOT EXISTS idx_mines_commod1     ON mines (commod1);
CREATE INDEX IF NOT EXISTS idx_mines_commodities ON mines USING GIN (commodities);

-- ─── RLS — public read on all three (mirrors migration 019) ─────

ALTER TABLE oil_pipelines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read access" ON oil_pipelines;
CREATE POLICY "Public read access" ON oil_pipelines FOR SELECT USING (true);

ALTER TABLE refineries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read access" ON refineries;
CREATE POLICY "Public read access" ON refineries FOR SELECT USING (true);

ALTER TABLE mines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read access" ON mines;
CREATE POLICY "Public read access" ON mines FOR SELECT USING (true);
