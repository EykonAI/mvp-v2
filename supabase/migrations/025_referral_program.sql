-- ═══════════════════════════════════════════════════════════════
-- Migration 025 — Referral program (two-component) + share-token foundation
--
-- Lays the schema for the referral program specified in
-- /docs/Referral Program brief (April 2026):
--
--   Component A — silent attribution mechanic
--     ?ref=u_<public_id> on every shareable artifact is captured into
--     a 90-day first-party cookie; on signup the cookie is read and
--     the raw public_id is parked on user_profiles.referred_by_pending;
--     at first paid conversion the pending pointer is finalised into
--     the existing user_profiles.referred_by UUID FK (added in 007).
--
--   Component B — founder advocate program
--     Hand-curated. Eligible advocates earn 50% commission for 24
--     months on each referred user's subscription revenue, gated by
--     a 60-consecutive-paid-day threshold and capped at 30 referrals
--     per calendar year (above-cap step-down to 35%).
--
-- This migration is additive only:
--   • user_profiles gains public_id (opaque, indexed, backfilled),
--     referred_by_pending, advocate_* lifecycle columns, rewardful
--     affiliate id, first_paid_at.
--   • user_profiles.referred_by (added in 007 as UUID FK) is unchanged
--     — ?ref= and ?via= both resolve into it via first-touch-wins.
--   • user_queries and user_notification_log gain share_token + shared_at
--     for the explicit per-share opt-in described in PRs 4 + 5.
--   • Four new tables: referrals, referral_commission_accruals,
--     advocate_submissions, attribution_events.
--
-- RLS: all four new tables are RLS-enabled. Advocates can SELECT their
-- own commissioned rows; submitters can SELECT their own submission;
-- attribution_events is service-role-only. Writes happen server-side
-- via the service role — there are no self-INSERT/UPDATE/DELETE
-- policies on the four new tables. The public-share read path on
-- user_queries / user_notification_log uses the service role too,
-- matching the export-by-id pattern documented in 021.
--
-- Idempotent: every CREATE uses IF NOT EXISTS; policies are guarded
-- with DROP POLICY IF EXISTS, matching migrations 007 / 021 / 023.
-- ═══════════════════════════════════════════════════════════════

-- ─── Helper: opaque share-token generator ──────────────────────
-- Returns 's_' + 16 hex chars (64 bits of entropy). Retries on
-- collision against either user_queries or user_notification_log
-- with a hard cap of 20. Application code calls this when the
-- owner clicks Share on a query or notification fire.

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
    );
    attempts := attempts + 1;
    IF attempts > 20 THEN
      RAISE EXCEPTION 'Could not generate unique share token after 20 attempts';
    END IF;
  END LOOP;
  RETURN token;
END;
$$;

-- ─── user_profiles: public_id (opaque referrer identifier) ─────
-- 'u_' + 10 hex chars (40 bits of entropy). Spec §1.2 specifies
-- 'u_' + 8-12 char base32; Postgres' built-in encode() does not
-- support base32, so we use hex which fits the 8-12 char window
-- and yields the same enumeration-resistance + URL-safety property.
-- Backfill before flipping to NOT NULL so existing rows survive.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS public_id TEXT;

UPDATE user_profiles
  SET public_id = 'u_' || encode(gen_random_bytes(5), 'hex')
  WHERE public_id IS NULL;

ALTER TABLE user_profiles
  ALTER COLUMN public_id SET NOT NULL,
  ALTER COLUMN public_id SET DEFAULT 'u_' || encode(gen_random_bytes(5), 'hex');

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_public_id_unique
  ON user_profiles (public_id);

-- ─── user_profiles: pending attribution + advocate lifecycle ───

ALTER TABLE user_profiles
  -- Holds the raw referrer public_id ('u_...') captured from the
  -- eykon_ref cookie at signup OR while the user is on free tier.
  -- Resolved to the existing referred_by UUID FK at first paid
  -- conversion, then nulled.
  ADD COLUMN IF NOT EXISTS referred_by_pending TEXT,

  -- Advocate state machine (spec §2.2). 'none' is the default for
  -- every existing user; transitions are manual through the founder
  -- admin panel (PR 6).
  ADD COLUMN IF NOT EXISTS advocate_state TEXT NOT NULL DEFAULT 'none'
    CHECK (advocate_state IN ('none','invited','active','paused','terminated')),
  ADD COLUMN IF NOT EXISTS advocate_invited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS advocate_onboarded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS advocate_terminated_at TIMESTAMPTZ,

  -- Returned by Rewardful POST /v1/affiliates on advocate onboarding
  -- (PR 7). Until set, the advocate exists in eYKON but cannot earn
  -- commission — the trigger logic (PR 7) guards on this.
  ADD COLUMN IF NOT EXISTS rewardful_affiliate_id TEXT,

  -- Set the first time the user transitions out of 'citizen'. Drives
  -- the commission_window start anchor and pairs with the existing
  -- tier field as the live paying-state signal — there is no separate
  -- subscription_status column in this codebase; tier IN
  -- ('pro','desk','enterprise') is the paying signal the streak
  -- counter (PR 8) reads.
  ADD COLUMN IF NOT EXISTS first_paid_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_rewardful_affiliate_id
  ON user_profiles (rewardful_affiliate_id)
  WHERE rewardful_affiliate_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_profiles_advocate_state
  ON user_profiles (advocate_state)
  WHERE advocate_state <> 'none';

