-- ═══════════════════════════════════════════════════════════════
-- 013 — airports + ports tables (OurAirports + NGA World Port Index)
--
-- Static reference tables backing the infrastructure.airports and
-- infrastructure.ports sub-layers. Populated by the one-shot ingestion
-- routes:
--   /api/cron/ingest-ourairports — full OurAirports CSV (~67k rows)
--   /api/cron/ingest-wpi         — NGA WPI CSV/JSON (~3,700 rows)
--
-- Read pattern: bbox + type filter, served by /api/airports and /api/ports.
--
-- Idempotent — safe to re-run.
-- ═══════════════════════════════════════════════════════════════

-- ─── Airports (OurAirports) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS airports (
  id                TEXT PRIMARY KEY,            -- ourairports `id`
  ident             TEXT NOT NULL,                -- ICAO or local code
  type              TEXT NOT NULL,                -- large_airport | medium_airport | small_airport | heliport | seaplane_base | balloon_port | closed
  name              TEXT NOT NULL,
  latitude          DOUBLE PRECISION NOT NULL,
  longitude         DOUBLE PRECISION NOT NULL,
  elevation_ft      INTEGER,
  iso_country       CHAR(2),
  municipality      TEXT,
  scheduled_service BOOLEAN DEFAULT FALSE,
  iata_code         TEXT,
  icao_code         TEXT,
  geom              GEOGRAPHY(Point, 4326),
  ingested_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_airports_geom         ON airports USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_airports_type         ON airports (type);
CREATE INDEX IF NOT EXISTS idx_airports_iso_country  ON airports (iso_country);
CREATE INDEX IF NOT EXISTS idx_airports_iata         ON airports (iata_code) WHERE iata_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_airports_significant
  ON airports (type, scheduled_service)
  WHERE type IN ('large_airport', 'medium_airport');

-- ─── Ports (NGA World Port Index) ──────────────────────────────
CREATE TABLE IF NOT EXISTS ports (
  id              TEXT PRIMARY KEY,               -- WPI INDEX_NO / Pub150 PortNumber
  port_name       TEXT NOT NULL,
  country_code    CHAR(2),
  unlocode        TEXT,
  harbor_size     TEXT,                            -- L | M | S | V (Very Small)
  harbor_type     TEXT,                            -- Coastal Natural | River Natural | Lake | Open Roadstead | etc.
  shelter         TEXT,                            -- Excellent | Good | Fair | Poor | None
  channel_depth_m NUMERIC,
  repairs         TEXT,                            -- Major | Limited | Emergency Only | None
  latitude        DOUBLE PRECISION NOT NULL,
  longitude       DOUBLE PRECISION NOT NULL,
  geom            GEOGRAPHY(Point, 4326),
  ingested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ports_geom    ON ports USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_ports_country ON ports (country_code);
CREATE INDEX IF NOT EXISTS idx_ports_size    ON ports (harbor_size);
