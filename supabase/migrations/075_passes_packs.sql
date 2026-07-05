-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 075 · One-off passes & packs (crypto-native)
--
-- Phase 4 of the 2026-07-04 Monetisation Build-Prompt (review §4.4):
-- Week Pass ($9: Pro-grade access for 7 days) and query packs
-- (+25 AI-Analyst queries for the current month, $5) as single
-- NOWPayments purchases — no recurring billing, riding the proven
-- one-off rails. Upgrade credit (a pass bought ≤30 days before a
-- subscription) stays MANUAL by design — no proration code.
--
-- Three parts:
--   1. purchases.kind learns 'week_pass' / 'query_pack'
--   2. tier_overrides + usage_bonuses (RLS-no-policy, service-role)
--   3. increment_usage_counter() replaced to add the month's
--      purchased bonus atomically (keeps the 017/018 fixes)
-- ═══════════════════════════════════════════════════════════════

-- 1 ── purchases.kind: drop the inline auto-named CHECK by definition
--      match (same technique as 072) and re-add with the new kinds.
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE contype = 'c'
      AND conrelid = 'purchases'::regclass
      AND pg_get_constraintdef(oid) LIKE '%kind = ANY%'
  LOOP
    EXECUTE format('ALTER TABLE purchases DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE purchases ADD CONSTRAINT purchases_kind_check
  CHECK (kind IN (
    'subscription_first','subscription_renewal','lifetime','refund',
    'week_pass','query_pack'
  ));

-- 2a ── Week Pass: a time-boxed tier override. getCurrentTier()
--       returns the override while active; expiry is a timestamp
--       comparison, so a lapsed pass degrades cleanly with no cron.
CREATE TABLE IF NOT EXISTS tier_overrides (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  tier        TEXT NOT NULL CHECK (tier IN ('pro')),
  source      TEXT NOT NULL CHECK (source IN ('week_pass')),
  starts_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL,
  purchase_id UUID REFERENCES purchases(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tier_overrides_user_active
  ON tier_overrides (user_id, expires_at DESC);
-- One grant per purchase: makes the webhook completion handler
-- retry-idempotent (grant-first, then mark purchase completed).
CREATE UNIQUE INDEX IF NOT EXISTS uq_tier_overrides_purchase
  ON tier_overrides (purchase_id) WHERE purchase_id IS NOT NULL;

-- 2b ── Query packs: month-scoped bonus on top of the tier limit.
CREATE TABLE IF NOT EXISTS usage_bonuses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  counter     TEXT NOT NULL CHECK (counter IN ('ai_queries','api_calls','exports')),
  bonus       INTEGER NOT NULL CHECK (bonus > 0),
  month       DATE NOT NULL, -- first of month, matches usage_counters.period_start
  purchase_id UUID REFERENCES purchases(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_usage_bonuses_user_month
  ON usage_bonuses (user_id, counter, month);
CREATE UNIQUE INDEX IF NOT EXISTS uq_usage_bonuses_purchase
  ON usage_bonuses (purchase_id) WHERE purchase_id IS NOT NULL;

ALTER TABLE tier_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_bonuses ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only (COMM/newsjack pattern).

-- 3 ── increment_usage_counter: identical to 018 except the effective
--      limit becomes p_limit + the month's purchased bonus, resolved
--      inside the same function so the hot path stays one RPC.
CREATE OR REPLACE FUNCTION increment_usage_counter(
  p_user_id UUID,
  p_counter TEXT,
  p_limit INTEGER
) RETURNS TABLE (
  allowed BOOLEAN,
  new_value INTEGER,
  period_start DATE
) AS $$
#variable_conflict use_column
DECLARE
  v_period DATE := date_trunc('month', CURRENT_DATE)::DATE;
  v_new_value INTEGER;
  v_current_value INTEGER;
  v_limit INTEGER;
BEGIN
  IF p_counter NOT IN ('ai_queries','api_calls','exports') THEN
    RAISE EXCEPTION 'Unknown counter: %', p_counter;
  END IF;

  -- Effective limit = tier limit + this month's purchased bonuses.
  SELECT p_limit + COALESCE(SUM(ub.bonus), 0)::INTEGER INTO v_limit
  FROM usage_bonuses ub
  WHERE ub.user_id = p_user_id
    AND ub.counter = p_counter
    AND ub.month = v_period;

  INSERT INTO usage_counters (user_id, period_start)
  VALUES (p_user_id, v_period)
  ON CONFLICT (user_id, period_start) DO NOTHING;

  IF p_counter = 'ai_queries' THEN
    UPDATE usage_counters
    SET ai_queries = usage_counters.ai_queries + 1, updated_at = NOW()
    WHERE usage_counters.user_id = p_user_id
      AND usage_counters.period_start = v_period
      AND usage_counters.ai_queries < v_limit
    RETURNING usage_counters.ai_queries INTO v_new_value;
  ELSIF p_counter = 'api_calls' THEN
    UPDATE usage_counters
    SET api_calls = usage_counters.api_calls + 1, updated_at = NOW()
    WHERE usage_counters.user_id = p_user_id
      AND usage_counters.period_start = v_period
      AND usage_counters.api_calls < v_limit
    RETURNING usage_counters.api_calls INTO v_new_value;
  ELSE -- 'exports'
    UPDATE usage_counters
    SET exports = usage_counters.exports + 1, updated_at = NOW()
    WHERE usage_counters.user_id = p_user_id
      AND usage_counters.period_start = v_period
      AND usage_counters.exports < v_limit
    RETURNING usage_counters.exports INTO v_new_value;
  END IF;

  IF v_new_value IS NOT NULL THEN
    RETURN QUERY SELECT TRUE, v_new_value, v_period;
    RETURN;
  END IF;

  EXECUTE format(
    'SELECT %I FROM usage_counters WHERE user_id = $1 AND period_start = $2',
    p_counter
  )
  INTO v_current_value
  USING p_user_id, v_period;

  RETURN QUERY SELECT FALSE, COALESCE(v_current_value, 0), v_period;
END;
$$ LANGUAGE plpgsql;
