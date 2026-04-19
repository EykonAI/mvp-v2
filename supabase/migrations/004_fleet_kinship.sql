-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 004 · Fleet Kinship Graph + Vessel Profiles
-- vessel_profiles (rolling score), fleet_kinship_edges (typed edges)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS vessel_profiles (
  mmsi TEXT PRIMARY KEY,
  name TEXT,
  imo TEXT,
  flag TEXT,
  dwt NUMERIC,
  built_year INT,
  operator_entity_id UUID REFERENCES entities(id),
  owner_entity_id UUID REFERENCES entities(id),
  composite_score NUMERIC(4,3),              -- 0..1 shadow-fleet likelihood
  indicators JSONB DEFAULT '{}'::jsonb,      -- {ais_gap,flag_hop,port_anomaly,cargo_mismatch,...}
  last_ais_at TIMESTAMPTZ,
  last_dark_at TIMESTAMPTZ,
  computed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vessel_profiles_score
  ON vessel_profiles (composite_score DESC);

ALTER TABLE vessel_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vessel_profiles_public_read ON vessel_profiles;
CREATE POLICY vessel_profiles_public_read ON vessel_profiles
  FOR SELECT USING (true);

-- ─── Fleet kinship edges ────────────────────────────────────
CREATE TABLE IF NOT EXISTS fleet_kinship_edges (
  id BIGSERIAL PRIMARY KEY,
  source_entity_id UUID NOT NULL,
  target_entity_id UUID NOT NULL,
  edge_type TEXT NOT NULL CHECK (edge_type IN
    ('vessel_operator','operator_owner','vessel_flag','operator_beneficial_owner','sibling_vessel')),
  weight NUMERIC(4,3) DEFAULT 1.0,
  source TEXT,
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kinship_source ON fleet_kinship_edges (source_entity_id);
CREATE INDEX IF NOT EXISTS idx_kinship_target ON fleet_kinship_edges (target_entity_id);

ALTER TABLE fleet_kinship_edges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_public_read ON fleet_kinship_edges;
CREATE POLICY kinship_public_read ON fleet_kinship_edges
  FOR SELECT USING (true);