-- ─── Share-token columns on existing artifact tables ───────────
-- Owners click Share on a query or fire → server-side handler calls
-- generate_share_token(), writes both columns. The public route
-- reads by share_token via the service role and renders a redacted
-- view (PRs 4 + 5). NULL until the owner shares; nullable forever
-- so revocation is just an UPDATE to NULL.

ALTER TABLE user_queries
  ADD COLUMN IF NOT EXISTS share_token TEXT,
  ADD COLUMN IF NOT EXISTS shared_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_queries_share_token
  ON user_queries (share_token)
  WHERE share_token IS NOT NULL;

ALTER TABLE user_notification_log
  ADD COLUMN IF NOT EXISTS share_token TEXT,
  ADD COLUMN IF NOT EXISTS shared_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_notification_log_share_token
  ON user_notification_log (share_token)
  WHERE share_token IS NOT NULL;

-- ─── referrals (one row per commission relationship) ───────────

CREATE TABLE IF NOT EXISTS referrals (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Both FKs are NO ACTION on delete: per spec §6.9 GDPR deletion
  -- anonymises rather than removes the row, so referrals survive.
  -- A hard delete that would orphan a referral row is blocked by
  -- the FK constraint, which is the right safety net for an
  -- accounting-grade table.
  advocate_user_id            UUID NOT NULL REFERENCES user_profiles(id),
  referred_user_id            UUID NOT NULL REFERENCES user_profiles(id),

  attributed_at               TIMESTAMPTZ NOT NULL,
  -- = MAX(referred_user.first_paid_at, advocate.advocate_onboarded_at).
  commissioned_from           TIMESTAMPTZ NOT NULL,
  -- Persisted (not a generated column) so a future change to the
  -- 24-month window for new referrals does not retroactively shift
  -- existing rows.
  commission_window_ends_at   TIMESTAMPTZ NOT NULL,

  commission_rate             NUMERIC(4,3) NOT NULL
    CHECK (commission_rate IN (0.350, 0.500)),
  commission_duration_months  INTEGER NOT NULL DEFAULT 24,

  -- 60-day threshold tracking (spec §2.5).
  paid_days_streak            INTEGER NOT NULL DEFAULT 0,
  threshold_satisfied         BOOLEAN NOT NULL DEFAULT FALSE,
  threshold_satisfied_at      TIMESTAMPTZ,
  threshold_required_days     INTEGER NOT NULL DEFAULT 60,

  is_above_annual_cap         BOOLEAN NOT NULL DEFAULT FALSE,

  -- Set TRUE by the heuristic in spec §6.1 (IP-hash + device-fp
  -- match between referred and advocate at signup). Surfaces in the
  -- founder admin for manual review; does not block accrual.
  self_referral_suspected     BOOLEAN NOT NULL DEFAULT FALSE,

  pending_commission_cents    BIGINT NOT NULL DEFAULT 0,
  released_commission_cents   BIGINT NOT NULL DEFAULT 0,

  -- Returned by Rewardful POST /v1/referrals when the threshold is
  -- satisfied (PR 8). Until set, no commissions can be released.
  rewardful_referral_id       TEXT UNIQUE,

  status                      TEXT NOT NULL DEFAULT 'pre_threshold'
    CHECK (status IN ('pre_threshold','active','expired','cancelled')),

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (advocate_user_id, referred_user_id)
);

