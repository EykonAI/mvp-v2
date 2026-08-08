-- ═══════════════════════════════════════════════════════════════
-- Migration 101 — debit_credit() : atomic wallet debit
--
-- Modelled on increment_usage_counter() (mig 009, fixed in 018): ONE
-- atomic UPDATE, never read-then-write. Two concurrent analyst turns
-- must not both read spent_usd=9.90 and each write 10.40.
--
-- LLM cost is only known AFTER the call, so the order is:
--   pre-flight CHECK (lib/costs/wallet.ts canSpend)  → run the turn
--   → post-flight DEBIT (this function).
-- Overshoot is therefore bounded by one turn and is ACCEPTED, not
-- engineered away — the pre-flight reserve keeps that bound small.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION debit_credit(
  p_user_id UUID,
  p_usd     NUMERIC,
  p_is_deep BOOLEAN DEFAULT FALSE
) RETURNS TABLE (
  ok         BOOLEAN,
  spent      NUMERIC,
  budget     NUMERIC,
  deep_spent NUMERIC,
  deep_cap   NUMERIC,
  status     TEXT
) AS $$
DECLARE
  v_row user_credit_accounts%ROWTYPE;
BEGIN
  IF p_usd IS NULL OR p_usd < 0 THEN
    RAISE EXCEPTION 'debit_credit: p_usd must be >= 0 (got %)', p_usd;
  END IF;

  -- One atomic statement. The account row is the only thing touched,
  -- so no lock ordering to reason about.
  UPDATE user_credit_accounts
     SET spent_usd      = spent_usd + p_usd,
         deep_spent_usd = deep_spent_usd + CASE WHEN p_is_deep THEN p_usd ELSE 0 END,
         status         = CASE
                            -- 'suspended' is a founder kill-switch and
                            -- must survive a debit; only 'active' may
                            -- transition to 'exhausted' here.
                            WHEN status = 'active'
                                 AND spent_usd + p_usd >= budget_usd
                              THEN 'exhausted'
                            ELSE status
                          END,
         exhausted_at   = CASE
                            WHEN status = 'active'
                                 AND spent_usd + p_usd >= budget_usd
                                 AND exhausted_at IS NULL
                              THEN NOW()
                            ELSE exhausted_at
                          END,
         updated_at     = NOW()
   WHERE user_id = p_user_id
  RETURNING * INTO v_row;

  -- No wallet row = UNMETERED user. Not an error: the vast majority of
  -- users have no wallet and are governed by their tier's query limits.
  IF NOT FOUND THEN
    RETURN QUERY SELECT TRUE, NULL::NUMERIC, NULL::NUMERIC,
                        NULL::NUMERIC, NULL::NUMERIC, NULL::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    (v_row.status = 'active'),
    v_row.spent_usd,
    v_row.budget_usd,
    v_row.deep_spent_usd,
    ROUND(v_row.budget_usd * v_row.deep_cap_pct, 6),
    v_row.status;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Service-role only, same posture as the tables it writes.
REVOKE ALL ON FUNCTION debit_credit(UUID, NUMERIC, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION debit_credit(UUID, NUMERIC, BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION debit_credit(UUID, NUMERIC, BOOLEAN) FROM authenticated;

-- ═══════════════════════════════════════════════════════════════
-- Verification (safe — no wallet rows exist yet, so this is a no-op
-- that proves the signature and the unmetered path):
--
--   SELECT * FROM debit_credit(
--     '00000000-0000-0000-0000-000000000000'::uuid, 0.01, false);
--   -- expect one row: ok=true, every other column NULL (no wallet)
--
--   SELECT proname, pg_get_function_identity_arguments(oid)
--   FROM pg_proc WHERE proname = 'debit_credit';
--   -- expect exactly ONE row. CREATE OR REPLACE does not replace when
--   -- the signature changes — two rows means an older signature is
--   -- still live and callable.
-- ═══════════════════════════════════════════════════════════════
