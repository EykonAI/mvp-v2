-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 059 · Reputation Engine (§9) A2 · per-user reputation rollup
--
-- Materialised by the compute-user-reputation cron from
-- prediction_outcomes joined to predictions_register (author_id, mig
-- 055). feature='_all' aggregates across domains; other rows are
-- per-domain. A row stays hidden (shown=false) until n_resolved >=
-- MIN_SAMPLE, so no thin record ever surfaces a score. Public read is
-- limited to shown rows.
--
-- Additive; apply MANUALLY before merge. After applying, add the
-- compute-user-reputation cron in the Railway dashboard (hand-off).
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS user_reputation (
  author_id        UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  feature          TEXT NOT NULL DEFAULT '_all',   -- '_all' = across domains
  n_issued         INT  NOT NULL DEFAULT 0,
  n_resolved       INT  NOT NULL DEFAULT 0,
  brier            NUMERIC,
  brier_skill      NUMERIC,            -- 1 − Σbrier / Σbrier(baseline); the headline
  log_loss         NUMERIC,
  coverage_ratio   NUMERIC,            -- resolved / issued (penalises abandoned calls)
  rank_percentile  NUMERIC,            -- 0..1 within the feature cohort (1 = best)
  last_resolved_at TIMESTAMPTZ,
  shown            BOOLEAN NOT NULL DEFAULT FALSE,  -- false until n_resolved >= MIN_SAMPLE
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (author_id, feature)
);

ALTER TABLE user_reputation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_reputation_public_read ON user_reputation;
CREATE POLICY user_reputation_public_read ON user_reputation
  FOR SELECT USING (shown = true);   -- thin records stay private
