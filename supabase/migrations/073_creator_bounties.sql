-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 073 · Creator conversion bounties
--
-- Phase 2 of the 2026-07-04 Monetisation Build-Prompt (review §4.2):
-- when a user who holds an ACTIVE paid-Space subscription upgrades
-- their platform plan (NOWPayments 'finished' webhook), the creator
-- of their EARLIEST-JOINED active Space earns a bounty —
-- BOUNTY_RATE_BPS (default 2500 = 25%) of the first-year revenue
-- actually paid. One bounty per converted user, ever (UNIQUE below).
--
-- This is the LEDGER only. Payouts are founder-run monthly from
-- /admin/bounties (USDC transfer by hand), status moves
-- pending → approved → paid (or void).
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS creator_bounties (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_user_id       UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  converted_user_id     UUID NOT NULL UNIQUE REFERENCES user_profiles(id) ON DELETE CASCADE,
  space_id              UUID NOT NULL REFERENCES comm_spaces(space_id) ON DELETE CASCADE,
  plan_variant          TEXT NOT NULL,
  -- What the converted user actually paid (crypto-discounted), NOT the
  -- fiat headline — the bounty shares real revenue, not list price.
  base_amount_usd_cents INTEGER NOT NULL CHECK (base_amount_usd_cents >= 0),
  bounty_usd_cents      INTEGER NOT NULL CHECK (bounty_usd_cents >= 0),
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','approved','paid','void')),
  note                  TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at               TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_creator_bounties_creator
  ON creator_bounties (creator_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_creator_bounties_status
  ON creator_bounties (status, created_at DESC);

-- Service-role only, matching the COMM/newsjack pattern: RLS enabled
-- with NO permissive policy. Creators see their bounties through the
-- server-rendered earnings panel, never by querying this table.
ALTER TABLE creator_bounties ENABLE ROW LEVEL SECURITY;
