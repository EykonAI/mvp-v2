-- ═══════════════════════════════════════════════════════════════
-- Migration 008 — Payments core (Phase 4 crypto + Phase 5 fiat)
--
-- Unified schema for both payment providers. subscriptions + purchases
-- carry a payment_provider column; webhook_events is a shared idempotency
-- store keyed by (provider, event_id). founding_seats_counter and
-- lifetime_seats_counter enforce the 1000 / 250 caps atomically via
-- UPDATE ... WHERE seats_taken < cap.
-- ═══════════════════════════════════════════════════════════════

-- ─── Subscriptions ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payment_provider TEXT NOT NULL
    CHECK (payment_provider IN ('lemon_squeezy','nowpayments')),
  external_subscription_id TEXT,
  variant_id TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('citizen','pro','desk','enterprise')),
  billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('monthly','annual','lifetime')),
  status TEXT NOT NULL CHECK (status IN ('active','past_due','cancelled','expired')),
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_end TIMESTAMPTZ NOT NULL,
  cancel_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user
  ON subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_external
  ON subscriptions (external_subscription_id)
  WHERE external_subscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_subscriptions_renewal
  ON subscriptions (current_period_end)
  WHERE status = 'active';

-- ─── Purchases ──────────────────────────────────────────────
-- One row per transaction event (first subscription, renewal, lifetime,
-- refund). For crypto, a pending row is created at checkout and flipped
-- to 'completed' by the IPN webhook.
CREATE TABLE IF NOT EXISTS purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payment_provider TEXT NOT NULL
    CHECK (payment_provider IN ('lemon_squeezy','nowpayments')),
  external_order_id TEXT,
  variant_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'subscription_first','subscription_renewal','lifetime','refund'
  )),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','completed','failed','refunded','expired')),
  amount_cents INTEGER,
  currency TEXT,
  pay_currency TEXT,            -- crypto: 'btc','usdc','usdt',...
  crypto_tx_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_external
  ON purchases (payment_provider, external_order_id)
  WHERE external_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchases_user
  ON purchases (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_status
  ON purchases (status, created_at DESC);

-- ─── Webhook events (shared idempotency store) ──────────────
CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL
    CHECK (provider IN ('lemon_squeezy','nowpayments','resend')),
  event_id TEXT NOT NULL,
  event_type TEXT,
  payload JSONB,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processed','failed','duplicate')),
  error_message TEXT,
  UNIQUE (provider, event_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_pending
  ON webhook_events (provider, received_at DESC)
  WHERE status = 'pending';

-- ─── Founding seats counter (1000 cap) ──────────────────────
CREATE TABLE IF NOT EXISTS founding_seats_counter (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  seats_taken INTEGER NOT NULL DEFAULT 0,
  cap INTEGER NOT NULL DEFAULT 1000,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO founding_seats_counter (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- ─── Lifetime seats counter (250 cap, fiat-only) ────────────
CREATE TABLE IF NOT EXISTS lifetime_seats_counter (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  seats_taken INTEGER NOT NULL DEFAULT 0,
  cap INTEGER NOT NULL DEFAULT 250,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO lifetime_seats_counter (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- ─── Atomic seat claim helpers ──────────────────────────────
-- Returns TRUE iff a seat was claimed. The UPDATE ... WHERE
-- seats_taken < cap is race-safe: Postgres row-locks the counter
-- row for the duration of the UPDATE, so concurrent callers see a
-- consistent view. FOUND reflects whether any row matched.

CREATE OR REPLACE FUNCTION claim_founding_seat() RETURNS BOOLEAN AS $$
BEGIN
  UPDATE founding_seats_counter
  SET seats_taken = seats_taken + 1, updated_at = NOW()
  WHERE id = 1 AND seats_taken < cap;
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION claim_lifetime_seat() RETURNS BOOLEAN AS $$
BEGIN
  UPDATE lifetime_seats_counter
  SET seats_taken = seats_taken + 1, updated_at = NOW()
  WHERE id = 1 AND seats_taken < cap;
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- ─── Complete crypto purchase (atomic) ──────────────────────
-- Called by /api/webhooks/nowpayments after HMAC + idempotency checks
-- pass. Single SQL transaction covers: purchase update, founding-seat
-- claim, subscription insert, user_profiles update, notification enqueue.
-- Idempotent: repeat calls with purchase.status='completed' are no-ops.
--
-- Returns the granted tier and whether a founding seat was awarded, so
-- the webhook handler can decide which receipt template to enqueue.

CREATE OR REPLACE FUNCTION complete_crypto_purchase(
  p_purchase_id UUID,
  p_external_order_id TEXT,
  p_pay_currency TEXT,
  p_tx_hash TEXT,
  p_actually_paid_cents INTEGER
) RETURNS TABLE (
  tier TEXT,
  granted_founding BOOLEAN,
  is_idempotent_replay BOOLEAN,
  user_id UUID,
  variant_id TEXT
) AS $$
DECLARE
  v_purchase RECORD;
  v_is_founding BOOLEAN;
  v_got_founding_seat BOOLEAN := FALSE;
  v_tier TEXT;
BEGIN
  SELECT * INTO v_purchase
  FROM purchases
  WHERE id = p_purchase_id
  FOR UPDATE;

  IF v_purchase.id IS NULL THEN
    RAISE EXCEPTION 'Purchase not found: %', p_purchase_id;
  END IF;

  IF v_purchase.status = 'completed' THEN
    -- Idempotent replay. Return current state without mutating.
    RETURN QUERY
    SELECT
      up.tier,
      up.founding_rate_locked,
      TRUE,
      v_purchase.user_id,
      v_purchase.variant_id
    FROM user_profiles up
    WHERE up.id = v_purchase.user_id;
    RETURN;
  END IF;

  v_is_founding := v_purchase.variant_id LIKE '%_founding_%';
  IF v_is_founding THEN
    v_got_founding_seat := claim_founding_seat();
  END IF;

  v_tier := CASE
    WHEN v_purchase.variant_id LIKE 'pro_%' THEN 'pro'
    WHEN v_purchase.variant_id LIKE 'desk_%' THEN 'desk'
    ELSE 'citizen'
  END;

  UPDATE purchases SET
    status = 'completed',
    external_order_id = p_external_order_id,
    pay_currency = p_pay_currency,
    crypto_tx_hash = p_tx_hash,
    amount_cents = p_actually_paid_cents,
    updated_at = NOW()
  WHERE id = p_purchase_id;

  INSERT INTO subscriptions (
    user_id, payment_provider, external_subscription_id, variant_id,
    tier, billing_cycle, status, current_period_start, current_period_end
  ) VALUES (
    v_purchase.user_id, 'nowpayments', p_external_order_id, v_purchase.variant_id,
    v_tier, 'annual', 'active', NOW(), NOW() + INTERVAL '1 year'
  );

  UPDATE user_profiles SET
    tier = v_tier,
    billing_cycle = 'annual',
    founding_rate_locked = founding_rate_locked OR (v_is_founding AND v_got_founding_seat),
    nowpayments_customer_ref = v_purchase.user_id::TEXT,
    updated_at = NOW()
  WHERE id = v_purchase.user_id;

  INSERT INTO notification_queue (user_id, channel, title, body, payload)
  VALUES (
    v_purchase.user_id,
    'email',
    'Welcome to eYKON ' || initcap(v_tier),
    'Your crypto payment has been confirmed. Your subscription is active.',
    jsonb_build_object(
      'template', 'receipt_crypto',
      'variant_id', v_purchase.variant_id,
      'tier', v_tier,
      'granted_founding', (v_is_founding AND v_got_founding_seat),
      'pay_currency', p_pay_currency,
      'tx_hash', p_tx_hash
    )
  );

  RETURN QUERY SELECT
    v_tier,
    (v_is_founding AND v_got_founding_seat),
    FALSE,
    v_purchase.user_id,
    v_purchase.variant_id;
END;
$$ LANGUAGE plpgsql;

-- ─── Row-Level Security ─────────────────────────────────────
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE founding_seats_counter ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifetime_seats_counter ENABLE ROW LEVEL SECURITY;

-- Users read their own subscriptions and purchases only.
CREATE POLICY "Users see own subscriptions" ON subscriptions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users see own purchases" ON purchases
  FOR SELECT USING (auth.uid() = user_id);

-- webhook_events: service role only (no public read/write policies → RLS blocks all).

-- Counters: publicly readable so /launch can show live remaining-seats
-- numbers. Writes only via the claim_*() functions (service role bypasses).
CREATE POLICY "Public read founding counter" ON founding_seats_counter
  FOR SELECT USING (TRUE);
CREATE POLICY "Public read lifetime counter" ON lifetime_seats_counter
  FOR SELECT USING (TRUE);
