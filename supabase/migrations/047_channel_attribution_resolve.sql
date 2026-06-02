-- ═══════════════════════════════════════════════════════════════
-- Migration 047 — Resolve eykon_channel into acquisition_channel at
--                 signup + finalise it at first paid conversion
--
-- The channel-attribution mirror of migration 026 (which did the same
-- for referred_by). Two CREATE OR REPLACE extensions to the existing
-- triggers; the trigger BINDINGS (handle_new_user from 007, the
-- first_paid_conversion trigger from 026) stay in place — replacing the
-- function bodies swaps the logic underneath them.
--
--   1. handle_new_user — additionally reads eykon_channel from
--      raw_user_meta_data (forwarded by the signup page from the
--      eykon_channel cookie) and parks it on the new row's
--      acquisition_channel_pending. The referral paths (referral_code,
--      eykon_ref) are UNCHANGED.
--
--   2. handle_first_paid_conversion — on the first transition out of
--      'citizen' it finalises acquisition_channel_pending →
--      acquisition_channel (first-touch wins, only if acquisition_channel
--      is still NULL), then clears the pending pointer. This is the same
--      single choke-point every paid path already flows through for
--      referred_by, so no new payment hooks are added.
--
-- IMPORTANT — both bodies below are reproduced from the LIVE function
-- definitions (pg_get_functiondef), not from the 026 file: migration
-- 035 added `SET search_path TO 'public','auth','pg_temp'` and schema-
-- qualified the calls in handle_new_user. That hardening is preserved
-- here verbatim; only the channel lines are new.
--
-- Idempotent: CREATE OR REPLACE on both. Apply MANUALLY in the Supabase
-- Dashboard → SQL Editor AFTER 046 (it depends on the acquisition_*
-- columns 046 adds).
-- ═══════════════════════════════════════════════════════════════

-- ─── handle_new_user: also park the first-touch channel ─────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  ref_by UUID := NULL;
  ref_code_input TEXT;
  eykon_ref_input TEXT;
  channel_input TEXT;
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

  -- Channel (PAMS, migration 046): the eykon_channel cookie is forwarded
  -- by the signup page into raw_user_meta_data. It was already validated
  -- against the canonical list by the middleware before the cookie was
  -- set, so we only normalise + sanity-cap here. Parked on the pending
  -- pointer; finalised at first paid conversion (first-touch wins).
  channel_input := lower(trim(NEW.raw_user_meta_data->>'eykon_channel'));
  IF channel_input = '' OR length(channel_input) > 32 THEN
    channel_input := NULL;
  END IF;

  INSERT INTO public.user_profiles (
    id,
    email,
    display_name,
    referral_code,
    referred_by,
    acquisition_channel_pending
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    public.generate_referral_code(),
    ref_by,
    channel_input
  );
  RETURN NEW;
END;
$function$;

-- ─── First-paid conversion: finalise pending channel ───────────

CREATE OR REPLACE FUNCTION public.handle_first_paid_conversion()
RETURNS TRIGGER AS $function$
BEGIN
  -- Fires only when tier transitions from 'citizen' to a paid tier
  -- for the first time. The WHEN clause on the trigger ensures we
  -- only run when tier actually changes; we still guard inside the
  -- function for the 'paid → paid' edge cases (e.g. plan upgrades).
  IF NEW.tier <> 'citizen'
     AND (OLD.tier IS NULL OR OLD.tier = 'citizen')
  THEN
    -- Anchor for the 24-month commission window (spec §2.1). Once
    -- set, never overwritten — a user who lapses and re-pays keeps
    -- their original first_paid_at.
    IF NEW.first_paid_at IS NULL THEN
      NEW.first_paid_at := NOW();
    END IF;

    -- Finalise pending REFERRAL attribution (spec §1.3 step 7). Copies
    -- referred_by_pending → referred_by only if referred_by is still
    -- null (first-touch on the FK wins; the same rule the pending
    -- pointer already enforced).
    IF NEW.referred_by IS NULL AND NEW.referred_by_pending IS NOT NULL THEN
      SELECT id INTO NEW.referred_by
      FROM user_profiles
      WHERE public_id = NEW.referred_by_pending
      LIMIT 1;
    END IF;
    NEW.referred_by_pending := NULL;

    -- Finalise pending CHANNEL attribution (PAMS, migration 046). Unlike
    -- referred_by there is no FK lookup — the channel tag is the value
    -- itself — so we just copy it across, first-touch wins (only if
    -- acquisition_channel is still null), then clear the pending pointer.
    -- After this, paid revenue is attributable to the originating
    -- channel via user_profiles.acquisition_channel.
    IF NEW.acquisition_channel IS NULL AND NEW.acquisition_channel_pending IS NOT NULL THEN
      NEW.acquisition_channel := NEW.acquisition_channel_pending;
    END IF;
    NEW.acquisition_channel_pending := NULL;
  END IF;
  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;
