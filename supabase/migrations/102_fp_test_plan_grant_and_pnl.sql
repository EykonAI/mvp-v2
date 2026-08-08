-- ═══════════════════════════════════════════════════════════════
-- Migration 102 — FP test-plan grant + per-user P&L
--
-- Completes the metered test plan: one atomic grant path for the
-- admin console, and the profitability view the Analytics page reads.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1 · grant_fp_test_plan() ──────────────────────────────────
-- A test plan is THREE writes that must land together:
--   tier_overrides       → Pro entitlements (source 'fp_test')
--   user_credit_accounts → the wallet, with a PER-PLAN budget
--   credit_grants        → the audit trail
-- Doing them as three separate client calls risks a partial grant —
-- a wallet with no Pro, or Pro with no wallet (= unmetered Pro,
-- exactly what this feature exists to prevent).
--
-- Idempotent: re-granting TOPS UP rather than duplicating, so a
-- double-submit cannot silently double someone's budget.
CREATE OR REPLACE FUNCTION grant_fp_test_plan(
  p_user_id     UUID,
  p_budget_usd  NUMERIC,
  p_granted_by  TEXT,
  p_label       TEXT DEFAULT NULL,
  p_deep_cap    NUMERIC DEFAULT 0.20,
  p_days        INTEGER DEFAULT 90,
  p_reason      TEXT DEFAULT NULL
) RETURNS TABLE (
  ok           BOOLEAN,
  budget_usd   NUMERIC,
  spent_usd    NUMERIC,
  status       TEXT,
  was_existing BOOLEAN
) AS $$
DECLARE
  v_existing user_credit_accounts%ROWTYPE;
  v_new_budget NUMERIC;
