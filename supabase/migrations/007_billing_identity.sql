-- ═══════════════════════════════════════════════════════════════
-- Migration 007 — Billing identity extension for user_profiles
-- Adds tier, billing_cycle, founding_rate_locked, referral_code,
-- referred_by, Lemon Squeezy + NOWPayments customer refs, lifetime
-- purchase timestamp, and verified_discount_type. Updates the
-- handle_new_user trigger to generate a unique referral code and
-- resolve a referrer from user_metadata.
--
-- Safe to re-run (ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE).
-- ═══════════════════════════════════════════════════════════════

-- ─── Columns ────────────────────────────────────────────────
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'citizen'
    CHECK (tier IN ('citizen','pro','desk','enterprise')),
  ADD COLUMN IF NOT EXISTS billing_cycle TEXT
    CHECK (billing_cycle IN ('monthly','annual','lifetime')),
  ADD COLUMN IF NOT EXISTS founding_rate_locked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES user_profiles(id),
  ADD COLUMN IF NOT EXISTS ls_customer_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS ls_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS nowpayments_customer_ref TEXT,
  ADD COLUMN IF NOT EXISTS lifetime_purchased_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_discount_type TEXT
    CHECK (verified_discount_type IN ('journalist','nonprofit','academic'));

-- ─── Referral code generator ────────────────────────────────
-- Returns a unique eyk-<8 char> code. Excludes visually ambiguous
-- characters (0/O, 1/l/I). Retries on collision with a hard cap.
CREATE OR REPLACE FUNCTION generate_referral_code()
RETURNS TEXT AS $$
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
    EXIT WHEN NOT EXISTS (SELECT 1 FROM user_profiles WHERE referral_code = code);
    attempts := attempts + 1;
    IF attempts > 20 THEN
      RAISE EXCEPTION 'Could not generate unique referral code after 20 attempts';
    END IF;
  END LOOP;
  RETURN code;
END;
$$ LANGUAGE plpgsql;

-- ─── Backfill existing users without a referral code ────────
UPDATE user_profiles
SET referral_code = generate_referral_code()
WHERE referral_code IS NULL;

-- ─── Updated handle_new_user trigger ────────────────────────
-- On signup, populate referral_code and resolve referred_by from
-- the `referral_code` key in raw_user_meta_data (set by frontend
-- from the ?ref= URL param or Rewardful cookie).
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  ref_by UUID := NULL;
  ref_code_input TEXT;
BEGIN
  ref_code_input := NEW.raw_user_meta_data->>'referral_code';
  IF ref_code_input IS NOT NULL AND ref_code_input <> '' THEN
    SELECT id INTO ref_by
    FROM user_profiles
    WHERE referral_code = ref_code_input
    LIMIT 1;
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ─── Indexes ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_user_profiles_referral_code
  ON user_profiles (referral_code);
CREATE INDEX IF NOT EXISTS idx_user_profiles_tier
  ON user_profiles (tier);
CREATE INDEX IF NOT EXISTS idx_user_profiles_ls_customer
  ON user_profiles (ls_customer_id)
  WHERE ls_customer_id IS NOT NULL;
