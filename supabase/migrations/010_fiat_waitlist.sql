-- ═══════════════════════════════════════════════════════════════
-- Migration 010 — Fiat billing waitlist (Phase B landing page)
--
-- 400 of the 1,000 founding seats are reserved for users who want to
-- pay in fiat. Lemon Squeezy integration ships Week 2 post-launch;
-- until then, the landing page pricing cards offer "Join fiat waitlist"
-- CTAs that POST here. Phase C (Resend) sends the confirmation email;
-- when LS goes live, ordered waitlist position drives the payment-link
-- send order.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS fiat_waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('pro','enterprise')),
  note TEXT,
  referral_code TEXT,               -- captured from ?ref= / Rewardful (Phase E)
  ip_hash TEXT,                      -- SHA-256 of remote IP (abuse guard, non-PII)
  user_agent TEXT,
  confirmed_email BOOLEAN NOT NULL DEFAULT FALSE,
  notified_at TIMESTAMPTZ,           -- set when LS-payment-link email is sent
  converted_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (email, tier)
);

CREATE INDEX IF NOT EXISTS idx_fiat_waitlist_created
  ON fiat_waitlist (created_at);

CREATE INDEX IF NOT EXISTS idx_fiat_waitlist_unnotified
  ON fiat_waitlist (created_at)
  WHERE notified_at IS NULL;

-- RLS: service role only. Public write happens through the API route
-- which uses the service-role client.
ALTER TABLE fiat_waitlist ENABLE ROW LEVEL SECURITY;
