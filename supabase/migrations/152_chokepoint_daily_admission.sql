-- 152 · The daily chokepoint question: an ADMISSION INSTRUMENT, not a family.
--
-- WHY
-- ---
-- The house chokepoint family issues one weekly claim per strait: 29 scored
-- claims in 3.5 months, forecasts averaging 0.515, skill −0.04. A daily
-- 1-day-ahead question ("tomorrow's 00:34 UTC snapshot exceeds the trailing
-- 28-day mean") would give the house track three claims a day. Measured
-- 2026-09-09 on the full history (124 evaluable days): base 0.653 (in band),
-- persistence of yesterday's sign +0.046 walk-forward, running base −0.100,
-- day-of-week −0.41, the weekly momentum logic applied daily −0.38.
--
-- AND THEN IT FAILED THE STABILITY TEST. A per-strait gate on the trailing
-- 45-day walk-forward skill anti-selects: when ON, realised skill was −0.026
-- (suez, 29 days) and −1.07 (malacca, 6 days); when OFF it would have been
-- +0.25 / +0.29. The reason is in the instrument, not the model: the AIS
-- coverage step change of 2026-08-24 lifted every strait's counts (bosphorus
-- 27 → 41, malacca 878 → 1,025, suez 194 → 245 a day) and the 08-06 → 08-16
-- outage distorted the middle, so "above the trailing mean" was trivially
-- true through the transitions — which is where the +0.046 came from. Only
-- post-step days are one instrument, and there are 14–17 per strait: 46
-- covered rows, 0 evaluable days on 2026-09-09.
--
-- So the family is NOT admitted. This file installs the measurement that
-- admits it, on the mig-126 principle that a family is admitted by evidence
-- it cannot influence:
--   · chokepoint_daily_walkforward(): the walk-forward, recomputed on every
--     read, post-step covered rows only, persistence fitted on prior days
--     only, split-half stability, per strait and pooled, with an
--     `admissible` verdict under a stated rule;
--   · a watch-item proof kind (mig 147 mechanism) that flips the seeded item
--     to SEEN when the rule holds — then, and only then, the daily family is
--     built.
--
-- THE RULE (in the function's own output): pooled evaluable days >= 90 and
-- pooled walk-forward skill > 0 in BOTH halves; a strait is admitted only
-- with n >= 20 and its own skill > 0 (bosphorus reads negative on every test
-- so far). On today's cadence — three straits, snapshots at 00:34 UTC, 14
-- covered rows behind each baseline, 10 evaluable days behind each estimate —
-- the first verdict that can be positive falls in early November 2026.

BEGIN;

CREATE OR REPLACE FUNCTION public.chokepoint_daily_walkforward(
  p_since        date    DEFAULT DATE '2026-08-24',  -- the AIS coverage step change; earlier rows are another instrument
  p_min_baseline integer DEFAULT 14,                 -- covered rows behind the 28-day mean (the weekly issuer's floor)
  p_min_prior    integer DEFAULT 10,                 -- evaluable days behind a walk-forward estimate
  p_thin_ratio   numeric DEFAULT 0.35,               -- mig 148: below this share of the trailing 14-day median a snapshot is partial coverage
  p_min_pooled   integer DEFAULT 90,                 -- admission: pooled evaluable days
  p_min_strait   integer DEFAULT 20                  -- admission: a strait joins with n >= this and its own skill > 0
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
WITH o AS (
  SELECT chokepoint, period, vessel_count::numeric AS c
  FROM ais_chokepoint_observations
  WHERE period >= p_since AND chokepoint <> 'hormuz'
),
cov AS (
  SELECT o.*,
    (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY p.c) FROM o p
      WHERE p.chokepoint = o.chokepoint AND p.period < o.period AND p.period >= o.period - 14) AS med14,
    (SELECT count(*) FROM o p
      WHERE p.chokepoint = o.chokepoint AND p.period < o.period AND p.period >= o.period - 14) AS n14
  FROM o
),
covered AS (
  SELECT chokepoint, period, c FROM cov WHERE NOT (n14 >= 5 AND c < p_thin_ratio * med14)
),
feat AS (
  SELECT chokepoint, period, c,
    avg(c)   OVER (PARTITION BY chokepoint ORDER BY period ROWS BETWEEN 28 PRECEDING AND 1 PRECEDING) AS m28,
    count(c) OVER (PARTITION BY chokepoint ORDER BY period ROWS BETWEEN 28 PRECEDING AND 1 PRECEDING) AS n28,
    lag(c)   OVER (PARTITION BY chokepoint ORDER BY period) AS c_prev
  FROM covered
),
lab AS (
  SELECT *, (c > m28)::int AS y, (c_prev > m28)::int AS y_prev
  FROM feat WHERE n28 >= p_min_baseline AND c_prev IS NOT NULL
),
-- Walk-forward: every estimate uses PRIOR days of the same strait only.
wf AS (
  SELECT l.*,
    (SELECT avg(y)   FROM lab p WHERE p.chokepoint = l.chokepoint AND p.period < l.period) AS p_base,
    (SELECT avg(y)   FROM lab p WHERE p.chokepoint = l.chokepoint AND p.period < l.period AND p.y_prev = l.y_prev) AS p_persist,
    (SELECT count(*) FROM lab p WHERE p.chokepoint = l.chokepoint AND p.period < l.period) AS n_prior
  FROM lab l
),
ev AS (
  SELECT *, coalesce(p_persist, p_base) AS f,
    ntile(2) OVER (PARTITION BY chokepoint ORDER BY period) AS half,
    ntile(2) OVER (ORDER BY period) AS half_all
  FROM wf WHERE n_prior >= p_min_prior
),
per AS (
  SELECT chokepoint, count(*) AS n, min(period) AS first_day, max(period) AS last_day,
    round(avg(y)::numeric, 4) AS base,
    round((1 - avg((f - y)^2) / nullif(avg(y) * (1 - avg(y)), 0))::numeric, 4) AS skill,
    round((1 - avg((p_base - y)^2) / nullif(avg(y) * (1 - avg(y)), 0))::numeric, 4) AS skill_running_base,
    round((1 - (avg((f - y)^2) FILTER (WHERE half = 1))
             / nullif((avg(y) FILTER (WHERE half = 1)) * (1 - (avg(y) FILTER (WHERE half = 1))), 0))::numeric, 4) AS skill_half_1,
    round((1 - (avg((f - y)^2) FILTER (WHERE half = 2))
             / nullif((avg(y) FILTER (WHERE half = 2)) * (1 - (avg(y) FILTER (WHERE half = 2))), 0))::numeric, 4) AS skill_half_2
  FROM ev GROUP BY chokepoint
),
pooled AS (
  SELECT count(*) AS n, round(avg(y)::numeric, 4) AS base,
    round((1 - avg((f - y)^2) / nullif(avg(y) * (1 - avg(y)), 0))::numeric, 4) AS skill,
    round((1 - avg((p_base - y)^2) / nullif(avg(y) * (1 - avg(y)), 0))::numeric, 4) AS skill_running_base,
    round((1 - (avg((f - y)^2) FILTER (WHERE half_all = 1))
             / nullif((avg(y) FILTER (WHERE half_all = 1)) * (1 - (avg(y) FILTER (WHERE half_all = 1))), 0))::numeric, 4) AS skill_half_1,
    round((1 - (avg((f - y)^2) FILTER (WHERE half_all = 2))
             / nullif((avg(y) FILTER (WHERE half_all = 2)) * (1 - (avg(y) FILTER (WHERE half_all = 2))), 0))::numeric, 4) AS skill_half_2
  FROM ev
),
cover AS (
  SELECT chokepoint, count(*) AS covered_rows, min(period) AS first_row, max(period) AS last_row
  FROM covered GROUP BY chokepoint
)
SELECT jsonb_build_object(
  'as_of', now(),
  'since', p_since,
  'question', 'tomorrow''s daily chokepoint snapshot (00:34 UTC, 24 h window) will exceed the trailing 28-day mean of covered snapshots',
  'model', 'persistence: P(above | yesterday above or below), fitted on prior post-step days of the same strait only, no shrink',
  'rule', 'admissible when pooled evaluable days >= ' || p_min_pooled || ' and pooled walk-forward skill > 0 in both halves; a strait is admitted only with n >= ' || p_min_strait || ' and its own skill > 0',
  'covered', COALESCE((SELECT jsonb_object_agg(chokepoint, jsonb_build_object('rows', covered_rows, 'first', first_row, 'last', last_row)) FROM cover), '{}'::jsonb),
  'pooled',  (SELECT to_jsonb(pooled) FROM pooled),
  'straits', COALESCE((SELECT jsonb_object_agg(chokepoint,
                (to_jsonb(per) - 'chokepoint') || jsonb_build_object('admitted', n >= p_min_strait AND coalesce(skill, 0) > 0))
              FROM per), '{}'::jsonb),
  'admissible', COALESCE((SELECT n >= p_min_pooled AND coalesce(skill, 0) > 0 AND coalesce(skill_half_1, 0) > 0 AND coalesce(skill_half_2, 0) > 0 FROM pooled), false)
);
$function$;

COMMENT ON FUNCTION public.chokepoint_daily_walkforward(date, integer, integer, numeric, integer, integer) IS
  'Admission instrument for a daily house chokepoint family (mig 152): walk-forward of a persistence forecast on post-2026-08-24 covered snapshots, split-half stability, per strait and pooled, with the admission verdict. Admin reader.';

-- ── The proof kind (mig 147 mechanism): the seeded item flips to SEEN on the rule ──
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

-- ── The seeded item: due when the first positive verdict is arithmetically possible ──
INSERT INTO public.ledger_watch_items (due_at, text, proof)
SELECT '2026-11-05 12:00+00'::timestamptz,
       'Daily chokepoint question admissible — walk-forward on post-08-24 covered snapshots: pooled ≥ 90 evaluable days with persistence skill > 0 in both halves (2026-09-09: 46 covered rows, 0 evaluable days). The family is built when this row is SEEN, not before.',
       '{"kind":"chokepoint_daily_admissible","min_pooled":90,"min_strait":20}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.ledger_watch_items WHERE text LIKE 'Daily chokepoint question admissible%');

-- ── Grants: admin reader, service role only (mig 139 rule) ──
REVOKE EXECUTE ON FUNCTION public.chokepoint_daily_walkforward(date, integer, integer, numeric, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.chokepoint_daily_walkforward(date, integer, integer, numeric, integer, integer) TO service_role;

COMMIT;

-- STEP 1 — READ ONLY, before applying (2026-09-09 12:2x UTC expectations):
--   SELECT chokepoint, count(*) FROM ais_chokepoint_observations WHERE period >= '2026-08-24' GROUP BY 1;
--   -- bosphorus ~14 · malacca ~17 · suez ~15 (grows by one per strait per day)
--
-- VERIFY, after applying (rows on screen):
--   SELECT jsonb_pretty(chokepoint_daily_walkforward());
--   -- covered: bosphorus/malacca/suez rows as above · pooled n 0 · admissible false · straits {}
--   SELECT ledger_watch_prove('{"kind":"chokepoint_daily_admissible"}'::jsonb)->>'proven';   -- false
--   SELECT id, due_at, text, proof FROM ledger_watch_items WHERE text LIKE 'Daily chokepoint question admissible%';  -- one row
--   SELECT has_function_privilege('anon', 'public.chokepoint_daily_walkforward(date,integer,integer,numeric,integer,integer)', 'EXECUTE') AS anon,
--          has_function_privilege('service_role', 'public.chokepoint_daily_walkforward(date,integer,integer,numeric,integer,integer)', 'EXECUTE') AS service_role;
--   -- false · true
--   SELECT public.ledger_watch_check();   -- checked 5 · the new item stays pending with evidence
