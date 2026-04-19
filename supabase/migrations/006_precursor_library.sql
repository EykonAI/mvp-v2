-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 006 · Precursor Pattern Library
-- precursor_library (historical episode labels + embedded vectors)
-- Uses pgvector when the extension is enabled, falls back to JSONB.
-- ═══════════════════════════════════════════════════════════════

-- Try to enable pgvector. If the operator hasn't enabled it yet the
-- CREATE EXTENSION will no-op (Supabase Dashboard → Database →
-- Extensions → pgvector), and we fall back to the JSONB column below.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS precursor_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,                  -- 'state_mobilisation','energy_crisis','shadow_fleet_activation','capital_flight'
  label TEXT NOT NULL,                       -- 'Feb 2022 pre-invasion', 'Oct 2023 Gaza', …
  window_start DATE NOT NULL,
  window_end DATE NOT NULL,
  vector_json JSONB NOT NULL,                -- 64-dim fallback vector
  contributing_signals JSONB DEFAULT '{}'::jsonb,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_precursor_event_type
  ON precursor_library (event_type);

ALTER TABLE precursor_library ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS precursor_public_read ON precursor_library;
CREATE POLICY precursor_public_read ON precursor_library
  FOR SELECT USING (true);

-- Add the pgvector column only when the extension is actually present.
-- Guarded so the migration still succeeds on projects without pgvector.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    BEGIN
      ALTER TABLE precursor_library ADD COLUMN IF NOT EXISTS vector vector(64);
      CREATE INDEX IF NOT EXISTS idx_precursor_vector
        ON precursor_library USING ivfflat (vector vector_cosine_ops) WITH (lists = 16);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pgvector column add skipped: %', SQLERRM;
    END;
  END IF;
END $$;
