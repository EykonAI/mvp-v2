-- 126 · Give the house forecasters a measured prior instead of 0.5, and a
--       standing diagnostic that says whether recalibration would help YET.
--
-- TWO FINDINGS, ONE SHIPPED AND ONE DELIBERATELY NOT.
--
-- 1 · THE FLAT 0.5 FALLBACK IS WRONG AND IS STILL IN THE CODE.
--     Both house issuers fall back to exactly 0.5 when their model has too
--     little history. Measured 2026-09-07, of 45 scored house claims:
--        ais_chokepoint_weekly  3 claims at exactly 0.500 -> resolved 0.667
--        eia_weekly_inventory   6 claims at exactly 0.500 -> resolved 1.000
--     0.5 is the right prior only when you know NOTHING. We know the family's
--     base rate. This function supplies it, shrunk toward 0.5 by a Beta(k/2,
--     k/2) prior so a thin family is not handed a confident number it has not
--     earned.
--
-- 2 · RECALIBRATION DOES NOT WORK YET, AND IS NOT SHIPPED.
--     The Murphy decomposition on the house track reads uncertainty 0.2291,
--     resolution 0.0391, reliability 0.0471 — apparently a miscalibration
--     penalty LARGER than the information gain, implying skill +0.17 from
--     recalibration alone. Leave-one-out says otherwise. Fitting the one
--     parameter on every OTHER claim in the family and applying it to the
--     held-out one:
--        kappa   0   skill -0.0930 -> -0.1167   (worse)
--        kappa   5                 -> -0.1032   (worse)
--        kappa  10                 -> -0.0959   (worse)
--        kappa  20                 -> -0.0892
--        kappa  30                 -> -0.0867
--        kappa  60                 -> -0.0855
--     At full strength the correction HURTS. It only stops hurting once it is
--     shrunk almost to nothing, and the residual gain is 0.007 of skill. The
--     in-sample reliability was mostly small-sample artefact at n=45.
--
--     Pooled, that says "do not recalibrate". Split by family it says something
--     more useful:
--        ais_chokepoint_weekly  n=29  skill -0.0426 -> -0.0086   HELPS
--        eia_weekly_inventory   n=16  skill -0.1839 -> -0.3082   HARMS
--
--     Recalibration fixes BIAS, not DIRECTION. §8.3 found the EIA forecaster
--     chasing the regime the wrong way; correcting the mean of a signal whose
--     discrimination is negative amplifies the error. Chokepoint is merely
--     mis-centred, which is exactly what a shift repairs.
--
--     So the correction is SELF-GATING: it applies to a family only while that
--     family's own leave-one-out test says it earns its place, and the test is
--     recomputed from live data on every read. Today that means chokepoint yes,
--     EIA no. If EIA's forecaster is fixed, it turns itself on; if chokepoint
--     drifts, it turns itself off. Nobody has to remember to revisit it.

BEGIN;

