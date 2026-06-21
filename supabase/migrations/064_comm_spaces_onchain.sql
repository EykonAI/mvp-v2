-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 064 · COMM E2 (plumbing) · spaces on-chain wiring
--
-- Config-agnostic groundwork for non-custodial USDC subscriptions
-- (Unlock Protocol on Base). NO payments yet — this only adds:
--   • lock_address / network on comm_spaces — the per-space Unlock lock
--     (deployed in E2b with the creator as beneficiary; NULL until then),
--   • comm_wallets — links an eYKON user to their wallet, so on-chain key
--     ownership (the access check, detection mode "5b") maps to a user.
-- The subscription grant itself reuses comm_space_subscriptions (mig 063).
--
-- Additive; RLS on for comm_wallets, NO permissive policy (service-role
-- API only). Apply MANUALLY in the Supabase SQL Editor BEFORE merge.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE comm_spaces
  ADD COLUMN IF NOT EXISTS lock_address TEXT,
  ADD COLUMN IF NOT EXISTS network      TEXT;

CREATE TABLE IF NOT EXISTS comm_wallets (
  user_id     UUID PRIMARY KEY REFERENCES user_profiles(id) ON DELETE CASCADE,
  address     TEXT NOT NULL,
  chain       TEXT NOT NULL DEFAULT 'base',
  verified_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comm_wallets_address ON comm_wallets (lower(address));

ALTER TABLE comm_wallets ENABLE ROW LEVEL SECURITY;
-- (no permissive policy — all access via the service-role API)
