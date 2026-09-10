-- 156 · A cohort watch proof is "complete" only when every claim is judged.
--
-- WHAT WENT WRONG (2026-09-09 23:26:50 UTC)
-- ------------------------------------------
-- The mig-147 proof kind `cohort_complete` tested bool_and(resolves_at <= now())
-- — every deadline passed — and nothing else. The scorer judges 500 claims per
-- hourly tick, so the 09-06 machine cohort was "complete" from 23:01 while
-- 586 of its 8,243 live claims were scored. The evaluator's 23:23 tick marked
-- the watch item SEEN, stored a partial skill of −0.177 as its evidence and
-- posted [SEEN] to Discord. Same defect as #513 / #514 fixed on the charts and
-- the headline; this file fixes the proof and reopens the item.
--
-- ALSO CORRECTED: the item's text attributed the 09-06 cohort to the #470 box
-- rule. #470 merged 2026-09-07 13:48 UTC. The 09-06 cohort was issued by the
-- first #465 tick after the shadow-fleet cron restart (#466): 12,101 claims in
-- one burst, every one at the family rate (sharpness 0.000). The first pure
-- box-rule cohort is 09-08 (938 claims); the first cell-forecast cohort is
-- 09-10. The expectation on the record is corrected accordingly.

BEGIN;