CREATE OR REPLACE FUNCTION public.house_family_calibration(p_shrink_k numeric DEFAULT 10)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
WITH s AS (
  SELECT r.id, r.feature,
         (r.predicted_distribution->>'mean')::numeric AS p,
         o.observed_value::numeric AS y
  FROM predictions_register r
  JOIN prediction_outcomes o ON o.prediction_id = r.id
  WHERE COALESCE(r.track, 'house') = 'house'
    AND o.brier IS NOT NULL
    AND o.void_reason IS NULL
),
agg AS (
  SELECT feature,
         count(*)      AS n,
         sum(y)        AS k,
         avg(y)        AS base_rate,
         avg(p)        AS mean_forecast,
         avg((p - y)^2) AS brier
  FROM s GROUP BY feature
),
-- Leave-one-out test of the one-parameter logit-shift recalibration. Fitted on
-- every OTHER claim in the family, applied to the held-out one, so the number
-- is honest rather than in-sample.
loo AS (
  SELECT a.feature, kap.kappa, a.p, a.y,
         (ln(f.br/(1-f.br)) - f.mlp) * (f.n::numeric/(f.n + kap.kappa)) AS shift
  FROM s a
  CROSS JOIN (SELECT unnest(ARRAY[0, 30]) AS kappa) kap
  CROSS JOIN LATERAL (
    SELECT count(*) AS n,
           avg(ln(b.p/(1-b.p))) AS mlp,
           least(0.95, greatest(0.05, avg(b.y))) AS br
    FROM s b WHERE b.feature = a.feature AND b.id <> a.id
      AND b.p > 0.02 AND b.p < 0.98
  ) f
  WHERE f.n > 1 AND a.p > 0.02 AND a.p < 0.98
),
loo_agg AS (
  SELECT feature, kappa,
         avg((p - y)^2) AS brier_now,
         avg((1/(1+exp(-(ln(p/(1-p)) + shift))) - y)^2) AS brier_recal,
         avg(y) AS br
  FROM loo GROUP BY feature, kappa
)
SELECT COALESCE(jsonb_object_agg(a.feature, jsonb_build_object(
  'n', a.n,
  'base_rate',     round(a.base_rate, 4),
  'mean_forecast', round(a.mean_forecast, 4),
  'brier',         round(a.brier, 4),
  -- THE ACTIONABLE FIELD. An issuer with no model output uses this instead of
  -- 0.5: the family's measured rate, shrunk toward 0.5 by a Beta(k/2,k/2)
  -- prior so a thin family is not handed confidence it has not earned.
  'prior',         round((a.k + 0.5 * p_shrink_k) / (a.n + p_shrink_k), 4),
  'prior_basis',   'measured base rate, Beta(' || (p_shrink_k/2) || ',' || (p_shrink_k/2) || ') shrunk toward 0.5',
  -- THE GATE. Apply the shift only while this family's own held-out test says
  -- it helps, and only once there is enough history for that test to mean
  -- anything. Recomputed live, so it turns itself on and off without anyone
  -- remembering to revisit it.
  'recal_applied', COALESCE((
      SELECT l.brier_recal < l.brier_now AND a.n >= 20
      FROM loo_agg l WHERE l.feature = a.feature AND l.kappa = 30), false),
  'recal_shift',   COALESCE((
      SELECT round(((ln(least(0.95,greatest(0.05,a.base_rate))/(1-least(0.95,greatest(0.05,a.base_rate))))
                    - avg(ln(x.p/(1-x.p)))) * (a.n::numeric/(a.n+30)))::numeric, 4)
      FROM s x WHERE x.feature = a.feature AND x.p > 0.02 AND x.p < 0.98), 0),
  'recal_evidence', COALESCE((
      SELECT jsonb_object_agg('kappa_' || l.kappa, jsonb_build_object(
        'skill_now',   round((1 - l.brier_now  /NULLIF(l.br*(1-l.br),0))::numeric, 4),
        'skill_recal', round((1 - l.brier_recal/NULLIF(l.br*(1-l.br),0))::numeric, 4),
        'helps',       l.brier_recal < l.brier_now))
      FROM loo_agg l WHERE l.feature = a.feature), '{}'::jsonb)
)), '{}'::jsonb)
FROM agg a;
$function$;

COMMENT ON FUNCTION public.house_family_calibration(numeric) IS
  'Per-family measured prior for the house issuers (replaces the flat 0.5 fallback) plus a standing leave-one-out test of whether recalibration would help. Mig 126: recalibration measured as HARMFUL at n=45 and deliberately not applied.';

GRANT EXECUTE ON FUNCTION public.house_family_calibration(numeric) TO service_role;

COMMIT;

-- VERIFY:
--   SELECT jsonb_pretty(house_family_calibration());
--   -- ais_chokepoint_weekly prior should sit near 0.62, not 0.5
--   -- ais_chokepoint_weekly: prior ~0.6154, recal_applied TRUE
--   -- eia_weekly_inventory:  prior ~0.5769, recal_applied FALSE (harms, n<20)
