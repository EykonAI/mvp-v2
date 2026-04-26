-- ═══════════════════════════════════════════════════════════════
-- 012 — vessel_positions: enable upsert-by-mmsi for AISStream.io
--
-- The original vessel_positions table (migration 001) was append-only.
-- The AISStream.io ingestion worker writes one row per vessel and
-- refreshes it in place, so we need a UNIQUE constraint on mmsi to
-- support ON CONFLICT (mmsi) DO UPDATE.
--
-- Idempotent — safe to re-run.
-- ═══════════════════════════════════════════════════════════════

-- Drop any duplicate mmsi rows that may have accumulated under the
-- old append model so the UNIQUE constraint can be added cleanly.
DELETE FROM vessel_positions a
USING vessel_positions b
WHERE a.id < b.id AND a.mmsi = b.mmsi;

-- Unique constraint enables upsert-by-mmsi.
ALTER TABLE vessel_positions
  DROP CONSTRAINT IF EXISTS vessel_positions_mmsi_key;
ALTER TABLE vessel_positions
  ADD CONSTRAINT vessel_positions_mmsi_key UNIQUE (mmsi);

-- New columns the AISStream consumer populates.
ALTER TABLE vessel_positions ADD COLUMN IF NOT EXISTS course        DOUBLE PRECISION;
ALTER TABLE vessel_positions ADD COLUMN IF NOT EXISTS imo           TEXT;
ALTER TABLE vessel_positions ADD COLUMN IF NOT EXISTS nav_status    INTEGER;
ALTER TABLE vessel_positions ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ DEFAULT NOW();

-- Read pattern: "vessels updated in the last hour, within bbox".
CREATE INDEX IF NOT EXISTS idx_vessel_updated_at
  ON vessel_positions (updated_at DESC);

-- Trigger to keep updated_at fresh on every UPDATE.
CREATE OR REPLACE FUNCTION touch_vessel_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vessel_touch ON vessel_positions;
CREATE TRIGGER trg_vessel_touch
  BEFORE UPDATE ON vessel_positions
  FOR EACH ROW EXECUTE FUNCTION touch_vessel_updated_at();
