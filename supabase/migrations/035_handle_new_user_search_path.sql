-- ═══════════════════════════════════════════════════════════════
-- Migration 035 — handle_new_user: explicit search_path (hotfix)
--
-- Symptom (2026-05-12 17:25 UTC, all auth callbacks):
--   Auth log: "500: Database error saving new user"
--   Postgres log: "relation \"user_profiles\" does not exist
--                  (SQLSTATE 42P01)"
--
-- Cause: handle_new_user is SECURITY DEFINER but had no explicit
-- SET search_path. Recent Supabase / Postgres hardening sets the
-- search_path for SECURITY DEFINER functions to empty by default
-- so an attacker can't shadow trusted objects with same-named
-- temp objects. The unqualified `user_profiles` references inside
-- the trigger now resolve against an empty search_path → 42P01.
--
-- The same latent bug existed in the function definitions from
-- 001 / 007 — those worked previously only because the calling
-- session's search_path happened to include `public`.
--
-- Fix:
--   • SET search_path = public, auth, pg_temp on the function.
--   • Fully qualify every table reference as public.* (belt-and-
--     braces; defends against future search_path tightening).
--   • Apply the same treatment to generate_referral_code(), which
--     handle_new_user calls.
--
-- Idempotent: CREATE OR REPLACE. No data migration. The trigger
-- binding from 007 stays in place.
-- ═══════════════════════════════════════════════════════════════

-- ─── generate_referral_code: explicit search_path + qualified refs ──
CREATE OR REPLACE FUNCTION generate_referral_code()
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  alphabet TEXT := 'abcdefghjkmnpqrstuvwxyz23456789';
  code TEXT;
  i INTEGER;
  attempts INTEGER := 0;
BEGIN
  LOOP
    code := 'eyk-';
    FOR i IN 1..8 LOOP
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE referral_code = code);
    attempts := attempts + 1;
    IF attempts > 20 THEN
      RAISE EXCEPTION 'Could not generate unique referral code after 20 attempts';
    END IF;
  END LOOP;
  RETURN code;
END;
$$;

-- ─── handle_new_user: explicit search_path + qualified refs ─────────
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  ref_by UUID := NULL;
  ref_code_input TEXT;
  eykon_ref_input TEXT;
BEGIN
  -- Path 1: legacy ?ref=eyk-<8 chars> (Rewardful Day-1 capture).
  ref_code_input := NEW.raw_user_meta_data->>'referral_code';
  IF ref_code_input IS NOT NULL AND ref_code_input <> '' THEN
    SELECT id INTO ref_by
    FROM public.user_profiles
    WHERE referral_code = ref_code_input
    LIMIT 1;
  END IF;

  -- Path 2: ?ref=u_<10 hex> (Component A from migration 025).
  IF ref_by IS NULL THEN
    eykon_ref_input := NEW.raw_user_meta_data->>'eykon_ref';
    IF eykon_ref_input IS NOT NULL AND eykon_ref_input <> '' THEN
      SELECT id INTO ref_by
      FROM public.user_profiles
      WHERE public_id = eykon_ref_input
      LIMIT 1;
    END IF;
  END IF;

  INSERT INTO public.user_profiles (
    id,
    email,
    display_name,
    referral_code,
    referred_by
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    public.generate_referral_code(),
    ref_by
  );
  RETURN NEW;
END;
$$;

-- Trigger binding from 007 stays in place; CREATE OR REPLACE FUNCTION
-- swapped the body underneath it.
