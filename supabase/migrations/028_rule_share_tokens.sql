-- ═══════════════════════════════════════════════════════════════
-- Migration 028 — Rule sharing (PR-NF-2)
--
-- Adds share_token + shared_at to user_notification_rules so the
-- owner can publish a redacted public view of one of their rules.
-- Pattern matches the existing share_token columns on user_queries
-- (migration 025) and user_notification_log (migration 023+025).
--
-- The application code in lib/share/index.ts owns token generation
-- (random + UNIQUE INDEX collision retry); the SQL helper
-- generate_share_token() is updated below to also exclude collisions
-- against the new column for parity with the existing helper, even
-- though no SQL caller invokes it on the rule path today.
--
-- RLS shape mirrors user_queries.share_token:
--   • Owner can SELECT/UPDATE their own rows (already covered by the
--     existing self-write policies on user_notification_rules from
--     migration 023; share_token + shared_at are simply additional
--     columns on rows the owner already controls).
--   • Public-share read happens via the service-role client in
--     /app/(public)/rule/[token]/page.tsx — no anon RLS path.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE UNIQUE INDEX IF NOT
-- EXISTS, CREATE OR REPLACE FUNCTION.
-- ═══════════════════════════════════════════════════════════════

-- ─── Columns ──────────────────────────────────────────────────
ALTER TABLE user_notification_rules
  ADD COLUMN IF NOT EXISTS share_token TEXT,
  ADD COLUMN IF NOT EXISTS shared_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_notification_rules_share_token
  ON user_notification_rules (share_token)
  WHERE share_token IS NOT NULL;

-- ─── Refresh the SQL helper to include the new table ──────────
-- The collision check now spans all three shareable artifact tables
-- (user_queries, user_notification_log, user_notification_rules).
-- App code in lib/share/index.ts generates tokens directly and
-- relies on UNIQUE INDEX collision detection, so this helper only
-- matters for any future SQL-side caller — keeping it in sync.

CREATE OR REPLACE FUNCTION generate_share_token()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  token TEXT;
  attempts INTEGER := 0;
BEGIN
  LOOP
    token := 's_' || encode(gen_random_bytes(8), 'hex');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM user_queries WHERE share_token = token
      UNION ALL
      SELECT 1 FROM user_notification_log WHERE share_token = token
      UNION ALL
      SELECT 1 FROM user_notification_rules WHERE share_token = token
    );
    attempts := attempts + 1;
    IF attempts > 20 THEN
      RAISE EXCEPTION 'Could not generate unique share token after 20 attempts';
    END IF;
  END LOOP;
  RETURN token;
END;
$$;
