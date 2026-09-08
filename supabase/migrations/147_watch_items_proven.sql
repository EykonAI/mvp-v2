-- 147 · Watch items proven by SQL — a row flips PENDING → SEEN because a
--       predicate held, not because someone clicked.
--
-- Panel ⑥ of the monitor (mig 138) lists what the founder expects to see
-- next. Until now an item became SEEN by hand. Build-prompt §5 ⑥ said: "An
-- item flips PENDING → SEEN only when a row proves it." This makes the proof
-- a column. Each item may carry `proof`, a jsonb of a FIXED kind with
-- parameters — never free SQL, which would be dynamic execution of stored
-- text as postgres — and ledger_watch_prove() evaluates the kind with a
-- CASE over queries that already exist elsewhere in this ledger:
--   outcome_exists            {source, min_n?}      an outcome row exists for a source
--   family_scored_n           {feature, min_n}      a family has n scored (void excluded)
--   cohort_complete           {track, day}          every claim issued that day is past deadline
--   nights_judged_after_ingest {nights: [dates]}    each night's detect run is newer than its ingest run
--   issuance_run_exists       {source}              an issuer has recorded a tick (mig 138)
--   alert_cleared             {alert_id}            a 'cleared' transition exists (mig 141)
--   scorer_voided             {min_voided?}         a scorer tick voided claims
-- ledger_watch_check() runs every unproven item's predicate, sets seen_at
-- and stores the evidence (the numbers that proved it), and returns what it
-- newly proved; the hourly evaluator calls it after the alert rules and
-- posts each newly seen item to the same webhook. Items without a proof stay
-- manual. Read-only predicates, service_role only.
--
-- Read on 2026-09-08 17:25 UTC, the four seeded items against these
-- predicates: nights 08-25/26 judged 13:08 after ingest 09:52/09:55 → TRUE;
-- firms-recovery outcomes 0 → false; machine cohort 09-06: 12,101 issued,
-- complete false; first_light scored 36 of 100 → false. STEP 2 therefore
-- proves exactly one item on apply.

-- STEP 1 — READ ONLY. Expect the four items with seen_at NULL and no proof column yet.
SELECT id, left(text, 70) AS text, seen_at, due_at FROM public.ledger_watch_items ORDER BY id;

-- STEP 2 — THE CHANGE.
BEGIN;

ALTER TABLE public.ledger_watch_items
  ADD COLUMN IF NOT EXISTS proof      jsonb,
  ADD COLUMN IF NOT EXISTS evidence   jsonb,
  ADD COLUMN IF NOT EXISTS checked_at timestamptz;

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
    SELECT count(*), bool_and(r.resolves_at <= now()),
           count(o.prediction_id) FILTER (WHERE o.void_reason IS NULL AND o.brier IS NOT NULL),
           avg(o.brier) FILTER (WHERE o.void_reason IS NULL AND o.brier IS NOT NULL),
           avg(o.observed_value) FILTER (WHERE o.void_reason IS NULL AND o.brier IS NOT NULL)
      INTO n, ok, n2, b, base
      FROM public.predictions_register r LEFT JOIN public.prediction_outcomes o ON o.prediction_id = r.id
     WHERE COALESCE(r.track, 'house') = p->>'track' AND (r.issued_at AT TIME ZONE 'UTC')::date = (p->>'day')::date;
    RETURN jsonb_build_object('proven', n > 0 AND COALESCE(ok, false),
             'evidence', jsonb_build_object('track', p->>'track', 'day', p->>'day', 'issued', n, 'complete', COALESCE(ok, false),
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
  END IF;
  RETURN jsonb_build_object('proven', false, 'evidence', jsonb_build_object('error', 'unknown proof kind: ' || COALESCE(k, 'null')));
END;
$$;

CREATE OR REPLACE FUNCTION public.ledger_watch_check()
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  it      record;
  res     jsonb;
  checked integer := 0;
  proven  integer := 0;
  newly   jsonb   := '[]'::jsonb;
BEGIN
  FOR it IN SELECT id, text, proof FROM public.ledger_watch_items WHERE proof IS NOT NULL AND seen_at IS NULL ORDER BY id LOOP
    res := public.ledger_watch_prove(it.proof);
    checked := checked + 1;
    IF COALESCE((res->>'proven')::boolean, false) THEN
      UPDATE public.ledger_watch_items SET seen_at = now(), evidence = res->'evidence', checked_at = now() WHERE id = it.id;
      proven := proven + 1;
      newly := newly || jsonb_build_object('id', it.id, 'text', it.text, 'evidence', res->'evidence');
    ELSE
      UPDATE public.ledger_watch_items SET evidence = res->'evidence', checked_at = now() WHERE id = it.id;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('checked', checked, 'proven', proven, 'newly_seen', newly, 'at', now());
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ledger_watch_prove(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ledger_watch_check()     FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ledger_watch_prove(jsonb) TO service_role;
GRANT  EXECUTE ON FUNCTION public.ledger_watch_check()     TO service_role;

-- The four seeded items get their proofs (matched by text, not id).
UPDATE public.ledger_watch_items SET proof = '{"kind":"nights_judged_after_ingest","nights":["2026-08-25","2026-08-26"]}'::jsonb
 WHERE proof IS NULL AND text LIKE 'Nights 08-25 and 08-26 re-judged%';
UPDATE public.ledger_watch_items SET proof = '{"kind":"outcome_exists","source":"firms-recovery"}'::jsonb
 WHERE proof IS NULL AND text LIKE 'First FIRMS recovery claims resolve%';
UPDATE public.ledger_watch_items SET proof = '{"kind":"cohort_complete","track":"machine","day":"2026-09-06"}'::jsonb
 WHERE proof IS NULL AND text LIKE 'First #470 box-conditioned machine cohort%';
UPDATE public.ledger_watch_items SET proof = '{"kind":"family_scored_n","feature":"nightlights_first_light_persistence","min_n":100}'::jsonb
 WHERE proof IS NULL AND text LIKE 'Night-lights families reach%';

COMMIT;

-- The first check — applying this migration proves the re-judge item.
-- Expect checked 4 · proven 1 · newly_seen the nights item with judged_at
-- 13:08 after ingest 09:52/09:55.
SELECT public.ledger_watch_check();

-- STEP 3 — VERIFY. Expect four rows with a proof, one seen (nights), three
-- pending with evidence stating why not yet (outcomes 0; complete false;
-- scored 36 of 100); anon false on both functions.
SELECT id, left(text, 50) AS text, proof->>'kind' AS kind, seen_at IS NOT NULL AS seen, evidence, checked_at FROM public.ledger_watch_items ORDER BY id;
SELECT has_function_privilege('anon', 'public.ledger_watch_check()', 'EXECUTE') AS anon_can_check,
       has_function_privilege('service_role', 'public.ledger_watch_check()', 'EXECUTE') AS service_role_can_check;
