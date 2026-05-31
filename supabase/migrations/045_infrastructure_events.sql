-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 045 · infrastructure_events (GDELT energy-infra stream)
--
-- A GDELT-derived EVENT stream layered over the static energy-infra
-- registries (refineries / gas_pipelines / mines / power_plants).
-- Populated every 15 min by /api/cron/ingest-gdelt-energy-events,
-- which reads the latest GDELT 2.0 GKG export, keeps only rows that
-- carry BOTH an energy/infra anchor theme (-> infrastructure_type)
-- AND a high-confidence incident theme (-> event_type), and upserts
-- them here keyed on the GKG record id.
--
-- Backs the InfrastructureEvents notification bucket (lib/
-- notifications/{tools,evaluator-ai}.ts) and the per-country energy
-- anomaly detector (PR 4, /api/cron/detect-anomalies-energy).
--
-- NOTE on country: GDELT emits FIPS 10-4 country codes (UP=Ukraine,
-- RS=Russia, TU=Turkey, IZ=Iraq), NOT ISO-2 — consistent with the
-- existing conflict_events.country. Downstream watchlists must be
-- FIPS-aware.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. Event table ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS infrastructure_events (
  id                   BIGSERIAL PRIMARY KEY,
  gkg_record_id        TEXT UNIQUE,                       -- GDELT GKGRECORDID; dedup key
  event_id             TEXT,                              -- reserved: GDELT Events join (null in GKG-only v1)
  event_type           TEXT NOT NULL,                     -- attack | accident | shutdown
  infrastructure_type  TEXT NOT NULL,                     -- pipeline | refinery | mine | power_plant | other
  country              TEXT,                              -- FIPS 10-4 (see header)
  latitude             DOUBLE PRECISION,
  longitude            DOUBLE PRECISION,
  severity             TEXT CHECK (severity IN ('low','medium','high')),
  tone                 NUMERIC(6,3),                      -- GDELT V2 average tone (negative = adverse)
  num_mentions         INTEGER,
  source_urls          TEXT[] DEFAULT ARRAY[]::TEXT[],
  themes               TEXT[] DEFAULT ARRAY[]::TEXT[],
  title                TEXT,
  geom                 GEOGRAPHY(POINT, 4326),
  ingested_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_infra_events_recency
  ON infrastructure_events (ingested_at DESC);
CREATE INDEX IF NOT EXISTS idx_infra_events_geom
  ON infrastructure_events USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_infra_events_type
  ON infrastructure_events (infrastructure_type, event_type);
CREATE INDEX IF NOT EXISTS idx_infra_events_country
  ON infrastructure_events (country);

-- ─── 2. RLS — public read (map/feed data, no auth) ────────────
ALTER TABLE infrastructure_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS infra_events_public_read ON infrastructure_events;
CREATE POLICY infra_events_public_read
  ON infrastructure_events
  FOR SELECT USING (true);

-- ─── 3. Auto-populate geom from lat/lon ───────────────────────
-- Reuses set_geom_from_latlon() (migration 001): the ingest cron
-- upserts latitude/longitude only and lets the trigger derive geom,
-- since a JS client can't build a geography literal inline.
DROP TRIGGER IF EXISTS auto_geom_infra_events ON infrastructure_events;
CREATE TRIGGER auto_geom_infra_events
  BEFORE INSERT OR UPDATE ON infrastructure_events
  FOR EACH ROW EXECUTE FUNCTION set_geom_from_latlon();