BEGIN
  IF p_budget_usd IS NULL OR p_budget_usd <= 0 THEN
    RAISE EXCEPTION 'grant_fp_test_plan: budget must be > 0 (got %)', p_budget_usd;
  END IF;
  IF p_deep_cap < 0 OR p_deep_cap > 1 THEN
    RAISE EXCEPTION 'grant_fp_test_plan: deep_cap must be 0..1 (got %)', p_deep_cap;
  END IF;

  SELECT * INTO v_existing FROM user_credit_accounts WHERE user_id = p_user_id;

  -- Pro entitlements. ON CONFLICT is not usable here (no unique key on
  -- user_id — a user may hold a Week Pass row too), so extend the
  -- window rather than stacking a second fp_test row.
  UPDATE tier_overrides
     SET expires_at = GREATEST(expires_at, NOW() + (p_days || ' days')::INTERVAL)
   WHERE user_id = p_user_id AND source = 'fp_test';
  IF NOT FOUND THEN
    INSERT INTO tier_overrides (user_id, tier, source, starts_at, expires_at)
    VALUES (p_user_id, 'pro', 'fp_test', NOW(), NOW() + (p_days || ' days')::INTERVAL);
  END IF;

  IF v_existing.user_id IS NULL THEN
    v_new_budget := p_budget_usd;
    INSERT INTO user_credit_accounts
      (user_id, label, budget_usd, deep_cap_pct, status)
    VALUES
      (p_user_id, p_label, v_new_budget, p_deep_cap, 'active');
  ELSE
    -- Top-up: raise the budget and revive an exhausted plan. A
    -- 'suspended' plan stays suspended — money is not the reason it
    -- was paused, so a top-up must not silently un-pause it.
    v_new_budget := v_existing.budget_usd + p_budget_usd;
    UPDATE user_credit_accounts
       SET budget_usd   = v_new_budget,
           label        = COALESCE(p_label, label),
           deep_cap_pct = p_deep_cap,
           status       = CASE WHEN status = 'exhausted' THEN 'active' ELSE status END,
           exhausted_at = CASE WHEN status = 'exhausted' THEN NULL ELSE exhausted_at END,
           updated_at   = NOW()
     WHERE user_id = p_user_id;
  END IF;

  INSERT INTO credit_grants (user_id, amount_usd, source, reason, granted_by)
  VALUES (p_user_id, p_budget_usd, 'founder', p_reason, p_granted_by);

  RETURN QUERY
  SELECT TRUE,
         a.budget_usd,
         a.spent_usd,
         a.status,
         (v_existing.user_id IS NOT NULL)
    FROM user_credit_accounts a
   WHERE a.user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION grant_fp_test_plan(UUID, NUMERIC, TEXT, TEXT, NUMERIC, INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION grant_fp_test_plan(UUID, NUMERIC, TEXT, TEXT, NUMERIC, INTEGER, TEXT) FROM anon;
REVOKE ALL ON FUNCTION grant_fp_test_plan(UUID, NUMERIC, TEXT, TEXT, NUMERIC, INTEGER, TEXT) FROM authenticated;

-- ─── 2 · user_pnl — contribution margin per user ───────────────
-- Revenue (completed purchases) minus VARIABLE cost (cost_events).
--
-- Reported BEFORE any fixed-cost allocation, deliberately. Fixed costs
-- — ingest crons, Railway, Supabase base — are identical with zero
-- users; blending them in hides which users are genuinely unprofitable
-- behind an averaged overhead. When a fixed_cost_periods table lands,
-- allocate it in a SEPARATE column, never folded into this one.
CREATE OR REPLACE VIEW user_pnl AS
WITH revenue AS (
  -- purchases stores money as amount_cents (INTEGER), not a usd
  -- numeric, and has no completed_at — updated_at is when the webhook
  -- moved it to 'completed'. Both verified against production before
  -- writing this; the build would not have caught either.
  SELECT user_id,
         SUM(amount_cents)::NUMERIC / 100.0  AS revenue_usd,
         COUNT(*)                            AS purchase_count,
         MAX(updated_at)                     AS last_purchase_at
    FROM purchases
   WHERE status = 'completed' AND user_id IS NOT NULL
   GROUP BY user_id
),
cost AS (
  SELECT user_id,
         SUM(usd_cost)                                          AS cost_usd,
         SUM(usd_cost) FILTER (WHERE billable)                  AS cost_billable_usd,
         SUM(usd_cost) FILTER (WHERE category = 'llm')          AS cost_llm_usd,
         SUM(usd_cost) FILTER (WHERE feature = 'deep_analysis') AS cost_deep_usd,
         COUNT(*)                                               AS event_count,
         MAX(occurred_at)                                       AS last_event_at
    FROM cost_events
   WHERE user_id IS NOT NULL
   GROUP BY user_id
)
SELECT
  p.id                                        AS user_id,
  p.display_name,
  p.handle,
  COALESCE(r.revenue_usd, 0)                  AS revenue_usd,
  COALESCE(r.purchase_count, 0)               AS purchase_count,
  COALESCE(c.cost_usd, 0)                     AS cost_usd,
  COALESCE(c.cost_billable_usd, 0)            AS cost_billable_usd,
  COALESCE(c.cost_llm_usd, 0)                 AS cost_llm_usd,
  COALESCE(c.cost_deep_usd, 0)                AS cost_deep_usd,
  COALESCE(c.event_count, 0)                  AS event_count,
  -- Contribution margin. NOT profit: fixed costs are excluded by
  -- design (see the note above).
  COALESCE(r.revenue_usd, 0) - COALESCE(c.cost_usd, 0) AS margin_usd,
  r.last_purchase_at,
  c.last_event_at,
  w.budget_usd                                AS plan_budget_usd,
  w.spent_usd                                 AS plan_spent_usd,
  w.status                                    AS plan_status,
  w.label                                     AS plan_label
FROM user_profiles p
LEFT JOIN revenue r ON r.user_id = p.id
LEFT JOIN cost    c ON c.user_id = p.id
LEFT JOIN user_credit_accounts w ON w.user_id = p.id
WHERE r.user_id IS NOT NULL OR c.user_id IS NOT NULL OR w.user_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════
-- Verification (run as SELECTs before merging):
--
--   SELECT proname, pg_get_function_identity_arguments(oid)
--   FROM pg_proc WHERE proname = 'grant_fp_test_plan';
--   -- expect exactly ONE row (CREATE OR REPLACE does not replace
--   -- across a changed signature)
--
--   SELECT * FROM user_pnl ORDER BY cost_usd DESC LIMIT 5;
--   -- expect the users who have already accrued cost_events rows
-- ═══════════════════════════════════════════════════════════════
