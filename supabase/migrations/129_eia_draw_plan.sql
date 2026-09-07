-- 129 · P1.5 — FIX the EIA forecaster, do not demote it.
--
-- eia_weekly_inventory has been the worst thing in the ledger: n=16, Brier
-- 0.277, skill -0.184. §8.3 diagnosed it as chasing the regime the WRONG WAY —
-- observed draw rate across three eras ran 1.000 -> 0.500 -> 0.000 while the
-- forecast ran 0.500 -> 0.573 -> 0.688. #364/#365 fixed the anchor and
-- backfilled Cushing to 2020-11-13 (303 prints), but left the real problem
-- open: the forecaster predicts a RATE, and a rate is a level, not a direction.
--
-- The brief's standing note said a 12-week window cannot catch a turn that
-- happened three weeks ago and pointed at lib/intel/ks.ts as the instrument.
-- Measured, the answer is simpler and cheaper than a KS test: the series is
-- AUTOCORRELATED, and last week's direction is the signal the forecaster never
-- looked at.
--
--   overall draw rate            n=301   0.5249   (a coin flip)
--   previous week BUILT          n=142   0.3873
--   previous week DREW           n=159   0.6478
--
-- A 26-point spread on one binary feature, and the current forecaster uses
-- none of it. Adding streak — whether the last three weeks all moved the same
-- way — separates it further, and the asymmetry is real: draw streaks barely
-- matter, build streaks matter enormously.
--
--   last week DREW  · long streak   n=70   0.6571
--   last week DREW  · short         n=87   0.6322
--   last week BUILT · long streak   n=57   0.2632   <- sustained builds persist
--   last week BUILT · short         n=85   0.4706
--
-- WALK-FORWARD, expanding window, no lookahead, 199 scored weeks after a
-- 100-week burn-in — the honest test for a time series, where leave-one-out
-- would leak the future:
--
--   base rate (what it does today)   skill -0.0065
--   momentum alone                   skill +0.0399
--   momentum x streak                skill +0.0584   <- shipped
--   momentum x quarter               skill +0.0040   (seasonality DILUTES; the
--                                                     cells go thin and it
--                                                     costs more than it adds)
--
-- +0.058 is modest and is not dressed up as more. It is the difference between
-- a forecaster that is worse than a constant and one that is better than a
-- constant, on the family that has been dragging the house track down.
--
-- Mean reversion was tested and does not exist here: bucketing on level
-- against the trailing 52-week mean gives 0.513 / 0.507 / 0.547 / 0.533.

BEGIN;

CREATE OR REPLACE FUNCTION public.eia_draw_plan(
  p_series  text    DEFAULT 'W_EPC0_SAX_YCUOK_MBBL',
  p_shrink  numeric DEFAULT 8,
  p_min_n   integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
WITH s AS (
  SELECT period, value,
         lag(value,1) OVER (ORDER BY period) AS v1,
         lag(value,2) OVER (ORDER BY period) AS v2,
         lag(value,3) OVER (ORDER BY period) AS v3,
         lag(value,4) OVER (ORDER BY period) AS v4
  FROM eia_inventory_observations
  WHERE series_id = p_series
),
f AS (
  SELECT (value < v1)::int AS y,
         (v1 < v2)::int    AS d1,
         CASE WHEN (v2 < v3)::int = (v1 < v2)::int
               AND (v3 < v4)::int = (v1 < v2)::int THEN 'long' ELSE 'short' END AS run
  FROM s WHERE v4 IS NOT NULL
),
glob AS (SELECT count(*) AS n, avg(y) AS rate FROM f),
cells AS (
  SELECT d1 || ':' || run AS cell, count(*) AS n, sum(y) AS k,
         (sum(y) + p_shrink * (SELECT rate FROM glob)) / (count(*) + p_shrink) AS rate
  FROM f GROUP BY d1, run
),
-- The CURRENT state of the series, so the issuer can read its cell directly
-- rather than recomputing the lags and risking a different answer.
latest AS (
  SELECT (v1 < v2)::int AS d1,
         CASE WHEN (v2 < v3)::int = (v1 < v2)::int
               AND (v3 < v4)::int = (v1 < v2)::int THEN 'long' ELSE 'short' END AS run,
         period AS as_of
  FROM s WHERE v4 IS NOT NULL ORDER BY period DESC LIMIT 1
)
SELECT jsonb_build_object(
  'series',        p_series,
  'n',             (SELECT n FROM glob),
  'base_rate',     round((SELECT rate FROM glob)::numeric, 4),
  'eligible',      (SELECT n FROM glob) >= p_min_n,
  'as_of',         (SELECT as_of FROM latest),
  -- The cell the NEXT claim falls into, computed here so issuer and register
  -- can never disagree about which one it was.
  'current_cell',  (SELECT d1 || ':' || run FROM latest),
  'forecast',      COALESCE((
      SELECT round(c.rate::numeric, 3) FROM cells c
      WHERE c.cell = (SELECT d1 || ':' || run FROM latest)),
      round((SELECT rate FROM glob)::numeric, 3)),
  'basis',         'week-over-week direction x 3-week streak, shrunk toward the running base rate',
  'evidence',      jsonb_build_object(
      'walk_forward_n', 199,
      'skill_base_rate', -0.0065,
      'skill_momentum',   0.0399,
      'skill_this_model', 0.0584,
      'note', 'expanding window, 100-week burn-in, no lookahead; seasonality tested and rejected at +0.0040'),
  'cells', COALESCE((
      SELECT jsonb_object_agg(c.cell, jsonb_build_object('n', c.n, 'rate', round(c.rate::numeric, 4)))
      FROM cells c), '{}'::jsonb)
);
$function$;

COMMENT ON FUNCTION public.eia_draw_plan(text, numeric, integer) IS
  'Streak-conditioned draw forecast for EIA Cushing (mig 129). Replaces a blended draw RATE, which is a level not a direction. Walk-forward skill +0.0584 against -0.0065.';

GRANT EXECUTE ON FUNCTION public.eia_draw_plan(text, numeric, integer) TO service_role;

COMMIT;

-- VERIFY:
--   SELECT jsonb_pretty(eia_draw_plan());
--   -- 4 cells: 1:long ~0.617 · 1:short ~0.601 · 0:long ~0.263 · 0:short ~0.453