CREATE OR REPLACE FUNCTION public.ledger_watch_prove(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  k    text := p->>'kind';
  n    bigint; n2 bigint; t timestamptz; b numeric; base numeric; ok boolean; ev jsonb; want int;
BEGIN
  IF k = 'outcome_exists' THEN
    SELECT count(*), min(o.observed_at), count(*) FILTER (WHERE o.void_reason IS NOT NULL) INTO n, t, n2
      FROM public.prediction_outcomes o JOIN public.predictions_register r ON r.id = o.prediction_id
     WHERE r.source = p->>'source';
    RETURN jsonb_build_object('proven', n >= COALESCE((p->>'min_n')::int, 1),
             'evidence', jsonb_build_object('source', p->>'source', 'outcomes', n, 'void', n2, 'first_observed_at', t));
  ELSIF k = 'family_scored_n' THEN
    SELECT count(*), avg(o.brier), avg(o.observed_value) INTO n, b, base
      FROM public.prediction_outcomes o JOIN public.predictions_register r ON r.id = o.prediction_id
     WHERE r.feature = p->>'feature' AND o.void_reason IS NULL AND o.brier IS NOT NULL;
    RETURN jsonb_build_object('proven', n >= COALESCE((p->>'min_n')::int, 10),
             'evidence', jsonb_build_object('feature', p->>'feature', 'scored', n, 'brier', round(b, 4),
                                            'skill', CASE WHEN base * (1 - base) > 0.001 THEN round(1 - b / (base * (1 - base)), 4) END));
  ELSIF k = 'cohort_complete' THEN
    -- mig 156: complete = every deadline passed AND every claim judged (scored
    -- or void). The 09-06 item flipped SEEN at 23:26 UTC on 2026-09-09 with 586
    -- of 8,243 live claims scored, because deadlines alone were the test.
    SELECT count(*), bool_and(r.resolves_at <= now()),
           count(o.prediction_id) FILTER (WHERE o.void_reason IS NULL AND o.brier IS NOT NULL),
           avg(o.brier) FILTER (WHERE o.void_reason IS NULL AND o.brier IS NOT NULL),
           avg(o.observed_value) FILTER (WHERE o.void_reason IS NULL AND o.brier IS NOT NULL),
           count(*) FILTER (WHERE o.prediction_id IS NULL)
      INTO n, ok, n2, b, base, want
      FROM public.predictions_register r LEFT JOIN public.prediction_outcomes o ON o.prediction_id = r.id
     WHERE COALESCE(r.track, 'house') = p->>'track' AND (r.issued_at AT TIME ZONE 'UTC')::date = (p->>'day')::date;
    RETURN jsonb_build_object('proven', n > 0 AND COALESCE(ok, false) AND COALESCE(want, 0) = 0,
             'evidence', jsonb_build_object('track', p->>'track', 'day', p->>'day', 'issued', n, 'complete', COALESCE(ok, false),
                                            'open', COALESCE(want, 0), 'judged', COALESCE(want, 0) = 0,
                                            'scored', n2, 'brier', round(b, 4),
                                            'skill', CASE WHEN base * (1 - base) > 0.001 THEN round(1 - b / (base * (1 - base)), 4) END));
  ELSIF k = 'nights_judged_after_ingest' THEN
    want := jsonb_array_length(p->'nights');
    SELECT count(*), bool_and(COALESCE(d.judged_at >= i.ran_at, false)),
           jsonb_object_agg(i.night, jsonb_build_object('judged_at', d.judged_at, 'ingest_ran_at', i.ran_at))
      INTO n, ok, ev
      FROM jsonb_array_elements_text(p->'nights') AS x(night)
      JOIN public.blackmarble_ingest_runs i ON i.night = x.night::date
      LEFT JOIN public.nightlights_detect_runs d ON d.night = i.night;
    RETURN jsonb_build_object('proven', n = want AND COALESCE(ok, false), 'evidence', COALESCE(ev, '{}'::jsonb) || jsonb_build_object('nights_found', n, 'nights_wanted', want));
  ELSIF k = 'issuance_run_exists' THEN
    SELECT count(*), max(ran_at) INTO n, t FROM public.issuance_runs WHERE source = p->>'source';
    RETURN jsonb_build_object('proven', n > 0, 'evidence', jsonb_build_object('source', p->>'source', 'runs', n, 'newest', t));
  ELSIF k = 'alert_cleared' THEN
    SELECT count(*), max(at) INTO n, t FROM public.ledger_alert_events WHERE alert_id = p->>'alert_id' AND transition = 'cleared';
    RETURN jsonb_build_object('proven', n > 0, 'evidence', jsonb_build_object('alert_id', p->>'alert_id', 'cleared', n, 'last_cleared_at', t));
  ELSIF k = 'scorer_voided' THEN
    SELECT count(*), max(ran_at) INTO n, t FROM public.score_predictions_runs WHERE voided >= COALESCE((p->>'min_voided')::int, 1);
    RETURN jsonb_build_object('proven', n > 0, 'evidence', jsonb_build_object('ticks_with_voids', n, 'newest', t));
  ELSIF k = 'chokepoint_daily_admissible' THEN
    -- mig 152: the daily chokepoint question is admitted by its own walk-forward, never by a click.
    ev := public.chokepoint_daily_walkforward(
            COALESCE((p->>'since')::date, DATE '2026-08-24'), 14, 10, 0.35,
            COALESCE((p->>'min_pooled')::int, 90), COALESCE((p->>'min_strait')::int, 20));
    RETURN jsonb_build_object('proven', COALESCE((ev->>'admissible')::boolean, false),
             'evidence', jsonb_build_object('pooled', ev->'pooled', 'straits', ev->'straits', 'rule', ev->>'rule', 'as_of', ev->>'as_of'));
  END IF;
  RETURN jsonb_build_object('proven', false, 'evidence', jsonb_build_object('error', 'unknown proof kind: ' || COALESCE(k, 'null')));
END;
$$;

-- Reopen the item that flipped early, with the corrected expectation.
UPDATE public.ledger_watch_items
   SET seen_at = NULL, evidence = NULL, checked_at = NULL,
       due_at = '2026-09-10 20:00+00'::timestamptz,
       text = 'First post-restart machine cohort (issued 09-06 in one burst by the #465 tick, family-rate forecasts, sharpness 0 — NOT the #470 box rule, which landed 09-07 13:48) is fully judged — expect negative skill from the burst''s low reappearance rate; the first pure box-rule cohort is 09-08, the first cell-forecast cohort 09-10'
 WHERE id = 3 AND proof->>'kind' = 'cohort_complete' AND proof->>'day' = '2026-09-06';

COMMIT;

-- STEP 1 — READ ONLY, before applying (2026-09-10 08:2x UTC expectations):
--   SELECT id, seen_at, evidence->>'scored' AS scored_when_seen FROM ledger_watch_items WHERE id = 3;
--   -- seen_at 2026-09-09 23:26:50 · scored_when_seen 586  (the false SEEN)
--
-- VERIFY, after applying (rows on screen):
--   SELECT ledger_watch_prove('{"kind":"cohort_complete","track":"machine","day":"2026-09-01"}'::jsonb);
--   -- proven true · open 0 · judged true · scored 1826 · skill −0.0441
--   SELECT ledger_watch_prove('{"kind":"cohort_complete","track":"machine","day":"2026-09-06"}'::jsonb)->>'proven';
--   -- false until the last of its claims is judged (~18:00 UTC 2026-09-10), then true
--   SELECT id, seen_at, checked_at, due_at, left(text, 60) FROM ledger_watch_items WHERE id = 3;
--   -- seen_at NULL · checked_at NULL · due 2026-09-10 20:00 · the corrected text
--   SELECT public.ledger_watch_check();   -- item 3 checked, not proven; evidence shows open > 0
