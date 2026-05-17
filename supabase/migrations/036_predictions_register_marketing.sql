-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 036 · predictions_register marketing surface
--
-- Extends predictions_register (created in 003) with the four
-- columns the public Calibration Ledger needs to display and audit
-- predictions:
--
--   statement  — falsifiable single-sentence claim shown on cards
--   public_id  — shareable short token for /p/<public_id> URLs
--   source     — provenance: manual / polymarket / eia / ofac / kalshi / ai
--   hash       — SHA-256 audit hash binding the five issuance fields
--
-- Backfill is in-place; legacy rows get a synthesized placeholder
-- statement so NOT NULL can land. The JS-side hash helper lives at
-- apps/web/lib/predictions/hash.ts and MUST mirror the formula in
-- step 5 below. If you change one side, change both.
--
-- These four columns are frozen at insert time by convention — the
-- hash is only meaningful if statement / target_observable /
-- resolves_at / issued_at / predicted_distribution.mean never
-- change after issuance. Enforce at the application layer until a
-- trigger is warranted.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. Add columns nullable so backfill can land before NOT NULL ──
ALTER TABLE predictions_register
  ADD COLUMN IF NOT EXISTS statement TEXT,
  ADD COLUMN IF NOT EXISTS public_id TEXT,
  ADD COLUMN IF NOT EXISTS source    TEXT,
  ADD COLUMN IF NOT EXISTS hash      TEXT;

-- ─── 2. Backfill source — existing rows are manual seeds ──────────
UPDATE predictions_register
   SET source = 'manual'
 WHERE source IS NULL;

-- ─── 3. Backfill public_id — random 10-hex-char token ─────────────
UPDATE predictions_register
   SET public_id = 'p_' || encode(gen_random_bytes(5), 'hex')
 WHERE public_id IS NULL;

-- ─── 4. Backfill statement — feature + target_observable as a
--        readable placeholder. New rows MUST supply a real
--        human-readable statement (no DEFAULT). ────────────────────
UPDATE predictions_register
   SET statement = format('[backfill] %s prediction for %s', feature, target_observable)
 WHERE statement IS NULL;

-- ─── 5. Backfill hash. Canonical form (must match
--        apps/web/lib/predictions/hash.ts):
--          statement
--          || target_observable
--          || resolves_at as ISO-8601 UTC with millis
--          || issued_at  as ISO-8601 UTC with millis
--          || COALESCE(predicted_distribution->>'mean', '')
--        Timestamps forced to UTC so the hash is timezone-
--        independent and reproducible from any session. ────────────
UPDATE predictions_register
   SET hash = encode(
     sha256(
       (
         statement
         || target_observable
         || to_char(resolves_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
         || to_char(issued_at   AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
         || COALESCE(predicted_distribution->>'mean', '')
       )::bytea
     ),
     'hex'
   )
 WHERE hash IS NULL;

-- ─── 6. Enforce NOT NULL post-backfill ────────────────────────────
ALTER TABLE predictions_register
  ALTER COLUMN statement SET NOT NULL,
  ALTER COLUMN public_id SET NOT NULL,
  ALTER COLUMN source    SET NOT NULL,
  ALTER COLUMN hash      SET NOT NULL;

-- ─── 7. Defaults for future inserts (statement + hash supplied by
--        the caller; public_id + source default) ────────────────────
ALTER TABLE predictions_register
  ALTER COLUMN public_id SET DEFAULT 'p_' || encode(gen_random_bytes(5), 'hex'),
  ALTER COLUMN source    SET DEFAULT 'manual';

-- ─── 8. Source provenance whitelist ───────────────────────────────
ALTER TABLE predictions_register
  DROP CONSTRAINT IF EXISTS predictions_register_source_check;
ALTER TABLE predictions_register
  ADD  CONSTRAINT predictions_register_source_check
       CHECK (source IN ('manual','polymarket','eia','ofac','kalshi','ai'));

-- ─── 9. Unique index for the shareable lookup (/p/<public_id>) ────
CREATE UNIQUE INDEX IF NOT EXISTS uq_predictions_register_public_id
  ON predictions_register (public_id);

-- ─── 10. Index for the per-source resolver added in PR-CAL-5 ──────
CREATE INDEX IF NOT EXISTS idx_predictions_register_source
  ON predictions_register (source);
