-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 071 · Persisted daily brief (BRIEFS pillar)
--
-- Backs the generate-daily-brief cron: one narrated plain-language
-- brief per UTC day, written once by the cron and read by the BRIEFS
-- "Today" page (which previously regenerated an LLM brief on every
-- page view from inputs that were empty — agent_reports has no writer
-- in production and anomaly_flags.processed is never set true).
-- Grounding now comes from the proven digest source layer
-- (lib/notifications/digest.ts — same plumbing as the email digest).
--
-- Rows accumulate one per day, which is also the BRIEFS v1 deferred
-- archive.
--
-- Additive. RLS ON, NO permissive policy — reachable ONLY via the
-- service-role API (createServerSupabase), exactly like the COMM and
-- newsjack tables. Apply MANUALLY in the Supabase SQL Editor BEFORE
-- merge.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS daily_briefs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_date   DATE NOT NULL,                    -- UTC day the brief covers
  content      TEXT NOT NULL,                    -- narrated ~300-word brief
  is_quiet     BOOLEAN NOT NULL DEFAULT FALSE,   -- window had no events
  sources      JSONB NOT NULL DEFAULT '{}'::jsonb, -- composed digest snapshot (traceability)
  model        TEXT,                             -- LLM used, NULL for deterministic quiet copy
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (brief_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_briefs_date ON daily_briefs (brief_date DESC);

ALTER TABLE daily_briefs ENABLE ROW LEVEL SECURITY;
