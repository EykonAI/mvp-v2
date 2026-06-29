-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 066 · COMM UX Uplift §3.2 · the Reputation Note
--
-- Adds the platform's single credibility score to the per-user rollup.
-- The compute-user-reputation cron now writes, on the feature='_all'
-- row only, a banded 0–100 Note plus its component breakdown:
--
--   reputation_note : 0–100 composite. NULL until the row is shown
--                     (n_resolved >= MIN_SAMPLE) — never a thin number.
--   band            : Calibrating | Unproven | Developing | Calibrated
--                     | Sharp | Oracle (derived from the Note + sample).
--   components       : JSONB breakdown — accuracy core, difficulty-
--                     weighted skill, coverage/recency gates, capped
--                     contribution — so the score is auditable, not opaque.
--
-- Inherits the existing user_reputation RLS (public read only when
-- shown=true), so the Note never leaks before it is earned. Per-domain
-- rows leave these columns NULL.
--
-- Additive. Apply MANUALLY in the Supabase SQL Editor BEFORE merge —
-- the cron and the profile loader select these columns once deployed.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE user_reputation
  ADD COLUMN IF NOT EXISTS reputation_note INT
    CHECK (reputation_note IS NULL OR reputation_note BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS band TEXT
    CHECK (band IS NULL OR band IN
      ('calibrating','unproven','developing','calibrated','sharp','oracle')),
  ADD COLUMN IF NOT EXISTS components JSONB;
