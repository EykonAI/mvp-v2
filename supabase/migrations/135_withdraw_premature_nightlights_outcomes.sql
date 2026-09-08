-- 135 · Withdraw 85 night-lights outcomes judged on unpublished windows
--
-- WHAT HAPPENED. The first 85 night-lights claims (mig 128 families) issued at
-- 20:58-20:59 UTC on 2026-09-07 with resolves_at on the DATA clock: 08-26..
-- 08-30, already past on the wall clock, so they were due the moment they
-- were written. A score-predictions run at 21:04:57 UTC judged all 85 with
-- the resolver as it then stood, which had no data-clock guard: it queried
-- confident_clear nights in (period, end] while the sensor had published
-- only to 08-25 — and 08-25 itself was a partial night (#480). The guard
-- that prevents exactly this (#482) merged 75 minutes later.
--
-- WHAT WAS RECORDED, per family:
--   first_light persistence  73 · 16 VOID "publication lag" · 57 scored (22 true, 35 false)
--   went_dark_lights recovery 12 ·  4 VOID "publication lag" ·  8 scored ( 7 true,  1 false)
-- Every one of the 85 had a window end >= 08-25, i.e. unpublished at the
-- moment of judgement. A 7-day persistence decided from one to three nights
-- is not the claim that was made; a VOID whose own reason says "publication
-- lag" is "we have not looked yet" filed as "we looked".
--
-- WHY WITHDRAWAL IS THE HONEST REMEDY, AND WHAT IT DOES NOT TOUCH. The claims
-- are hashed and immutable and are not touched — predictions_register is not
-- in this migration. An OUTCOME is the record of a look, and these 85 looks
-- had not happened. Migration 120 set the precedent when the dark-contact
-- resolver filed 450 rows as "event row not found" for events that existed:
-- the outcomes were re-resolved, the claims stood. Same here. With the rows
-- gone, the claims return to the due queue and #482's resolver re-judges
-- each one only once the instrument has published a period strictly after
-- its window end — 08-27 onward as the Black Marble retry (#480) refills
-- 08-26..08-29 and NASA publishes 08-30/31 over the next days.
--
-- Nothing downstream snapshots these rows: no foreign key references
-- prediction_outcomes, the ledger aggregates (mig 124) and the family
-- calibration (mig 126) compute live from it, and materialiseSummary is
-- house-scoped. The machine-track family figures self-correct on delete.
--
-- Until this is applied, DO NOT QUOTE the night-lights family figures on the
-- ledger: they are 65 premature verdicts and 20 false voids.
--
-- IDEMPOTENT: the predicate is the single 21:04:57 tick on source='blackmarble';
-- a second run matches nothing.


-- ─────────────────────────────────────────────────────────────────────
-- STEP 1 — READ ONLY. Expect matched 85 · distinct_ticks 1 ·
-- tick 2026-09-07 21:04:57 · non_blackmarble 0 · window_was_published 0.
-- Anything else: STOP.
-- ─────────────────────────────────────────────────────────────────────
select count(*)                                           as matched,
       count(distinct o.observed_at)                      as distinct_ticks,
       min(o.observed_at)::text                           as tick,
       count(*) filter (where r.source <> 'blackmarble')  as non_blackmarble,
       count(*) filter (where ((r.context->>'flagged_period')::date
                               + (r.context->>'horizon_days')::int) < date '2026-08-25') as window_was_published
from prediction_outcomes o
join predictions_register r on r.id = o.prediction_id
where r.source = 'blackmarble'
  and o.observed_at < timestamptz '2026-09-07 22:30:00+00';


-- ─────────────────────────────────────────────────────────────────────
-- STEP 2 — THE WRITE. Expect DELETE 85.
-- ─────────────────────────────────────────────────────────────────────
begin;

delete from prediction_outcomes o
using predictions_register r
where r.id = o.prediction_id
  and r.source = 'blackmarble'
  and o.observed_at < timestamptz '2026-09-07 22:30:00+00';

commit;


-- ─────────────────────────────────────────────────────────────────────
-- STEP 3 — VERIFY. Expect night-lights outcomes 0, pending 104, and the
-- 85 back in the due queue (due_unscored rises by 85). They stay pending
-- under #482 until each window is published; none may be re-judged by
-- any tick before the data clock passes its end.
-- ─────────────────────────────────────────────────────────────────────
select
  (select count(*) from prediction_outcomes o join predictions_register r on r.id=o.prediction_id
    where r.source='blackmarble')                                                            as nightlights_outcomes,
  (select count(*) from predictions_register r left join prediction_outcomes o on o.prediction_id=r.id
    where r.source='blackmarble' and o.prediction_id is null)                                as nightlights_pending,
  (select due_unscored_predictions_count())                                                   as due_unscored_now;
