-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 052 · user_profiles digest state (persona + opt-out)
--
-- Foundation for the zero-config persona digest email
-- (/api/cron/send-digests, builder lib/notifications/digest.ts).
--
--   preferred_persona        — server-side persona, so a cron can
--     tailor the digest. Persona was previously client-only
--     (localStorage 'eykon.persona'); POST /api/profile/persona now
--     persists it on selection. Backfilled here from the user's most
--     recent notification rule where one exists. NULL ⇒ generalist
--     (top signals across all domains) — never blocks the digest.
--   last_digest_sent_at      — idempotency anchor, mirrors
--     welcome_email_sent_at. The cron skips users sent within the
--     window so a re-run can't double-send.
--   digest_unsubscribe_token — opaque 'd_'+hex, one per user, powers
--     the RFC-8058 one-click unsubscribe
--     (POST /api/digest/unsubscribe/<token>). Mirrors the
--     generate_share_token() style (migrations 025/028). Visibility is
--     governed by the existing owner-only RLS on user_profiles; the
--     unsubscribe route reads it via the service role.
--
-- Opt-out STATE lives in the existing notification_preferences JSONB
-- as the key `digest_opted_out` (added on demand by the unsubscribe
-- route — loose JSONB, no column needed). The cron skips users whose
-- email_enabled=false OR digest_opted_out=true.
--
-- Idempotent. Apply MANUALLY in the Supabase Dashboard → SQL Editor.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. Columns ───────────────────────────────────────────────
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS preferred_persona        TEXT,
  ADD COLUMN IF NOT EXISTS last_digest_sent_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS digest_unsubscribe_token TEXT;

-- ─── 2. Backfill one unsubscribe token per existing user ──────
-- gen_random_bytes() comes from pgcrypto (already used by
-- generate_share_token in migration 025).
UPDATE user_profiles
  SET digest_unsubscribe_token = 'd_' || encode(gen_random_bytes(8), 'hex')
  WHERE digest_unsubscribe_token IS NULL;

-- New rows get a token automatically. A 64-bit value makes collision
-- negligible; the unique index below is the backstop.
ALTER TABLE user_profiles
  ALTER COLUMN digest_unsubscribe_token
  SET DEFAULT ('d_' || encode(gen_random_bytes(8), 'hex'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_digest_unsub_token
  ON user_profiles (digest_unsubscribe_token);

-- ─── 3. Backfill preferred_persona from existing rules ────────
-- Each user's most-recently-created rule persona is the best available
-- server signal today (only ~1 user has rules; everyone else stays
-- NULL → generalist).
UPDATE user_profiles p
  SET preferred_persona = r.persona
  FROM (
    SELECT DISTINCT ON (user_id) user_id, persona
    FROM user_notification_rules
    WHERE persona IS NOT NULL
    ORDER BY user_id, created_at DESC
  ) r
  WHERE r.user_id = p.id
    AND p.preferred_persona IS NULL;
