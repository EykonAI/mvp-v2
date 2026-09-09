-- 150 · One claim per observable: the same-tick duplicates are VOIDED, and a
--       second machine claim for the same observable is refused at insert.
--
-- WHAT HAPPENED
-- -------------
-- The dark-contact issuer pages open events with .range() and, until #506,
-- no ORDER BY. Consecutive pages of an unordered relation are not disjoint:
-- the tick's own closes and opens shuffle the heap between page requests, so
-- the same open event could land in two pages. The register idempotency
-- check only knows about PREVIOUS ticks, so both copies were inserted in the
-- same batch — identical statement, observable, resolves_at, issued_at,
-- forecast and hash. Found 2026-09-09 10:10 UTC while verifying the first
-- cell-forecast tick (its 18 claims were 9 pairs).
--
-- MEASURED (read-only, 2026-09-09 10:30 UTC)
--   ais-darkgap rows 67,355 · distinct observables 58,423 · duplicated 8,932
--   all same-tick pairs (0 cross-tick, 0 triples), all identical hash
--   by day of issue: 09-01 1,816 · 09-06 3,858 · 09-07 2,619 · 09-08 240 · 09-09 399
--   duplicates already scored: 1,816 — machine n 46,936 as recorded vs
--   45,120 distinct; skill −0.199 as recorded vs −0.205 distinct
--   blackmarble 207/207 and firms-recovery 54/54: no duplicates
--
-- WHY VOID, NOT DELETE
-- --------------------
-- The register is append-only by trigger (mig 058): rows are never deleted.
-- A duplicate asserts nothing new — it is byte-identical to the kept row on
-- every audit field — so the honest treatment is VOID with a stated reason:
-- excluded from every skill figure, counted as void, auditable by public_id.
-- The kept row is the earliest (issued_at, id). Scored duplicates have their
-- outcome withdrawn (mig 135 precedent) and replaced by the void, so no
-- outcome is counted twice.
--
-- THE GUARD
-- ---------
-- A unique index cannot coexist with the historical pairs, so a BEFORE INSERT
-- trigger refuses a second machine-track row for the same (source,
-- target_observable). #506 already makes the issuer emit one candidate per
-- observable; the trigger is the backstop that turns any recurrence into a
-- loud insert error (the tick's run record carries it) instead of a silent
-- second claim. Apply AFTER #506 is live; applied earlier, the worst case is
-- one tick that issues nothing and says why.

BEGIN;

CREATE TEMP TABLE dup_claims ON COMMIT DROP AS
  SELECT r.id, r.public_id, k.keep_public_id
  FROM public.predictions_register r
  JOIN (
    SELECT target_observable,
           (array_agg(id        ORDER BY issued_at, id))[1] AS keep_id,
           (array_agg(public_id ORDER BY issued_at, id))[1] AS keep_public_id
    FROM public.predictions_register
    WHERE source = 'ais-darkgap'
    GROUP BY target_observable
    HAVING count(*) > 1
  ) k ON k.target_observable = r.target_observable
  WHERE r.source = 'ais-darkgap' AND r.id <> k.keep_id;

-- Scored duplicates: withdraw the outcome that duplicates the kept row's.
DELETE FROM public.prediction_outcomes o
 USING dup_claims d
 WHERE o.prediction_id = d.id;

-- Every duplicate: VOID, with the reason and the kept claim's public id.
INSERT INTO public.prediction_outcomes
  (prediction_id, observed_value, observed_at, brier, log_loss, calibration_bin, resolution_source_url, void_reason)
SELECT d.id, NULL, now(), NULL, NULL, NULL, '/intel/shadow-fleet',
       'duplicate_issuance: same-tick copy of ' || d.keep_public_id
       || ' (unordered paging, fixed in #506) — excluded, never scored'
FROM dup_claims d;

-- The guard.
CREATE INDEX IF NOT EXISTS idx_predictions_source_observable
  ON public.predictions_register (source, target_observable);

CREATE OR REPLACE FUNCTION public.enforce_one_claim_per_observable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.track = 'machine' AND EXISTS (
       SELECT 1 FROM public.predictions_register p
        WHERE p.source = NEW.source
          AND p.target_observable = NEW.target_observable) THEN
    RAISE EXCEPTION 'one claim per observable: % already carries a % claim',
      NEW.target_observable, NEW.source
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.enforce_one_claim_per_observable() IS
  'BEFORE INSERT guard (mig 150): a machine-track observable carries one claim per source, ever. Backstop for the issuer''s own dedupe (#506).';

DROP TRIGGER IF EXISTS trg_predictions_one_per_observable ON public.predictions_register;
CREATE TRIGGER trg_predictions_one_per_observable
  BEFORE INSERT ON public.predictions_register
  FOR EACH ROW EXECUTE FUNCTION public.enforce_one_claim_per_observable();

COMMIT;

-- STEP 1 — READ ONLY, run BEFORE applying (2026-09-09 10:30 UTC expectations):
--   SELECT count(*) AS dup_rows, count(o.prediction_id) AS already_scored
--   FROM (SELECT r.id FROM predictions_register r
--         JOIN (SELECT target_observable, (array_agg(id ORDER BY issued_at, id))[1] AS keep_id
--               FROM predictions_register WHERE source = 'ais-darkgap'
--               GROUP BY 1 HAVING count(*) > 1) k ON k.target_observable = r.target_observable
--         WHERE r.source = 'ais-darkgap' AND r.id <> k.keep_id) d
--   LEFT JOIN prediction_outcomes o ON o.prediction_id = d.id;
--   -- expect 8,932 · 1,816 (plus whatever ticks before #506 was live added; note the figure)
--
-- VERIFY, run AFTER applying (rows on screen, not the banner):
--   SELECT count(*) FROM prediction_outcomes WHERE void_reason LIKE 'duplicate_issuance%';
--   -- = the STEP 1 dup_rows figure
--   SELECT count(*) AS observables_with_two_live_rows
--   FROM (SELECT r.target_observable
--         FROM predictions_register r
--         LEFT JOIN prediction_outcomes o ON o.prediction_id = r.id AND o.void_reason LIKE 'duplicate_issuance%'
--         WHERE r.source = 'ais-darkgap' AND o.prediction_id IS NULL
--         GROUP BY 1 HAVING count(*) > 1) x;
--   -- 0
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.predictions_register'::regclass
--     AND tgname = 'trg_predictions_one_per_observable';                    -- one row
--   SELECT jsonb_pretty(calibration_ledger_tracks()->'tracks'->'machine'->'integrity');
--   -- void ≈ 8,934 (8,932 duplicates + the 2 cloud voids); issued = scored + void + pending still reconciles
