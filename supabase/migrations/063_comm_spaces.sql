-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 063 · COMM E1 · paid spaces (scaffold, NO payments)
--
-- A paid space is a comm_rooms row with kind='space' (already allowed by
-- the 060 CHECK). comm_spaces holds the price / creator metadata;
-- comm_space_subscriptions is the access ledger. E1 ships the scaffold
-- (create / discover / gate access) with NO money movement — checkout
-- (E2, non-custodial USDC via Unlock Protocol) and creator payouts (E3)
-- come later.
--
-- Access model: a viewer sees a space iff they are the creator OR hold an
-- active subscription. Granting a subscription (E2) also adds the
-- subscriber to comm_room_members, so the existing Thread + message API +
-- in-room analyst work UNCHANGED for spaces. provider_ref will hold the
-- Unlock lock/key reference.
--
-- Additive; RLS on with NO permissive policy (service-role API only, per
-- the COMM pattern). Apply MANUALLY in the Supabase SQL Editor BEFORE merge.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS comm_spaces (
  space_id   UUID PRIMARY KEY REFERENCES comm_rooms(id) ON DELETE CASCADE,
  creator_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  price_usdc NUMERIC(12,2) NOT NULL CHECK (price_usdc >= 0),
  cadence    TEXT NOT NULL CHECK (cadence IN ('monthly','annual')),
  blurb      TEXT,
  status     TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('draft','live','paused')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comm_spaces_creator ON comm_spaces (creator_id);

CREATE TABLE IF NOT EXISTS comm_space_subscriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id      UUID NOT NULL REFERENCES comm_spaces(space_id) ON DELETE CASCADE,
  subscriber_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','canceled')),
  provider_ref  TEXT,                  -- Unlock Protocol key / lock reference (E2)
  amount_usdc   NUMERIC(12,2),
  started_at    TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (space_id, subscriber_id)
);
CREATE INDEX IF NOT EXISTS idx_space_subs_subscriber ON comm_space_subscriptions (subscriber_id);
CREATE INDEX IF NOT EXISTS idx_space_subs_active ON comm_space_subscriptions (space_id, status);

ALTER TABLE comm_spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE comm_space_subscriptions ENABLE ROW LEVEL SECURITY;
-- (no permissive policies — all access via the service-role API)
