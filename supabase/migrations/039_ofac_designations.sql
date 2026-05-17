-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 039 · OFAC SDN designations
--
-- Stores the current OFAC Specially Designated Nationals list and
-- tracks the daily diff (additions / removals / reactivations). The
-- table is the source of truth for source='ofac' predictions:
-- PR-CAL-5's resolver checks whether a target entity appeared after
-- the prediction's issued_at.
--
-- Refreshed daily by /api/cron/ingest-ofac-sdn against Treasury's
-- public SDN.CSV. Public-read RLS — the SDN list is already public.
--
-- Diff model:
--   • first_seen_at   — when this ent_num was first ingested
--   • removed_at IS NULL — currently designated
--   • removed_at IS NOT NULL — was removed from the SDN at that ts
--   • A reactivation (re-add after removal) clears removed_at back
--     to NULL; first_seen_at is preserved.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ofac_designations (
  ent_num         BIGINT PRIMARY KEY,                 -- OFAC's entity number
  sdn_name        TEXT NOT NULL,
  sdn_type        TEXT,                               -- Individual / Entity / Vessel / Aircraft
  programs        TEXT[] NOT NULL DEFAULT '{}',       -- {'UKRAINE-EO13662','RUSSIA-EO14024'}
  title           TEXT,
  remarks         TEXT,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ofac_designations_first_seen
  ON ofac_designations (first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_ofac_designations_removed_at
  ON ofac_designations (removed_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_ofac_designations_programs
  ON ofac_designations USING GIN (programs);

ALTER TABLE ofac_designations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ofac_designations_public_read ON ofac_designations;
CREATE POLICY ofac_designations_public_read ON ofac_designations
  FOR SELECT USING (true);
