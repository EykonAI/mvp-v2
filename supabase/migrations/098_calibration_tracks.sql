-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 098 · Calibration tracks + VOID resolutions
--
-- From the Calibration Sensor Integration & Positioning Brief
-- (2026-08-04), §4. The same Brier machinery scores three populations
-- that must never blend:
--
--   machine — sensor observables. Thousands of auto-resolving claims;
--             answers "do our instruments work?", not "is anyone
--             smart?". Would drown the others by sheer volume: the
--             Note engine shrinks by sample size (n/(n+20)) precisely
--             so a lucky handful cannot read as skill, and a firehose
--             saturates that safeguard instantly.
--   house   — eYKON's own analytical forecasts. The BENCHMARK line,
--             never a ranked row among creators.
--   creator — human calls. The ONLY track that feeds the Reputation
--             Note, which gates paid Spaces.
--
-- Classification of the 37 existing rows is by EVIDENCE, not guess:
-- all of them were issued by feed-driven jobs (source ais / eia /
-- polymarket) rather than by a person composing a call, so all are
-- 'house'. Two carry a non-null author_id (source polymarket) and are
-- listed in the PR for a human decision; they stay 'house' until that
-- decision is made, because a row must never be back-filled into a
-- track it was not issued under.
--
-- VOID: prediction_outcomes gains void_reason. A claim whose outcome
-- could not be OBSERVED (cloud cover, unprocessed tile, unpublished
-- dataset) resolves VOID — excluded from scoring, never counted as a
-- win. Resolving "still dark" on missing data would let cloud cover
-- confirm every claim we make and the Brier would look superb. A void
-- row carries NULL brier / NULL log_loss and a stated reason.
--
-- Idempotent. Apply MANUALLY in the Supabase Dashboard → SQL Editor
-- BEFORE merging the PR (Railway auto-deploys main).
-- ═══════════════════════════════════════════════════════════════

-- ─── Track ──────────────────────────────────────────────────
ALTER TABLE predictions_register
  ADD COLUMN IF NOT EXISTS track TEXT NOT NULL DEFAULT 'house';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'predictions_register_track_check'
  ) THEN
    ALTER TABLE predictions_register
      ADD CONSTRAINT predictions_register_track_check
      CHECK (track IN ('machine', 'house', 'creator'));
  END IF;
END $$;

-- Explicit classification of what exists today. Written as an UPDATE
-- rather than relying on the column default so the intent is auditable
-- and re-running the migration cannot silently reclassify later rows.
UPDATE predictions_register
SET track = 'house'
WHERE track IS NULL
   OR (source IN ('ais', 'eia', 'polymarket') AND issued_at < '2026-08-05');

CREATE INDEX IF NOT EXISTS idx_predictions_track_resolves
  ON predictions_register (track, resolves_at DESC);

COMMENT ON COLUMN predictions_register.track IS
  'Scoring population: machine (sensor observables) | house (eYKON forecasts, benchmark) | creator (human calls, feeds the Reputation Note). NEVER blend: the Note must filter to creator, and the percentile population must exclude house and machine — a percentile is zero-sum, so a house row inside it would lower every creator ranking by arithmetic.';

-- ─── VOID resolutions ───────────────────────────────────────
ALTER TABLE prediction_outcomes
  ADD COLUMN IF NOT EXISTS void_reason TEXT;

COMMENT ON COLUMN prediction_outcomes.void_reason IS
  'Non-null = the claim could NOT be observed at resolution (no clear look, tile unprocessed, dataset unpublished). Void rows carry NULL brier and are excluded from every aggregate. Absence of an observation is never a win.';

CREATE INDEX IF NOT EXISTS idx_prediction_outcomes_observed
  ON prediction_outcomes (observed_at DESC);
