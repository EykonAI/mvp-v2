-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 076 · Founding Partner programme
--
-- Per the 2026-07-05 Founding Partner Build-Prompt: 20 founder-vetted
-- partners get instant paid-Space creation + bundled Creator Pro
-- (consuming the SHARED free-50 pool), subject to earning a shown
-- Reputation Note (≥10 resolved, Brier skill ≥ 0 — the percentile
-- term is explicitly NOT part of the deadline) within 6 months.
--
-- Lifecycle: active → warned (month 4) → gated (deadline passed) →
-- graduated (Note achieved — terminal). Gating pauses NEW subscribers
-- and Discover visibility only; existing subscribers, revenue and
-- badges are never touched. One founder-discretion extension.
--
-- The integrity invariant stands: partner status NEVER alters the
-- Reputation Note display anywhere.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS founding_partners (
  user_id       UUID PRIMARY KEY REFERENCES user_profiles(id) ON DELETE CASCADE,
  granted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note_deadline TIMESTAMPTZ NOT NULL,
  extended_once BOOLEAN NOT NULL DEFAULT FALSE,
  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','warned','gated','graduated')),
  terms_version TEXT NOT NULL,
  vetting_note  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Service-role only (COMM pattern): RLS on, no permissive policy.
-- The 20-partner cap is enforced in the admin grant path (and is a
-- public promise, like the founding 1,000).
ALTER TABLE founding_partners ENABLE ROW LEVEL SECURITY;
