-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 074 · Creator Pro
--
-- Phase 3 of the 2026-07-04 Monetisation Build-Prompt (review §4.3):
-- Creator Pro — $20/mo headline, FIRST 50 CREATORS FREE FOR LIFE.
-- NOT a platform tier: an orthogonal grant on top of any tier.
--
-- The integrity invariant (review §4.3, enforced across the app):
-- the Reputation Note itself is NEVER paywalled — everyone's score
-- stays public and free on-platform. Creator Pro sells distribution
-- and tooling on top of it (analytics dashboard, embeddable card,
-- Space branding, Discover priority).
--
-- Paid grants (source='paid', $200/yr via NOWPayments) are DEFERRED:
-- per the review's sequencing gate, billing switches on only at
-- ≥100 paid Space subscriptions across ≥5 Spaces — until then every
-- creator is inside the free-50 window by construction. The schema
-- supports paid grants now so no further migration is needed then.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS creator_pro_grants (
  user_id       UUID PRIMARY KEY REFERENCES user_profiles(id) ON DELETE CASCADE,
  source        TEXT NOT NULL CHECK (source IN ('free50','paid')),
  lifetime_free BOOLEAN NOT NULL DEFAULT FALSE,
  claimed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- NULL = never expires (all free50 grants); paid grants get
  -- claimed_at + 1 year when that flow opens.
  expires_at    TIMESTAMPTZ
);

-- Service-role only (COMM pattern): RLS on, no permissive policy.
ALTER TABLE creator_pro_grants ENABLE ROW LEVEL SECURITY;

-- ─── Race-safe free-50 claim ────────────────────────────────────
-- Two concurrent claims must not both take slot 50: the advisory
-- transaction lock serialises claimants, making count-then-insert
-- safe. Eligibility (owns ≥1 non-archived Space) is re-checked here
-- as defense-in-depth — the app checks it too, but the function is
-- the last line.
CREATE OR REPLACE FUNCTION claim_creator_pro_free_slot(p_user_id UUID)
RETURNS TABLE (claimed BOOLEAN, slots_left INTEGER) AS $$
DECLARE
  v_free_cap CONSTANT INTEGER := 50;
  v_taken INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('creator_pro_free50'));

  -- Idempotent: an existing grant (any source) just reports state.
  IF EXISTS (SELECT 1 FROM creator_pro_grants g WHERE g.user_id = p_user_id) THEN
    SELECT count(*)::INTEGER INTO v_taken FROM creator_pro_grants WHERE source = 'free50';
    RETURN QUERY SELECT TRUE, GREATEST(v_free_cap - v_taken, 0);
    RETURN;
  END IF;

  -- Eligibility: must own at least one non-archived Space.
  IF NOT EXISTS (
    SELECT 1 FROM comm_spaces s
    WHERE s.creator_id = p_user_id AND s.status <> 'archived'
  ) THEN
    RAISE EXCEPTION 'claim_creator_pro_free_slot: % owns no active Space', p_user_id;
  END IF;

  SELECT count(*)::INTEGER INTO v_taken FROM creator_pro_grants WHERE source = 'free50';
  IF v_taken >= v_free_cap THEN
    RETURN QUERY SELECT FALSE, 0;
    RETURN;
  END IF;

  INSERT INTO creator_pro_grants (user_id, source, lifetime_free)
  VALUES (p_user_id, 'free50', TRUE);

  RETURN QUERY SELECT TRUE, GREATEST(v_free_cap - v_taken - 1, 0);
END;
$$ LANGUAGE plpgsql;

-- ─── Space branding (Creator Pro growth tools) ──────────────────
ALTER TABLE comm_spaces
  ADD COLUMN IF NOT EXISTS accent_color TEXT
    CHECK (accent_color IS NULL OR accent_color ~ '^#[0-9a-fA-F]{6}$'),
  ADD COLUMN IF NOT EXISTS banner_url TEXT;
