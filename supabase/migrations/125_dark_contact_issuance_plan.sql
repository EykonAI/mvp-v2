-- 125 · A stated selection rule for machine-track issuance.
--
-- WHY
-- ---
-- The dark-contact family issues a claim for EVERY open event, forecast at one
-- global base rate. As of 2026-09-07 that is 65,210 claims — roughly 6,700 a
-- day, a cadence nobody chose. Two things are wrong with it, and they are the
-- same thing:
--
-- 1. VOLUME WITH NO RULE. "We issue a claim for everything" is not a selection
--    rule, and an unstated selection rule is the first thing a sceptical
--    analyst attacks. A track record is only evidence if you can say what got
--    into it and why.
--
-- 2. MOST OF THE VOLUME IS A FORMALITY. Measured per box over completed
--    cohorts:
--        europe-med    n=28,858  rate 0.853   <- 64% of all volume
--        americas-atl  n=4,557   rate 0.783
--        asia-pacific  n=7,054   rate 0.717
--        suez          n=514     rate 0.715
--        malacca       n=2,677   rate 0.586
--        africa-io     n=1,028   rate 0.318
--        bosphorus     n=464     rate 0.800
--        panama        n=14      rate 0.438
--    §17.2: a family whose event is 95% likely is a formality with a good
--    Brier, not a test. europe-med at 0.853 is most of the register and the
--    least informative question in it.
--
-- THE RULE (stated here, recorded on every claim, checkable by a reader)
-- ---------------------------------------------------------------------
--   a. A box is ELIGIBLE only if its Laplace-shrunk reappearance rate over
--      COMPLETED cohorts sits inside [0.20, 0.80] with n >= 200.
--   b. Excluded boxes are reported WITH their rate and reason, never hidden.
--   c. Within an eligible box, at most p_daily_cap claims per UTC day, taken
--      in descending confidence_at_open — the most suspicious contacts, which
--      are also the most decision-relevant.
--   d. The forecast is the BOX's own rate, not a global one.
--
-- (d) is the part that matters beyond volume. Out-of-sample on this data —
-- rates fitted on the first half of events, scored on the second, n=23,468 —
-- swapping the global forecast for the per-box rate moves Brier 0.1410 ->
-- 0.1322 and skill -0.084 -> -0.017. Skill IS discrimination: a forecaster
-- emitting one number for every claim scores zero by construction however
-- accurate that number is. Box is the first feature found that varies with
-- the outcome, and it spans 0.318 to 0.853.
--
-- COMPLETED COHORTS ONLY is preserved from the existing issuer: before a 72 h
-- deadline passes an event has not HAD TIME to fail, so counting young events
-- reads "not yet failed" as a success rate (0.979 on the first emission tick).

BEGIN;

CREATE OR REPLACE FUNCTION public.dark_contact_issuance_plan(
  p_daily_cap integer DEFAULT 200,
  p_min_n     integer DEFAULT 200,
  p_band_lo   numeric DEFAULT 0.20,
  p_band_hi   numeric DEFAULT 0.80
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
WITH cohorts AS (
  -- Completed cohorts only: deadline passed, so both outcomes were possible.
  SELECT box_slug,
         count(*) FILTER (WHERE resolution = 'reappeared') AS k,
         count(*)                                          AS n
  FROM dark_contact_events
  WHERE status = 'resolved' AND deadline_at <= now()
  GROUP BY box_slug
),
rates AS (
  SELECT box_slug, k, n,
         round(((k + 1.0) / (n + 2.0))::numeric, 4) AS rate
  FROM cohorts
),
issued_today AS (
  SELECT r.context->>'box_slug' AS box_slug, count(*) AS issued
  FROM predictions_register r
  WHERE r.source = 'ais-darkgap'
    AND r.issued_at >= date_trunc('day', now())
  GROUP BY 1
)
SELECT jsonb_build_object(
  'rule', jsonb_build_object(
    'band_lo', p_band_lo, 'band_hi', p_band_hi,
    'min_n', p_min_n, 'daily_cap_per_box', p_daily_cap,
    'basis', 'laplace-shrunk reappearance rate over completed cohorts, per box',
    'order', 'confidence_at_open desc'
  ),
  'boxes', COALESCE((
    SELECT jsonb_object_agg(x.box_slug, jsonb_build_object(
      'k', x.k, 'n', x.n, 'rate', x.rate,
      'eligible', x.eligible,
      -- Excluded boxes carry their reason AND their rate, so a reader can see
      -- what we declined to score and why.
      'reason', x.reason,
      'issued_today', COALESCE(i.issued, 0),
      'remaining', CASE WHEN x.eligible
                        THEN greatest(0, p_daily_cap - COALESCE(i.issued, 0)::int)
                        ELSE 0 END
    ))
    FROM (
      SELECT r.*,
             (r.n >= p_min_n AND r.rate >= p_band_lo AND r.rate <= p_band_hi) AS eligible,
             CASE WHEN r.n < p_min_n THEN 'thin: n < ' || p_min_n
                  WHEN r.rate < p_band_lo OR r.rate > p_band_hi
                       THEN 'outside informative band [' || p_band_lo || ',' || p_band_hi || ']'
                  ELSE NULL END AS reason
      FROM rates r
    ) x
    LEFT JOIN issued_today i ON i.box_slug = x.box_slug
  ), '{}'::jsonb)
);
$function$;

COMMENT ON FUNCTION public.dark_contact_issuance_plan(integer, integer, numeric, numeric) IS
  'Per-box eligibility, forecast rate and remaining daily quota for machine-track dark-contact issuance (mig 125). Replaces "issue a claim for every open event at one global rate".';

GRANT EXECUTE ON FUNCTION public.dark_contact_issuance_plan(integer, integer, numeric, numeric) TO service_role;

COMMIT;

-- VERIFY:
--   SELECT jsonb_pretty(dark_contact_issuance_plan());
--   -- expect europe-med eligible=false (rate ~0.853), africa-io/malacca/suez/
--   -- asia-pacific/americas-atl eligible=true, panama excluded as thin.
