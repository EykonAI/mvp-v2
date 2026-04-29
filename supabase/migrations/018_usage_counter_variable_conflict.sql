-- ═══════════════════════════════════════════════════════════════
-- 018 — increment_usage_counter: declare #variable_conflict use_column
--
-- Migration 017 fixed the ambiguous `period_start` references in the
-- inline UPDATE statements by table-qualifying them as
-- `usage_counters.period_start`. But there's another reference site
-- that can't be table-qualified:
--
--   INSERT INTO usage_counters (user_id, period_start)
--   VALUES (p_user_id, v_period)
--   ON CONFLICT (user_id, period_start) DO NOTHING;
--
-- The ON CONFLICT clause requires unqualified column names — it's an
-- index-inference syntax, not a column-reference syntax. So when
-- PostgreSQL parses `period_start` in that position and sees both:
--   • the OUT parameter from the RETURNS TABLE clause
--   • the table column on usage_counters
-- it raises 42702 "column reference is ambiguous" no matter how we
-- qualify column references elsewhere.
--
-- Verified the symptom by calling the function directly from the SQL
-- editor (post-017):
--   ERROR: 42702: column reference "period_start" is ambiguous
--   DETAIL: It could refer to either a PL/pgSQL variable or a table
--           column.
--   QUERY:  INSERT INTO usage_counters (user_id, period_start)
--           VALUES (p_user_id, v_period)
--           ON CONFLICT (user_id, period_start) DO NOTHING
--   CONTEXT: PL/pgSQL function ... line 11 at SQL statement
--
-- Fix: declare `#variable_conflict use_column` in the function body.
-- This tells the plpgsql parser to prefer the column name over the
-- OUT parameter whenever an unqualified identifier is ambiguous —
-- which is exactly what we want for INSERT/UPDATE statements that
-- operate on `usage_counters`. The OUT parameter is still populated
-- correctly via the explicit RETURN QUERY SELECT … v_period at the
-- end (which doesn't name `period_start` directly — values are
-- positional).
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
#variable_conflict use_column
DECLARE
  v_period DATE := date_trunc('month', CURRENT_DATE)::DATE;
  v_new_value INTEGER;
  v_current_value INTEGER;
BEGIN
  IF p_counter NOT IN ('ai_queries','api_calls','exports') THEN
    RAISE EXCEPTION 'Unknown counter: %', p_counter;
  END IF;

  -- Ensure the month's row exists. With `use_column` set, the
  -- `period_start` in ON CONFLICT resolves to the table column.
  INSERT INTO usage_counters (user_id, period_start)
  VALUES (p_user_id, v_period)
  ON CONFLICT (user_id, period_start) DO NOTHING;

  -- Atomic increment gated by the per-tier limit. Column qualification
  -- is preserved from migration 017 — belt-and-braces with the
  -- variable_conflict directive.
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
