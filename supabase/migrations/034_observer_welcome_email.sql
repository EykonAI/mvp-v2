-- ═══════════════════════════════════════════════════════════════
-- Migration 034 — Observer welcome email tracking (PR-OBS-7)
--
-- Adds a single timestamp column on user_profiles so the welcome-email
-- cron can find users who have confirmed their address but haven't
-- yet received the welcome email, and so the same user is never
-- emailed twice.
--
-- The cron logic (apps/web/app/api/cron/welcome-observer-users) is:
--
--   SELECT user_id
--   FROM user_profiles up
--   JOIN auth.users au ON au.id = up.id
--   WHERE au.email_confirmed_at IS NOT NULL
--     AND au.email_confirmed_at <= NOW() - INTERVAL '5 minutes'
--     AND up.welcome_email_sent_at IS NULL;
--
-- On send success, set welcome_email_sent_at = NOW().
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS welcome_email_sent_at TIMESTAMPTZ;

-- Partial index so the cron query (welcome_email_sent_at IS NULL) is
-- O(unwelcomed) rather than O(all-users). Once a user is welcomed
-- their row drops out of this index forever.
CREATE INDEX IF NOT EXISTS idx_user_profiles_unwelcomed
  ON user_profiles (id)
  WHERE welcome_email_sent_at IS NULL;
