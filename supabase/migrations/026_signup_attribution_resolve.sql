-- ═══════════════════════════════════════════════════════════════
-- Migration 026 — Resolve eykon_ref into referred_by at signup +
--                 finalise pending attribution at first paid conversion
--
-- Two extensions to the referral data model from migration 025:
--
--   1. handle_new_user (originally created in 007) is updated to also
--      read the new eykon_ref value from raw_user_meta_data and
--      resolve it via user_profiles.public_id (added in 025) into
--      the existing referred_by UUID FK. The legacy referral_code
--      path stays unchanged and takes priority — first-touch is the
--      cookie's job, the trigger just respects whichever metadata
--      key is set.
--
--   2. A new BEFORE UPDATE trigger on user_profiles fires on tier
--      transitions out of 'citizen'. It sets first_paid_at on the
--      first such transition and finalises any referred_by_pending
--      pointer into the existing referred_by FK. Centralising this
--      in a trigger means every path that promotes a user to paid
--      (NOWPayments IPN now, Lemon Squeezy IPN later, manual admin
--      override, anything else) gets the finalisation for free.
--
-- Idempotent: every CREATE OR REPLACE; trigger guarded by DROP IF
-- EXISTS. Matches the project convention from 007 / 023.
-- ═══════════════════════════════════════════════════════════════

-- ─── handle_new_user: extend to resolve eykon_ref ──────────────

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  ref_by UUID := NULL;
  ref_code_input TEXT;
  eykon_ref_input TEXT;
BEGIN
  -- Path 1: legacy ?ref=eyk-<8 chars> (Rewardful Day-1 capture).
  -- Resolves via user_profiles.referral_code.
  ref_code_input := NEW.raw_user_meta_data->>'referral_code';
  IF ref_code_input IS NOT NULL AND ref_code_input <> '' THEN
    SELECT id INTO ref_by
    FROM user_profiles
    WHERE referral_code = ref_code_input
    LIMIT 1;
  END IF;

  -- Path 2: ?ref=u_<10 hex> (Component A from migration 025).
  -- Only consulted if path 1 did not resolve. Resolves via
  -- user_profiles.public_id.
  IF ref_by IS NULL THEN
    eykon_ref_input := NEW.raw_user_meta_data->>'eykon_ref';
    IF eykon_ref_input IS NOT NULL AND eykon_ref_input <> '' THEN
      SELECT id INTO ref_by
      FROM user_profiles
      WHERE public_id = eykon_ref_input
      LIMIT 1;
    END IF;
  END IF;

  INSERT INTO user_profiles (
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
    generate_referral_code(),
    ref_by
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger binding from 007 stays in place; CREATE OR REPLACE FUNCTION
-- has already swapped the body underneath it.

-- ─── First-paid conversion: set first_paid_at + finalise pending ─

CREATE OR REPLACE FUNCTION handle_first_paid_conversion()
RETURNS TRIGGER AS $$
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

    -- Finalise pending attribution (spec §1.3 step 7). Copies
    -- referred_by_pending → referred_by only if referred_by is
    -- still null (first-touch on the FK wins; the same rule the
    -- pending pointer already enforced).
    IF NEW.referred_by IS NULL AND NEW.referred_by_pending IS NOT NULL THEN
      SELECT id INTO NEW.referred_by
      FROM user_profiles
      WHERE public_id = NEW.referred_by_pending
      LIMIT 1;
    END IF;

    -- Clear the pending pointer either way — it has served its
    -- purpose. If the lookup failed (referrer deleted), the pointer
    -- is dropped; the user converts unattributed, which matches
    -- spec §1.4 ATTRIBUTION TO A DELETED OR BANNED USER.
    NEW.referred_by_pending := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS first_paid_conversion ON user_profiles;
CREATE TRIGGER first_paid_conversion
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW
  WHEN (OLD.tier IS DISTINCT FROM NEW.tier)
  EXECUTE FUNCTION handle_first_paid_conversion();