CREATE INDEX IF NOT EXISTS idx_referrals_advocate
  ON referrals (advocate_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred
  ON referrals (referred_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_status
  ON referrals (status);
-- The daily streak job (PR 8) scans this slice every run.
CREATE INDEX IF NOT EXISTS idx_referrals_threshold_pending
  ON referrals (advocate_user_id)
  WHERE threshold_satisfied = FALSE AND status <> 'cancelled';

-- ─── referral_commission_accruals (per-month per-referral) ─────

CREATE TABLE IF NOT EXISTS referral_commission_accruals (
  id                                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id                              UUID NOT NULL REFERENCES referrals(id) ON DELETE CASCADE,

  -- First day of the month this accrual covers.
  accrual_month                            DATE NOT NULL,

  referred_user_subscription_revenue_cents BIGINT NOT NULL,
  commission_rate                          NUMERIC(4,3) NOT NULL,
  commission_amount_cents                  BIGINT NOT NULL,

  state                                    TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','released','forfeited')),
  released_at                              TIMESTAMPTZ,
  forfeited_at                             TIMESTAMPTZ,
  forfeited_reason                         TEXT,

  rewardful_commission_id                  TEXT UNIQUE,

  created_at                               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (referral_id, accrual_month)
);

CREATE INDEX IF NOT EXISTS idx_accruals_referral
  ON referral_commission_accruals (referral_id);
CREATE INDEX IF NOT EXISTS idx_accruals_state
  ON referral_commission_accruals (state);

-- ─── advocate_submissions (inbound applications) ───────────────

CREATE TABLE IF NOT EXISTS advocate_submissions (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  full_name                     TEXT NOT NULL,
  primary_handle                TEXT NOT NULL,
  professional_context          TEXT NOT NULL,
  network_description           TEXT NOT NULL,
  why_eykon                     TEXT NOT NULL,
  preferred_contact_email       TEXT NOT NULL,

  -- NULL when the submitter is anonymous.
  submitting_user_id            UUID REFERENCES user_profiles(id) ON DELETE SET NULL,

  status                        TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','reviewing','accepted','declined','spam')),
  spam_flagged                  BOOLEAN NOT NULL DEFAULT FALSE,
  spam_reason                   TEXT,

  reviewed_by                   UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  reviewed_at                   TIMESTAMPTZ,
  review_notes                  TEXT,

  resulted_in_advocate_user_id  UUID REFERENCES user_profiles(id) ON DELETE SET NULL,

  submitted_from_ip             INET,
  user_agent                    TEXT,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_advocate_submissions_status
  ON advocate_submissions (status);
CREATE INDEX IF NOT EXISTS idx_advocate_submissions_email
  ON advocate_submissions (preferred_contact_email);
-- Per-IP rate limit (spec §3.3) hits this.
CREATE INDEX IF NOT EXISTS idx_advocate_submissions_ip_recent
  ON advocate_submissions (submitted_from_ip, created_at DESC);

-- ─── attribution_events (every ?ref= capture) ──────────────────

CREATE TABLE IF NOT EXISTS attribution_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Raw public_id of the referrer. NOT enforced as a FK because the
  -- referrer's row may have been deleted between share and capture;
  -- the analytics queries (spec §1.6) treat unresolvable values as
  -- orphan rows.
  referrer_public_id    TEXT NOT NULL,
  -- A1..A8 from spec §1.1.
  artifact_type         TEXT NOT NULL,
  artifact_id           TEXT NOT NULL,
  -- Anonymous session id; populated by the capture handler in PR 2.
  recipient_session_id  TEXT,
  -- Set when the recipient is authenticated at capture time.
  recipient_user_id     UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  -- SHA-256 of the IP, never the raw IP.
  ip_hash               TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attribution_events_referrer
  ON attribution_events (referrer_public_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attribution_events_artifact
  ON attribution_events (artifact_type, artifact_id);

-- ─── Row-Level Security ───────────────────────────────────────
-- All four new tables are RLS-enabled. Writes are server-side only
-- via the service role; the policies below grant only the per-row
-- read paths the spec calls for.

ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "advocate self read" ON referrals;
CREATE POLICY "advocate self read" ON referrals
  FOR SELECT USING (advocate_user_id = auth.uid());

ALTER TABLE referral_commission_accruals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "advocate self read" ON referral_commission_accruals;
CREATE POLICY "advocate self read" ON referral_commission_accruals
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM referrals r
      WHERE r.id = referral_commission_accruals.referral_id
        AND r.advocate_user_id = auth.uid()
    )
  );

ALTER TABLE advocate_submissions ENABLE ROW LEVEL SECURITY;

-- Submitters can see their own row only when they were authenticated
-- at submission time. Anonymous submissions are not readable from the
-- client. The founder reviews submissions through the admin panel,
-- which uses the service role (PR 6).
DROP POLICY IF EXISTS "self read submission" ON advocate_submissions;
CREATE POLICY "self read submission" ON advocate_submissions
  FOR SELECT USING (
    submitting_user_id IS NOT NULL
    AND submitting_user_id = auth.uid()
  );

-- attribution_events is service-role only — no client SELECT.
-- With RLS enabled and no policies defined, all non-service-role
-- access is denied by default.
ALTER TABLE attribution_events ENABLE ROW LEVEL SECURITY;
