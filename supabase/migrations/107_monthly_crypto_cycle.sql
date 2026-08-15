-- 107_monthly_crypto_cycle.sql
--
-- complete_crypto_purchase: derive the billing cycle from the variant id
-- instead of hardcoding 'annual' (closing-LP brief v1.3 §4.6, PR C-bis).
--
-- Founder decision 2026-08-15: a monthly crypto variant ships at $29/month
-- (pro_founding_monthly) alongside the $243.60 annual. The deployed
-- function — read from production via pg_get_functiondef before this was
-- written, per the mig-072 lesson — hardcodes 'annual' in THREE places:
-- the subscriptions insert (billing_cycle + INTERVAL '1 year') and the
-- user_profiles update. A monthly purchase through the unpatched function
-- would grant a full year of Pro for $29.
--
-- What holds without change (verified against production):
--   • tier mapping is by prefix (pro_% → 'pro'), so the new variant maps
--     cleanly — no new RAISE branch needed;
--   • v_is_founding := variant_id LIKE '%_founding_%' matches
--     pro_founding_monthly, so a monthly founder consumes a founding seat
--     exactly like an annual one (getFoundingSeats dedups on user_id);
--   • subscriptions/user_profiles billing_cycle CHECKs already allow
--     'monthly';
--   • expire-subscriptions is cycle-agnostic (reads current_period_end).
--
-- Signature is UNCHANGED, so CREATE OR REPLACE genuinely replaces (the
-- §17.5 trap is signature CHANGES leaving the old overload live).
--
-- Apply MANUALLY in the Supabase SQL Editor BEFORE merging PR C-bis.

CREATE OR REPLACE FUNCTION public.complete_crypto_purchase(
  p_purchase_id uuid,
  p_external_order_id text,
  p_pay_currency text,
  p_tx_hash text,
  p_actually_paid_cents integer
)
RETURNS TABLE(tier text, granted_founding boolean, is_idempotent_replay boolean, user_id uuid, variant_id text)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_purchase RECORD;
  v_is_founding BOOLEAN;
  v_got_founding_seat BOOLEAN := FALSE;
  v_tier TEXT;
  v_cycle TEXT;
  v_period INTERVAL;
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

  -- Cycle from the variant suffix. '_monthly' is the only monthly marker
  -- (variant id format: <tier>_<founding|standard>_<cycle>); anything else
  -- keeps the historical annual behaviour, including every existing variant.
  v_cycle := CASE
    WHEN v_purchase.variant_id LIKE '%_monthly' THEN 'monthly'
    ELSE 'annual'
  END;
  v_period := CASE v_cycle
    WHEN 'monthly' THEN INTERVAL '1 month'
    ELSE INTERVAL '1 year'
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
    v_tier, v_cycle, 'active', NOW(), NOW() + v_period
  );

  UPDATE user_profiles SET
    tier = v_tier,
    billing_cycle = v_cycle,
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
$function$;

-- Verification (run after applying):
--   select count(*) from pg_proc where proname='complete_crypto_purchase'; -- 1 (no orphan overload)
--   select pg_get_functiondef('public.complete_crypto_purchase(uuid,text,text,text,integer)'::regprocedure)
--     ilike '%_monthly%';                                                  -- t
