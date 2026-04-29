-- ═══════════════════════════════════════════════════════════════
-- 017 — fix increment_usage_counter() ambiguous column reference
--
-- The function declared in migration 009 has both an OUT parameter
-- named `period_start` (in the RETURNS TABLE clause) AND a column of
-- the same name on the `usage_counters` table. Inside the inline
-- UPDATE / WHERE statements PostgreSQL can't tell which one
-- `period_start` refers to and raises:
--
--   column reference "period_start" is ambiguous
--
-- Manifests as a 500 from /api/chat with the server-side log
-- "[chat] increment_usage_counter failed column reference 'period_start'
-- is ambiguous" — and the chat panel surfaces a misleading
-- "Check that ANTHROPIC_API_KEY is set" message because the client
-- coerces every 5xx into the same hint.
--
-- Fix: replace the function with one that qualifies every reference
-- to the table column as `usage_counters.period_start`. The OUT
-- parameter name (and therefore the JS-side `row.period_start` field)
-- stays the same so /api/chat doesn't need to change.
--
-- Idempotent — CREATE OR REPLACE.
-- ═══════════════════════════════════════════════════════════════

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

  -- Atomic increment gated by the per-tier limit. Every reference to
  -- the `period_start` column is now table-qualified to disambiguate
  -- from the OUT parameter of the same name.
  IF p_counter = 'ai_queries' THEN
    UPDATE usage_counters
    SET ai_queries = usage_counters.ai_queries + 1, updated_at = NOW()
    WHERE usage_counters.user_id = p_user_id
      AND usage_counters.period_start = v_period
      AND usage_counters.ai_queries < p_limit
    RETURNING usage_counters.ai_queries INTO v_new_value;
  ELSIF p_counter = 'api_calls' THEN
    UPDATE usage_counters
    SET api_calls = usage_counters.api_calls + 1, updated_at = NOW()
    WHERE usage_counters.user_id = p_user_id
      AND usage_counters.period_start = v_period
      AND usage_counters.api_calls < p_limit
    RETURNING usage_counters.api_calls INTO v_new_value;
  ELSE -- 'exports'
    UPDATE usage_counters
    SET exports = usage_counters.exports + 1, updated_at = NOW()
    WHERE usage_counters.user_id = p_user_id
      AND usage_counters.period_start = v_period
      AND usage_counters.exports < p_limit
    RETURNING usage_counters.exports INTO v_new_value;
  END IF;

  IF v_new_value IS NOT NULL THEN
    RETURN QUERY SELECT TRUE, v_new_value, v_period;
    RETURN;
  END IF;

  -- Over the cap — return current value without mutation. The
  -- EXECUTE format() block runs as a fresh SQL statement so its
  -- `period_start` reference is unambiguous (no OUT params in scope),
  -- but we qualify it anyway for consistency.
  EXECUTE format(
    'SELECT %I FROM usage_counters WHERE user_id = $1 AND period_start = $2',
    p_counter
  )
  INTO v_current_value
  USING p_user_id, v_period;

  RETURN QUERY SELECT FALSE, COALESCE(v_current_value, 0), v_period;
END;
$$ LANGUAGE plpgsql;
