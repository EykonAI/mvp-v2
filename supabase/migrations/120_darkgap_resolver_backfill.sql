-- 120 · Dark-contact resolver backfill
--
-- WHY
-- ---
-- The machine track's resolver looked its event row up by
--   .eq('gap_started_at', <target_observable's ISO timestamp>)
-- The observable is built with Date#toISOString() (MILLISECOND precision) while
-- dark_contact_events.gap_started_at is a timestamptz holding MICROSECONDS, so
-- the comparison missed by a few hundred microseconds and matched nothing.
-- After a 7-day grace the resolver recorded that miss as "event row not found"
-- and VOIDed the claim.
--
-- Measured on production 2026-09-06, before this migration:
--   * 450 claims voided with that reason
--   * 450 / 450 had their event row PRESENT and RESOLVED (280 reappeared, 170 still_dark)
--   * 0   were genuinely missing
--   * exact-timestamp match: 0/450 · second-truncated match: 450/450
--   * a further 34,081 overdue claims were in the same state, unresolved rather
--     than voided only because they had not yet aged past the grace window
--
-- VOID means "we did not look" — the platform's first directive. Here we looked,
-- the answer was there, and the resolver filed it as absence. These 450 rows are
-- fabricated voids on the one track whose job is to prove the instruments work.
--
-- Precedent for deleting rather than annotating: migration 103 deleted nine
-- poisoned chokepoint zeros written by a dead feed. Same class — a record the
-- instrument never actually observed — and prediction_outcomes is keyed on
-- prediction_id, so a row must be removed for the claim to resolve again.
--
-- The CODE fix ships in the same PR: the resolver now reads context.event_id,
-- the event's own uuid, present on 46,936 of 46,936 machine rows. Apply this
-- migration BEFORE merging, per the standing rule.

BEGIN;

-- 1 · Clear the fabricated voids so score-predictions can resolve them properly.
--     Scoped to the exact machine-generated reason string; a hand-written void or
--     a genuine coverage_lost void does not match and is left untouched.
--     Dry-run 2026-09-06 (SELECT form of this predicate): 450 rows, all with a
--     resolved event row, 0 that would void again.
DELETE FROM prediction_outcomes o
USING predictions_register r
WHERE r.id = o.prediction_id
  AND r.track = 'machine'
  AND r.source = 'ais-darkgap'
  AND o.void_reason LIKE 'event row not found for ais:dark_contact:%';

-- 2 · Server-side "due AND unscored", oldest first.
--     The cron previously fetched 500 due rows with no ORDER BY and discarded the
--     already-scored ones in JS. That cannot drain a backlog: as the scored share
--     rises the window fills with finished rows and throughput decays toward zero
--     precisely when the queue is longest. With 46,494 unscored due rows it is the
--     difference between completing the backfill and never completing it.
--     NOT EXISTS rides prediction_outcomes_pkey; the scan rides idx_predictions_resolves_at.
CREATE OR REPLACE FUNCTION public.due_unscored_predictions(p_limit integer DEFAULT 500)
RETURNS TABLE (
  id                     uuid,
  feature                text,
  source                 text,
  predicted_distribution jsonb,
  target_observable      text,
  resolves_at            timestamptz,
  issued_at              timestamptz,
  context                jsonb,
  persona                text
)
LANGUAGE sql
STABLE
AS $$
  SELECT r.id, r.feature, r.source, r.predicted_distribution, r.target_observable,
         r.resolves_at, r.issued_at, r.context, r.persona
  FROM predictions_register r
  WHERE r.resolves_at <= now()
    AND NOT EXISTS (
      SELECT 1 FROM prediction_outcomes o WHERE o.prediction_id = r.id
    )
  ORDER BY r.resolves_at
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 2000);
$$;

COMMENT ON FUNCTION public.due_unscored_predictions(integer) IS
  'Predictions past resolves_at with no outcome row, oldest first. Added by mig 120 so score-predictions can drain a backlog instead of re-reading finished rows.';

GRANT EXECUTE ON FUNCTION public.due_unscored_predictions(integer) TO service_role;

COMMIT;

-- VERIFY (run after):
--   SELECT count(*) FROM prediction_outcomes o JOIN predictions_register r ON r.id=o.prediction_id
--    WHERE r.source='ais-darkgap' AND o.void_reason LIKE 'event row not found%';   -- expect 0
--   SELECT count(*) FROM due_unscored_predictions(2000);                            -- expect 2000
