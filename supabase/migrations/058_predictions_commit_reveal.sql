-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 058 · Reputation Engine (§9) A1 · commit-reveal + integrity
--
-- Foundation for user-authored, sealed predictions:
--   • commit_hash / nonce / visibility / revealed_at / baseline_mean
--   • an append-only immutability trigger (audit fields frozen; the
--     integrity hashes are set-once; only visibility/revealed_at may
--     change, committed → revealed)
--   • predictions_public — a view that withholds the plaintext of a
--     still-sealed ('committed') call until the author reveals it.
--
-- Non-breaking: verified that NO existing flow UPDATEs or DELETEs
-- predictions_register (issue-* only INSERT; score-predictions only
-- SELECTs it). Additive; apply MANUALLY in the Supabase SQL Editor
-- BEFORE merge. The JS commit-hash helper is lib/predictions/hash.ts
-- (computeCommitHash) — keep the canonical form in sync.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE predictions_register
  ADD COLUMN IF NOT EXISTS commit_hash   TEXT,   -- SHA256(canonical || nonce), sealed calls
  ADD COLUMN IF NOT EXISTS nonce         TEXT,   -- server-held secret; never exposed pre-reveal
  ADD COLUMN IF NOT EXISTS visibility    TEXT NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS revealed_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS baseline_mean NUMERIC; -- reference forecast captured AT issuance

ALTER TABLE predictions_register DROP CONSTRAINT IF EXISTS predictions_register_visibility_check;
ALTER TABLE predictions_register
  ADD CONSTRAINT predictions_register_visibility_check
  CHECK (visibility IN ('public','committed','revealed'));

-- ─── Append-only audit trail ──────────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_prediction_immutability()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    RAISE EXCEPTION 'predictions_register is append-only (id=%): delete denied', OLD.id;
  END IF;

  -- Hard-frozen: the call content never changes after insert.
  IF NEW.statement            IS DISTINCT FROM OLD.statement
     OR NEW.target_observable IS DISTINCT FROM OLD.target_observable
     OR NEW.resolves_at       IS DISTINCT FROM OLD.resolves_at
     OR NEW.issued_at         IS DISTINCT FROM OLD.issued_at
     OR (NEW.predicted_distribution->>'mean') IS DISTINCT FROM (OLD.predicted_distribution->>'mean')
     OR NEW.author_id         IS DISTINCT FROM OLD.author_id THEN
    RAISE EXCEPTION 'predictions_register row % is immutable on audit fields', OLD.id;
  END IF;

  -- Set-once: integrity fields go NULL→value once (e.g. hash at reveal)
  -- and can never change thereafter.
  IF (OLD.hash          IS NOT NULL AND NEW.hash          IS DISTINCT FROM OLD.hash)
     OR (OLD.commit_hash   IS NOT NULL AND NEW.commit_hash   IS DISTINCT FROM OLD.commit_hash)
     OR (OLD.nonce         IS NOT NULL AND NEW.nonce         IS DISTINCT FROM OLD.nonce)
     OR (OLD.baseline_mean IS NOT NULL AND NEW.baseline_mean IS DISTINCT FROM OLD.baseline_mean) THEN
    RAISE EXCEPTION 'predictions_register row % integrity field is set-once', OLD.id;
  END IF;

  RETURN NEW;  -- visibility / revealed_at MAY change (committed → revealed)
END $$;

DROP TRIGGER IF EXISTS trg_predictions_immutable ON predictions_register;
CREATE TRIGGER trg_predictions_immutable
  BEFORE UPDATE OR DELETE ON predictions_register
  FOR EACH ROW EXECUTE FUNCTION enforce_prediction_immutability();

-- ─── Public read surface — withholds sealed plaintext until reveal ─
-- A still-'committed' call exposes only its commit_hash + metadata to
-- anyone but the author; statement / probability / context are NULL
-- until reveal. nonce is never selected here.
CREATE OR REPLACE VIEW predictions_public AS
SELECT
  id, public_id, author_id, feature, source, visibility,
  target_observable, resolves_at, issued_at, target_window_hours, persona,
  hash, commit_hash, revealed_at, baseline_mean,
  CASE WHEN visibility = 'committed' AND author_id IS DISTINCT FROM auth.uid()
       THEN NULL ELSE statement END             AS statement,
  CASE WHEN visibility = 'committed' AND author_id IS DISTINCT FROM auth.uid()
       THEN NULL ELSE predicted_distribution END AS predicted_distribution,
  CASE WHEN visibility = 'committed' AND author_id IS DISTINCT FROM auth.uid()
       THEN NULL ELSE context END               AS context
FROM predictions_register;

ALTER VIEW public.predictions_public SET (security_invoker = true);
