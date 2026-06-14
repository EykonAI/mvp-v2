-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 055 · COMM user profile: public social fields
--
-- Phase 1 of the COMM User Profile Page (BACKEND/COMM brief). Extends
-- the EXISTING user_profiles with the public, pseudonymous social
-- fields a /u/<handle> page needs, exposes them through a
-- security-invoker view that withholds every private/billing column,
-- and adds the author_id link on predictions_register — the §9
-- Reputation Engine reconciliation: predictions are authored by a
-- user_profiles row, NOT a separate comm_profiles table.
--
-- Additive and idempotent. Apply MANUALLY in the Supabase SQL Editor
-- BEFORE merging — Railway auto-deploys main. The page is also gated
-- behind COMM_PROFILES_ENABLED, so nothing renders until BOTH this
-- migration is applied AND the flag is flipped.
-- ═══════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS citext;

-- 1 · public social columns on the existing profile table ───────────
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS handle             CITEXT,
  ADD COLUMN IF NOT EXISTS bio                TEXT,
  ADD COLUMN IF NOT EXISTS links              JSONB   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS cover_url          TEXT,
  ADD COLUMN IF NOT EXISTS profile_visibility TEXT    NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS reputation_opt_in  BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_visibility_check;
ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_visibility_check
  CHECK (profile_visibility IN ('public','members','private'));

-- handle is unique & case-insensitive (citext); most rows stay NULL
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_profiles_handle
  ON user_profiles (handle);

-- 2 · public read surface — only non-sensitive columns. email, tier,
--     billing refs, referral codes are NEVER selected here. Read it
--     instead of the base table for anything public-facing.
CREATE OR REPLACE VIEW public_profiles AS
SELECT
  id,
  handle,
  display_name,
  avatar_url,
  cover_url,
  bio,
  links,
  preferred_persona,
  public_id,
  created_at,
  (advocate_onboarded_at IS NOT NULL AND advocate_terminated_at IS NULL)
    AS is_founding_analyst
FROM user_profiles
WHERE profile_visibility <> 'private';

-- security_invoker so the querying role's RLS applies (matches migration 051).
ALTER VIEW public.public_profiles SET (security_invoker = true);

-- 3 · §9 reconciliation — a prediction is authored by a user_profiles
--     row (NULL = house/system call, back-compat with existing rows).
ALTER TABLE predictions_register
  ADD COLUMN IF NOT EXISTS author_id UUID REFERENCES user_profiles(id);
CREATE INDEX IF NOT EXISTS idx_predictions_author
  ON predictions_register (author_id, resolves_at);
