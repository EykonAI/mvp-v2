-- ═══════════════════════════════════════════════════════════════
-- Migration 009 — Per-user monthly usage counters (Phase A gating)
--
-- Tracks AI-analyst queries, REST API calls, and export operations
-- per user per calendar month. The increment_usage_counter() function
-- is race-safe: it does one atomic UPDATE ... WHERE <col> < <limit>,
-- returning FOUND to indicate whether the call stayed under the cap.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS usage_counters (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  ai_queries INTEGER NOT NULL DEFAULT 0,
  api_calls INTEGER NOT NULL DEFAULT 0,
  exports INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_usage_counters_period
  ON usage_counters (period_start);

-- Atomic increment: returns allowed=TRUE + new_value on success,
-- allowed=FALSE + current_value when the user is already at cap.
CREATE OR REPLACE FUNCTION increment_usage_counter(
  p_user_id UUID,
  p_counter TEXT,
  p_limit INTEGER
) RETURNS TABLE (
  allowed BOOLEAN,
  new_value INTEGER,
  period_start DATE
) AS $$
DECLARE
  v_period DATE := date_trunc('month', CURRENT_DATE)::DATE;
  v_new_value INTEGER;
  v_current_value INTEGER;
BEGIN
  IF p_counter NOT IN ('ai_queries','api_calls','exports') THEN
    RAISE EXCEPTION 'Unknown counter: %', p_counter;
  END IF;

  -- Ensure the month's row exists.
  INSERT INTO usage_counters (user_id, period_start)
  VALUES (p_user_id, v_period)
  ON CONFLICT (user_id, period_start) DO NOTHING;

  -- Atomic increment gated by the per-tier limit.
  IF p_counter = 'ai_queries' THEN
    UPDATE usage_counters
    SET ai_queries = ai_queries + 1, updated_at = NOW()
    WHERE user_id = p_user_id AND period_start = v_period AND ai_queries < p_limit
    RETURNING ai_queries INTO v_new_value;
  ELSIF p_counter = 'api_calls' THEN
    UPDATE usage_counters
    SET api_calls = api_calls + 1, updated_at = NOW()
    WHERE user_id = p_user_id AND period_start = v_period AND api_calls < p_limit
    RETURNING api_calls INTO v_new_value;
  ELSE -- 'exports'
    UPDATE usage_counters
    SET exports = exports + 1, updated_at = NOW()
    WHERE user_id = p_user_id AND period_start = v_period AND exports < p_limit
    RETURNING exports INTO v_new_value;
  END IF;

  IF v_new_value IS NOT NULL THEN
    RETURN QUERY SELECT TRUE, v_new_value, v_period;
    RETURN;
  END IF;

  -- Over the cap — return current value without mutation.
  EXECUTE format(
    'SELECT %I FROM usage_counters WHERE user_id = $1 AND period_start = $2',
    p_counter
  )
  INTO v_current_value
  USING p_user_id, v_period;

  RETURN QUERY SELECT FALSE, COALESCE(v_current_value, 0), v_period;
END;
$$ LANGUAGE plpgsql;

-- RLS: users read their own usage. Service role bypasses (used by /api routes).
ALTER TABLE usage_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own usage" ON usage_counters
  FOR SELECT USING (auth.uid() = user_id);
