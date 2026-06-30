-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 068 · Newsjacking Engine (MVP)
--
-- Backs the automated detect → package → draft → approve → publish
-- pipeline (FRONTEND/Newsjacking SOP build-prompt). Two tables:
--   • newsjack_events — a detected, packaged candidate event (one per
--     source anomaly_flag; deduped via UNIQUE (source, source_ref)),
--     carrying the evidence package + a status.
--   • newsjack_drafts — a per-channel post draft for an event, with the
--     lint / value-test results, founder edits, and publish state.
-- Human-in-the-loop: nothing publishes without a founder approval in
-- /admin/newsjack.
--
-- Additive. RLS ON, NO permissive policy — reachable ONLY via the
-- service-role API (createServerSupabase), exactly like the COMM tables.
-- Apply MANUALLY in the Supabase SQL Editor BEFORE merge.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS newsjack_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source         TEXT NOT NULL,                  -- 'anomaly_flag'
  source_ref     UUID,                           -- anomaly_flags.id
  event_key      TEXT NOT NULL,                  -- dedupe key: anomaly:<domain>:<region>:<hour>
  domain         TEXT,                           -- Conflict | Energy | Maritime
  region         TEXT,                           -- human label
  severity       TEXT,                           -- medium | high
  covered        BOOLEAN NOT NULL DEFAULT TRUE,  -- region live-covered on the current tier
  status         TEXT NOT NULL DEFAULT 'detected'
                   CHECK (status IN ('detected','drafted','blocked','approved','published','rejected','expired')),
  blocked_reason TEXT,
  evidence       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, source_ref),
  UNIQUE (event_key)
);
CREATE INDEX IF NOT EXISTS idx_newsjack_events_status ON newsjack_events (status, created_at DESC);

CREATE TABLE IF NOT EXISTS newsjack_drafts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       UUID NOT NULL REFERENCES newsjack_events(id) ON DELETE CASCADE,
  channel        TEXT NOT NULL DEFAULT 'x' CHECK (channel IN ('x','linkedin','substack')),
  body           TEXT NOT NULL,                  -- rendered thread (posts joined for display)
  posts          JSONB NOT NULL DEFAULT '[]'::jsonb,  -- thread as an array of strings
  ref_url        TEXT,                           -- replay/live-view URL with the channel utm tag
  lints          JSONB NOT NULL DEFAULT '{}'::jsonb,  -- voice / coverage / value results
  value_pass     BOOLEAN NOT NULL DEFAULT FALSE,
  status         TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','approved','rejected','published')),
  edited_body    TEXT,
  published_url  TEXT,
  published_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, channel)
);
CREATE INDEX IF NOT EXISTS idx_newsjack_drafts_event  ON newsjack_drafts (event_id);
CREATE INDEX IF NOT EXISTS idx_newsjack_drafts_status ON newsjack_drafts (status, created_at DESC);

ALTER TABLE newsjack_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE newsjack_drafts ENABLE ROW LEVEL SECURITY;
-- (no permissive policy — all access via the service-role API)
