-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 002 · Intelligence Center core
-- posture_scores, convergence_events, entities, scenario_runs,
-- user_interest_vectors, user_events
-- ═══════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Posture scores ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS posture_scores (
  id BIGSERIAL PRIMARY KEY,
  theatre_slug TEXT NOT NULL,
  composite NUMERIC(4,3) NOT NULL,
  air NUMERIC(4,3),
  sea NUMERIC(4,3),
  conflict NUMERIC(4,3),
  grid NUMERIC(4,3),
  imagery NUMERIC(4,3),
  precursor_match_id UUID,
  precursor_similarity NUMERIC(4,3),
  computed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_posture_theatre_time
  ON posture_scores (theatre_slug, computed_at DESC);

ALTER TABLE posture_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS posture_scores_public_read ON posture_scores;
CREATE POLICY posture_scores_public_read ON posture_scores
  FOR SELECT USING (true);

-- ─── Convergence events (anomaly-of-anomalies) ───────────────
CREATE TABLE IF NOT EXISTS convergence_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location TEXT NOT NULL,
  bounding_box JSONB,
  joint_p_value NUMERIC(8,6),
  contributing_anomalies JSONB DEFAULT '[]'::jsonb,
  synthesis TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_convergence_created
  ON convergence_events (created_at DESC);

ALTER TABLE convergence_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS convergence_public_read ON convergence_events;
CREATE POLICY convergence_public_read ON convergence_events
  FOR SELECT USING (true);

-- ─── Entities registry ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,                  -- 'vessel','operator','owner','flag','port','refinery','mine'
  canonical_name TEXT NOT NULL,
  aliases TEXT[] DEFAULT ARRAY[]::TEXT[],
  metadata JSONB DEFAULT '{}'::jsonb,
  provenance JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_entities_type_name
  ON entities (entity_type, canonical_name);
CREATE INDEX IF NOT EXISTS idx_entities_aliases
  ON entities USING GIN (aliases);

ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS entities_public_read ON entities;
CREATE POLICY entities_public_read ON entities FOR SELECT USING (true);

-- ─── Scenario runs (chokepoint/cascade/wargame) ─────────────
CREATE TABLE IF NOT EXISTS scenario_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  scenario_type TEXT NOT NULL CHECK (scenario_type IN ('chokepoint','cascade','sanctions')),
  input JSONB NOT NULL,
  output JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scenario_user_time
  ON scenario_runs (user_id, created_at DESC);

ALTER TABLE scenario_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scenario_runs_user ON scenario_runs;
CREATE POLICY scenario_runs_user ON scenario_runs
  FOR ALL USING (auth.uid() = user_id OR user_id IS NULL);

-- ─── User events (for behavioural agent / interest vectors) ─
CREATE TABLE IF NOT EXISTS user_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID,
  event_type TEXT NOT NULL,                -- 'click','dwell','query','pin','persona_change'
  target TEXT,                             -- slug/id of the thing interacted with
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_events_user_time
  ON user_events (user_id, created_at DESC);

ALTER TABLE user_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_events_own ON user_events;
CREATE POLICY user_events_own ON user_events
  FOR ALL USING (auth.uid() = user_id OR user_id IS NULL);

-- ─── User interest vectors ──────────────────────────────────
CREATE TABLE IF NOT EXISTS user_interest_vectors (
  user_id UUID PRIMARY KEY,
  vector NUMERIC[] NOT NULL,                -- 64-dim, re-learned nightly
  pinned_theatres TEXT[] DEFAULT ARRAY[]::TEXT[],
  blind_spots JSONB DEFAULT '[]'::jsonb,
  learned_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_interest_vectors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS interest_vectors_own ON user_interest_vectors;
CREATE POLICY interest_vectors_own ON user_interest_vectors
  FOR ALL USING (auth.uid() = user_id);
