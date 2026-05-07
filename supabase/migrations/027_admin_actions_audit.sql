-- ═══════════════════════════════════════════════════════════════
-- Migration 027 — admin_actions audit table
--
-- Backs the founder force-override admin endpoints from PR 12
-- (spec §6.10). Every override (force-mark threshold, force-cancel
-- accrual, force-create referral) writes one row here so the
-- founder can review what overrides have been applied — and so an
-- accountant or auditor can reconcile the commission ledger.
--
-- This table is append-only from the application side. No UPDATE
-- or DELETE policies. Service-role writes only; founder-only read.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS admin_actions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The founder who performed the action. Required: every row has
  -- a real auth user behind it (the API rejects unauthenticated
  -- and non-founder callers before insert).
  actor_user_id    UUID NOT NULL REFERENCES user_profiles(id),

  -- Closed enum mirrored in lib/admin/overrides.ts. New action
  -- types require both a code change and a CHECK update (so a
  -- forgotten case here surfaces as a write error, not a silent
  -- drop).
  action           TEXT NOT NULL CHECK (action IN (
    'force_mark_threshold',
    'force_cancel_accrual',
    'force_create_referral'
  )),

  -- The table the action operated on, and the row id within it.
  -- Soft FK: stored as text + uuid, no constraint, so an action
  -- that retroactively created a row (force_create_referral)
  -- can record the new id even if a later GDPR delete blanks it.
  target_table     TEXT NOT NULL CHECK (target_table IN ('referrals', 'referral_commission_accruals')),
  target_id        UUID NOT NULL,

  -- Mandatory free-text reason. The API enforces a minimum length
  -- so the audit row is meaningful at review time. Spec §6.10:
  -- "All manual overrides are logged with the founder's user_id,
  -- timestamp, and override_reason in an admin_actions audit table."
  override_reason  TEXT NOT NULL CHECK (length(override_reason) >= 12),

  -- The full input payload the API received, for repro / debug.
  -- Includes the resolved field updates (so a future schema
  -- migration that renames a field still has the historical
  -- intent).
  payload          JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_actions_actor_recent
  ON admin_actions (actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_actions_target
  ON admin_actions (target_table, target_id);

CREATE INDEX IF NOT EXISTS idx_admin_actions_action_recent
  ON admin_actions (action, created_at DESC);

-- ─── Row-Level Security ───────────────────────────────────────
-- No client-side writes ever. Reads gated to founder-side server
-- code (which uses the service role anyway, bypassing RLS) plus
-- the actor themselves as a courtesy — useful for a future
-- "what overrides did I do last week" admin view without
-- service-role hops.

ALTER TABLE admin_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "actor self read" ON admin_actions;
CREATE POLICY "actor self read" ON admin_actions
  FOR SELECT USING (actor_user_id = auth.uid());
