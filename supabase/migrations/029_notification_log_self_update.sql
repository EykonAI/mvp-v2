-- ═══════════════════════════════════════════════════════════════
-- Migration 029 — Self-update RLS policy on user_notification_log
--
-- Bug fix. user_notification_log was set up in migration 023 with RLS
-- enabled and a SELECT self-read policy only — no UPDATE policy. As
-- a result, /api/share/create's UPDATE on the user-scoped client
-- silently failed (0 rows affected, no error returned) and the route
-- handed back a candidate share_token that was never persisted to
-- the row. The public /notification/<token> page then 404'd because
-- no row matched the token in the database.
--
-- user_queries (migration 021) and user_notification_rules
-- (migration 023) both have the corresponding "self update" policy;
-- user_notification_log was simply missed. This migration restores
-- parity.
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY.
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "self update" ON user_notification_log;
CREATE POLICY "self update" ON user_notification_log
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
