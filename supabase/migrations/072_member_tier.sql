-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 072 · Member tier
--
-- Adds 'member' (~$12/mo headline, $99/yr; crypto annual $84.15)
-- between citizen and pro, per the 2026-07-04 Monetisation Strategy
-- Review §4.1. Member = participate fully (COMM standing, persisted
-- chats, 25 AI queries/mo, 5 rules, 6h feed delay); Pro = analyse
-- professionally (INTEL workspaces stay pro+, as do exports/API).
--
-- Only the two tier CHECK constraints change; no new tables. The
-- inline column CHECKs from 007 (user_profiles) and 008
-- (subscriptions) carry auto-generated names, so they are dropped
-- by definition-match rather than by hardcoded name.
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname, conrelid::regclass::text AS tbl
    FROM pg_constraint
    WHERE contype = 'c'
      AND conrelid IN ('user_profiles'::regclass, 'subscriptions'::regclass)
      AND pg_get_constraintdef(oid) LIKE '%tier = ANY%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tbl, c.conname);
  END LOOP;
END $$;

ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_tier_check
  CHECK (tier IN ('citizen','member','pro','desk','enterprise'));

ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_tier_check
  CHECK (tier IN ('citizen','member','pro','desk','enterprise'));

-- fiat_waitlist (010) keeps its ('pro','enterprise') CHECK on purpose:
-- Member launches crypto-annual only; it joins the fiat waitlist UI
-- when Lemon Squeezy monthly billing (Phase 5) opens.

-- ─── complete_crypto_purchase: tier derivation fix ─────────────
-- The 008 version derived the granted tier with
--   CASE WHEN variant LIKE 'pro_%' → 'pro'
--        WHEN variant LIKE 'desk_%' → 'desk'  ELSE 'citizen' END
-- which silently grants 'citizen' for BOTH the new member variant AND
-- the existing enterprise variants (latent bug — no enterprise crypto
-- purchase has exercised it yet). Replaced with an exhaustive mapping
-- that fails loudly on an unknown prefix instead of defaulting to a
-- free tier on a paid purchase. Everything else is identical to 008.

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
    WHEN v_purchase.variant_id LIKE 'member_%' THEN 'member'
    WHEN v_purchase.variant_id LIKE 'pro_%' THEN 'pro'
    WHEN v_purchase.variant_id LIKE 'desk_%' THEN 'desk'
    WHEN v_purchase.variant_id LIKE 'enterprise_%' THEN 'enterprise'
  END;
  IF v_tier IS NULL THEN
    RAISE EXCEPTION 'complete_crypto_purchase: unknown variant prefix %', v_purchase.variant_id;
  END IF;

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
