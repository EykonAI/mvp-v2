-- 154 · EIA draw forecast: one more feature (the 22,000 kbbl floor), and the
--       next-claim cell computed from the RIGHT week.
--
-- RECOMMENDATION "EIA weekly inventory family: add features" — MEASURED FIRST
-- (read-only, 2026-09-09, 303 Cushing prints 2020-11-13 → 2026-08-28), built
-- only what the measurement supports. Same harness as mig 129: walk-forward,
-- expanding window, 100-week burn-in, 199 scored weeks (2022-11-11 →
-- 2026-08-28), every forecast fitted on the weeks before it only. Skill is
-- 1 − Brier / (base·(1−base)) over the scored weeks; halves are the first 100
-- and last 99 scored weeks, each against its own base rate.
--
-- REPRODUCTION (the harness is trusted before anything is added):
--   base rate                         skill −0.0065   Brier 0.25148
--   momentum (d1)                     skill +0.0394   (mig 129 quoted +0.0399)
--   mig 129 (d1 × 3-week run)         skill +0.0572   Brier 0.23556   EXACT
--     by half   +0.1099 / +0.0038      by year  2023 +0.256 · 2024 −0.142 ·
--                                              2025 +0.004 · 2026 +0.051
--   The shipped model's edge is one year (2023); in 2024 it was strongly
--   negative and in 2024-26 it is ≈ zero. Fragile, and worth knowing.
--
-- WHAT IS AVAILABLE AT ISSUE (Monday 09:00 UTC). On all 16 Monday claims the
-- baseline print is the week ending Monday − 10 days, published the Wednesday
-- before (15:30 UTC) and ingested by the 06:01 UTC daily tick. Every feature
-- below is a function of prints ≤ the baseline. The target print lands the
-- Wednesday AFTER issue. Series that do NOT exist with enough history: US
-- crude / gasoline / distillate stocks (20 rows each, from 2026-04-17), WTI /
-- Brent spot (105 daily rows from 2026-04-01) — below the 100-week bar and
-- not evaluated. No refinery-utilisation, imports or production series is in
-- the database. (Caveat that applies equally to mig 129: prints are stored as
-- last revised, not as first published.)
--
-- CANDIDATES, ONE AT A TIME ON TOP OF MIG 129 (flat shrink toward the running
-- base rate, α = 8, the shipped estimator; hierarchical shrink toward the
-- parent cell in brackets):
--   |last change| bands 500/1500 kbbl   +0.0660 [+0.0742]   h2 +0.0052 [+0.0013]  2025 −0.026
--   |last change| relative 2%/5%        +0.0441 [+0.0493]   h2 negative
--   |last change| < 1000 kbbl           +0.0484 [+0.0510]   h2 negative
--   4-week net change is a draw         +0.0597 [+0.0600]   h2 −0.0184  FAILS stability
--   draws in the last 4 weeks (0-1/2/3-4) +0.0479           h2 negative
--   streak length 1/2/3/4+ (replaces run) +0.0247           worse than the binary run
--   quarter                             +0.0132 [+0.0288]   h2 −0.0805  (mig 129 confirmed)
--   half-year                           +0.0227             h2 negative
--   month                               +0.0208 [+0.0554]   47 cells, avg n 4 — too thin to quote
--   cumulative streak size ≥ 2000 kbbl  +0.0486 [+0.0580]   h2 negative
--   baseline < 25,000 kbbl              +0.0596 [+0.0639]   h2 +0.0067
--   baseline < 22,000 kbbl  ← SHIPPED   +0.0854 [+0.0806]   h1 +0.1274 · h2 +0.0429
--     Brier 0.22851 · sharpness 0.1470 (mig 129: 0.1438)
--     by year  2023 +0.280 · 2024 −0.130 · 2025 +0.072 · 2026 +0.056
--              (better than mig 129 in every calendar year, 2022 included)
--     α 2 / 4 / 8 / 16 / 32 → +0.0825 / +0.0857 / +0.0854 / +0.0799 / +0.0683
--   pairs: + |change| bands +0.0834 (h2 +0.0163); + 4-week sign +0.0985
--     (h2 +0.0472) — NOT adopted: the 4-week sign fails stability on its own,
--     and a feature that only helps in combination is the overfit the two-half
--     rule exists to catch.
--
-- WHY THE FLOOR IS BELIEVED, AND HOW FAR. Cushing has an operational floor
-- (tank bottoms, ~20 mb): drawing into it is self-limiting. Below 22,000 kbbl
-- the next week drew 0.344 of the time against 0.545 above; the effect sits
-- where physics puts it — after a DRAW at the floor the next week reversed
-- (6 draws in 19), while momentum says 0.65. The evidence is thin and is
-- stated as such: 32 scored weeks below the floor (5 in the first half, 27 in
-- the second) plus 3 in the burn-in, over four episodes — Jul 2022 0/3,
-- Sep–Nov 2023 1/5, Jan–Dec 2025 5/17, Jun–Aug 2026 5/10. The 2022-23
-- episodes forecast 2025 out of sample; 2026 ran at the base rate.
--   THRESHOLD. 22,000 was the first cut tried (round number above the ~20 mb
--   floor); a sweep was run afterwards and is reported, not chased: 20.5k
--   +0.0654 · 21k +0.0850 · 21.5k +0.1059 (peak) · 22k +0.0854 · 22.5k
--   +0.0734 · 23k +0.0627 · 23.5k +0.0574 · 24k +0.0609 · 25k +0.0596 · 26k
--   +0.0505 · 30k +0.0578. A hump over 21–22.5k, back to mig 129 by 23.25k.
--   The a-priori number ships, not the peak.
--   RELATIVE FORMULATIONS FAIL, as an absolute floor predicts: within 5 / 10 /
--   15 / 20 / 30 % of the trailing 52-week low +0.0603 / +0.0517 / +0.0521 /
--   +0.0492 / +0.0346 (h2 ≤ +0.016); new 26- / 52-week low +0.0499 / +0.0522.
--   PLACEBO. The two-half rule alone is WEAK against a block-shaped binary
--   feature: of 298 circular shifts of the same indicator, 76 beat +0.0572 and
--   61 (20 %) also came out positive in both halves. What carries the floor
--   is the alignment: 0 of 298 shifts reach the true +0.0854 (placebo max
--   +0.0805, p95 +0.0693, median +0.0498).
--   The flat form ships because it measured better than the hierarchical one
--   on every summary; the cost is that the one unmeasured cell (0:long below
--   the floor, n = 1) starts near the base rate rather than at its parent's
--   0.295, until it has history.
--
-- THE SECOND FIX: MIG 129'S current_cell WAS ONE WEEK STALE. Its `latest`
-- CTE took the newest row of the lagged series and read d1 = (v1 < v2) — the
-- direction of the week BEFORE the newest print. The next claim's "last
-- week" is the newest print's own direction (value < v1). On the 2026-08-21
-- row mig 129 reads d1 = 1 (draw) while that week built (22,428 > 21,252).
-- The two coincide on the 2026-08-28 row (both 0:short) by chance. No claim
-- was affected: #474 merged 2026-09-07 15:18 UTC, after that Monday's 09:02
-- issue, so the mig-129 model has not issued yet — its first claim, and this
-- one's, is Monday 2026-09-14. The walk-forward evidence in mig 129 is
-- unaffected (its `f` frame is correct); only the live cell was wrong.
-- Also for the record: mig 129's VERIFY comment quotes cell rates from the
-- abandoned (k + 4·rate)/(n + 8) form (0.617 / 0.601 / 0.263 / 0.453); the
-- shipped function returns 0.643 / 0.623 / 0.295 / 0.475 on today's data.
--
-- WHAT CHANGES. Same signature, same estimator form, one more cell dimension.
-- The output keeps every key the issuer and the admin monitor read (basis,
-- current_cell, forecast, base_rate, n, eligible, as_of, evidence.*, cells)
-- and adds model_version, floor_kbbl, current_parent_cell, parent_forecast,
-- current_features and parent_cells. evidence.* is now LIVE — the same
-- walk-forward, recomputed on every call, so the monitor shows the model's
-- current out-of-sample skill rather than a number frozen on the day it
-- shipped; the frozen 2026-09-09 measurement is kept under
-- evidence.measured_2026_09_09. The issuer records the feature values on
-- every claim. The recalibration gate (mig 126) is untouched.

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
-- One row per TARGET week whose outcome is known. Every feature is a function
-- of prints strictly before the target print; v1 is the baseline the claim is
-- written against, so all of it is on the table by Monday 09:00 UTC.
f AS (
  SELECT period,
         (value < v1)::int AS y,
         (v1 < v2)::int    AS d1,
         CASE WHEN (v2 < v3)::int = (v1 < v2)::int
               AND (v3 < v4)::int = (v1 < v2)::int THEN 'long' ELSE 'short' END AS run,
         (v1 < 22000)::int AS low,
         row_number() OVER (ORDER BY period) AS rn
  FROM s WHERE v4 IS NOT NULL
),
glob AS (SELECT count(*) AS n, avg(y) AS rate FROM f),
-- The mig-129 cells, kept so a reader can see what the floor changed.
parents AS (
  SELECT d1, run, d1 || ':' || run AS cell, count(*) AS n, sum(y) AS k,
         (sum(y) + p_shrink * (SELECT rate FROM glob)) / (count(*) + p_shrink) AS rate
  FROM f GROUP BY d1, run
),
-- The mig-154 cells: direction × run × below-the-floor, same shrinkage.
cells AS (
  SELECT d1, run, low, d1 || ':' || run AS parent, d1 || ':' || run || ':' || low AS cell,
         count(*) AS n, sum(y) AS k,
         (sum(y) + p_shrink * (SELECT rate FROM glob)) / (count(*) + p_shrink) AS rate
  FROM f GROUP BY d1, run, low
),
-- The NEXT claim's features, from the newest print. Its target week is not a
-- row of f yet, so its "last week" is the newest print's own direction
-- (value vs v1) — NOT the newest row's d1 (v1 vs v2), which is a week older.
-- That was mig 129's mistake.
latest AS (
  SELECT (value < v1)::int AS d1,
         CASE WHEN (v1 < v2)::int = (value < v1)::int
               AND (v2 < v3)::int = (value < v1)::int THEN 'long' ELSE 'short' END AS run,
         (value < 22000)::int AS low,
         value AS level,
         period AS as_of
  FROM s WHERE v3 IS NOT NULL ORDER BY period DESC LIMIT 1
),
cur AS (
  SELECT l.d1, l.run, l.low, l.level, l.as_of,
         l.d1 || ':' || l.run AS parent_cell,
         l.d1 || ':' || l.run || ':' || l.low AS cell,
         p.rate AS parent_rate,
         c.rate AS cell_rate, c.n AS cell_n, c.k AS cell_k
  FROM latest l
  LEFT JOIN parents p ON p.d1 = l.d1 AND p.run = l.run
  LEFT JOIN cells   c ON c.d1 = l.d1 AND c.run = l.run AND c.low = l.low
),
-- LIVE walk-forward: every week after a 100-week burn-in is forecast from the
-- weeks before it only, for the base rate, momentum, mig 129 and this model.
-- The same harness that produced the figures in the header.
wf AS (
  SELECT rn, y,
         avg(y)   OVER (ORDER BY rn ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS r_glob,
         count(*) OVER (PARTITION BY d1 ORDER BY rn ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS n_m,
         sum(y)   OVER (PARTITION BY d1 ORDER BY rn ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS k_m,
         count(*) OVER (PARTITION BY d1, run ORDER BY rn ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS n_p,
         sum(y)   OVER (PARTITION BY d1, run ORDER BY rn ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS k_p,
         count(*) OVER (PARTITION BY d1, run, low ORDER BY rn ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS n_c,
         sum(y)   OVER (PARTITION BY d1, run, low ORDER BY rn ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS k_c
  FROM f
),
sc AS (
  SELECT rn, y, r_glob,
         (coalesce(k_m, 0) + p_shrink * r_glob) / (n_m + p_shrink) AS p_mom,
         (coalesce(k_p, 0) + p_shrink * r_glob) / (n_p + p_shrink) AS p_129,
         (coalesce(k_c, 0) + p_shrink * r_glob) / (n_c + p_shrink) AS p_154,
         CASE WHEN rn <= 100 + ceil(((SELECT n FROM glob) - 100) / 2.0) THEN 1 ELSE 2 END AS half
  FROM wf WHERE rn > 100
),
ev AS (
  SELECT count(*) AS n,
         round(avg(y)::numeric, 4) AS base,
         round((1 - avg((r_glob - y)^2) / NULLIF(avg(y) * (1 - avg(y)), 0))::numeric, 4) AS skill_base,
         round((1 - avg((p_mom - y)^2)  / NULLIF(avg(y) * (1 - avg(y)), 0))::numeric, 4) AS skill_mom,
         round((1 - avg((p_129 - y)^2)  / NULLIF(avg(y) * (1 - avg(y)), 0))::numeric, 4) AS skill_129,
         round((1 - avg((p_154 - y)^2)  / NULLIF(avg(y) * (1 - avg(y)), 0))::numeric, 4) AS skill_154,
         round(avg((p_129 - y)^2)::numeric, 5) AS brier_129,
         round(avg((p_154 - y)^2)::numeric, 5) AS brier_154,
         round(stddev_pop(p_129)::numeric, 4) AS sharp_129,
         round(stddev_pop(p_154)::numeric, 4) AS sharp_154
  FROM sc
),
evh AS (
  SELECT half, count(*) AS n,
         round((1 - avg((p_129 - y)^2) / NULLIF(avg(y) * (1 - avg(y)), 0))::numeric, 4) AS skill_129,
         round((1 - avg((p_154 - y)^2) / NULLIF(avg(y) * (1 - avg(y)), 0))::numeric, 4) AS skill_154
  FROM sc GROUP BY half
)
SELECT jsonb_build_object(
  'series',        p_series,
  'model_version', 'v2-floor',
  'n',             (SELECT n FROM glob),
  'base_rate',     round((SELECT rate FROM glob)::numeric, 4),
  'eligible',      (SELECT n FROM glob) >= p_min_n,
  'as_of',         (SELECT as_of FROM cur),
  'floor_kbbl',    22000,
  -- The cell the NEXT claim falls into, computed here so issuer and register
  -- can never disagree about which one it was.
  'current_cell',        (SELECT cell FROM cur),
  'current_parent_cell', (SELECT parent_cell FROM cur),
  'current_features',    (SELECT jsonb_build_object(
                             'd1', d1, 'run', run, 'low', low, 'level_kbbl', level,
                             'cell_n', coalesce(cell_n, 0), 'cell_k', coalesce(cell_k, 0))
                          FROM cur),
  'forecast',        COALESCE((SELECT round(cell_rate::numeric, 3) FROM cur),
                              (SELECT round(parent_rate::numeric, 3) FROM cur),
                              round((SELECT rate FROM glob)::numeric, 3)),
  'parent_forecast', COALESCE((SELECT round(parent_rate::numeric, 3) FROM cur),
                              round((SELECT rate FROM glob)::numeric, 3)),
  'basis',         'week-over-week direction x 3-week streak x below the 22,000 kbbl floor, shrunk toward the running base rate (mig 154)',
  'evidence',      jsonb_build_object(
      'live',             true,
      'walk_forward_n',   (SELECT n FROM ev),
      'scored_base_rate', (SELECT base FROM ev),
      'skill_base_rate',  (SELECT skill_base FROM ev),
      'skill_momentum',   (SELECT skill_mom FROM ev),
      'skill_mig129',     (SELECT skill_129 FROM ev),
      'skill_this_model', (SELECT skill_154 FROM ev),
      'brier_mig129',     (SELECT brier_129 FROM ev),
      'brier_this_model', (SELECT brier_154 FROM ev),
      'sharpness_mig129',     (SELECT sharp_129 FROM ev),
      'sharpness_this_model', (SELECT sharp_154 FROM ev),
      'halves', COALESCE((SELECT jsonb_object_agg('h' || half, jsonb_build_object(
                    'n', n, 'skill_mig129', skill_129, 'skill_this_model', skill_154)) FROM evh), '{}'::jsonb),
      'note', 'expanding window, 100-week burn-in, no lookahead, recomputed on every call; halves = first/second half of the scored weeks, each against its own base rate. The frozen 2026-09-09 measurement is under measured_2026_09_09 and in the mig 154 header.',
      'measured_2026_09_09', jsonb_build_object(
          'walk_forward_n', 199,
          'skill_base_rate', -0.0065, 'skill_momentum', 0.0394, 'skill_mig129', 0.0572,
          'skill_this_model', 0.0854, 'skill_this_model_hierarchical', 0.0806,
          'halves', jsonb_build_object('h1', jsonb_build_object('mig129', 0.1099, 'this', 0.1274),
                                       'h2', jsonb_build_object('mig129', 0.0038, 'this', 0.0429)),
          'by_year', jsonb_build_object(
              '2023', jsonb_build_object('n', 52, 'mig129', 0.2555, 'this', 0.2804),
              '2024', jsonb_build_object('n', 52, 'mig129', -0.1420, 'this', -0.1301),
              '2025', jsonb_build_object('n', 52, 'mig129', 0.0042, 'this', 0.0724),
              '2026', jsonb_build_object('n', 35, 'mig129', 0.0510, 'this', 0.0564)),
          'below_floor', jsonb_build_object('scored_weeks', 32, 'first_half', 5, 'second_half', 27,
                                            'draw_rate', 0.344, 'draw_rate_above', 0.545),
          'placebo', jsonb_build_object('circular_shifts', 298, 'shifts_at_or_above_true', 0,
                                        'max', 0.0805, 'p95', 0.0693, 'median', 0.0498,
                                        'shifts_beating_mig129', 76, 'shifts_passing_two_half_rule', 61),
          'threshold_sweep_kbbl', jsonb_build_object(
              '20500', 0.0654, '21000', 0.0850, '21500', 0.1059, '22000', 0.0854, '22500', 0.0734,
              '23000', 0.0627, '23500', 0.0574, '24000', 0.0609, '25000', 0.0596, '26000', 0.0505, '30000', 0.0578),
          'rejected', jsonb_build_object(
              'magnitude_bands_500_1500', 0.0660, 'magnitude_relative_2_5pct', 0.0441,
              'four_week_net_sign', 0.0597, 'draws_in_last_4', 0.0479, 'streak_length', 0.0247,
              'quarter', 0.0132, 'half_year', 0.0227, 'month', 0.0208,
              'cumulative_streak_2000', 0.0486, 'floor_25000', 0.0596,
              'relative_to_52w_low_10pct', 0.0517, 'new_52w_low', 0.0522))),
  'cells', COALESCE((
      SELECT jsonb_object_agg(c.cell, jsonb_build_object('n', c.n, 'k', c.k, 'rate', round(c.rate::numeric, 4), 'parent', c.parent))
      FROM cells c), '{}'::jsonb),
  'parent_cells', COALESCE((
      SELECT jsonb_object_agg(p.cell, jsonb_build_object('n', p.n, 'k', p.k, 'rate', round(p.rate::numeric, 4)))
      FROM parents p), '{}'::jsonb)
);
$function$;

COMMENT ON FUNCTION public.eia_draw_plan(text, numeric, integer) IS
  'Draw forecast for EIA Cushing: direction × 3-week streak × below the 22,000 kbbl floor, shrunk toward the running base rate (mig 154; mig 129 + one feature, and the next-claim cell read from the newest print rather than the week before it). Walk-forward 2026-09-09: +0.0854 against +0.0572; evidence.* is recomputed live.';

-- Service role only, by role name (mig 139/149 lesson: REVOKE FROM PUBLIC
-- alone removes nothing on Supabase).
REVOKE EXECUTE ON FUNCTION public.eia_draw_plan(text, numeric, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.eia_draw_plan(text, numeric, integer) TO service_role;

-- The change, on the public record (mig 137). Idempotent on the PR number,
-- not on the timestamp: now() differs on every run.
INSERT INTO public.ledger_change_log (at, pr, note)
SELECT now(), '#512', 'EIA draw forecast: direction × streak × below-22,000-kbbl floor (walk-forward +0.085 vs +0.057); next-claim cell read from the newest print (mig 129 read the week before)'
WHERE NOT EXISTS (SELECT 1 FROM public.ledger_change_log WHERE pr = '#512');

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- STEP 1 — READ ONLY, run BEFORE applying (2026-09-09 expectations; one more
-- print, 2026-09-04, lands with the Wednesday 15:30 UTC ingest and shifts n
-- by one and every rate by a few thousandths — that is not a failure).
-- ─────────────────────────────────────────────────────────────────────────
--   SELECT count(*) AS prints, min(period) AS first, max(period) AS last
--   FROM eia_inventory_observations WHERE series_id = 'W_EPC0_SAX_YCUOK_MBBL';
--   -- 303 · 2020-11-13 · 2026-08-28   (304 / 2026-09-04 after the 09-09 ingest)
--
--   -- The stale cell, shown on data: mig129_d1 is the direction of the week
--   -- BEFORE each print; dir_this_week is the print's own direction, which is
--   -- what the next claim's "last week" is. They differ on 2026-08-21.
--   WITH s AS (SELECT period, value, lag(value,1) OVER (ORDER BY period) AS v1,
--                     lag(value,2) OVER (ORDER BY period) AS v2
--              FROM eia_inventory_observations WHERE series_id = 'W_EPC0_SAX_YCUOK_MBBL')
--   SELECT period, value, v1, (value < v1)::int AS dir_this_week, (v1 < v2)::int AS mig129_d1
--   FROM s ORDER BY period DESC LIMIT 3;
--   -- 2026-08-28  22508  22428  0  0
--   -- 2026-08-21  22428  21252  0  1   <- mig 129 would have called this a draw
--   -- 2026-08-14  21252  22566  1  0
--
--   SELECT has_function_privilege('anon', 'public.eia_draw_plan(text,numeric,integer)', 'EXECUTE') AS anon_before;
--   -- false (mig 149 already revoked it; this file re-asserts it)
--
-- ─────────────────────────────────────────────────────────────────────────
-- VERIFY, run AFTER applying (the rows must be on screen, not the banner):
-- ─────────────────────────────────────────────────────────────────────────
--   SELECT p->>'model_version' AS v, p->>'n' AS n, p->>'as_of' AS as_of,
--          p->>'current_cell' AS cell, p->>'current_parent_cell' AS parent,
--          p->>'forecast' AS forecast, p->>'parent_forecast' AS parent_forecast,
--          p->'evidence'->>'skill_mig129' AS wf_mig129, p->'evidence'->>'skill_this_model' AS wf_this
--   FROM eia_draw_plan() p;
--   -- v2-floor · 299 · 2026-08-28 · 0:short:0 · 0:short · 0.496 · 0.475 · 0.0572 · 0.0854
--   -- (with the 09-04 print: n 300, as_of 2026-09-04, cell/forecast follow that print;
--   --  wf_this must still exceed wf_mig129)
--
--   SELECT jsonb_pretty(eia_draw_plan()->'cells');
--   -- 8 cells: 1:long:0 ~0.694 (n 60) · 1:long:1 ~0.399 (n 10) · 1:short:0 ~0.661 (n 77) ·
--   --          1:short:1 ~0.399 (n 10) · 0:short:0 ~0.496 (n 71) · 0:short:1 ~0.417 (n 14) ·
--   --          0:long:0 ~0.300 (n 56) · 0:long:1 ~0.464 (n 1, unmeasured: 8/9 base rate)
--   SELECT jsonb_pretty(eia_draw_plan()->'parent_cells');
--   -- the mig-129 cells, unchanged: 1:long ~0.643 · 1:short ~0.623 · 0:long ~0.295 · 0:short ~0.475
--
--   SELECT jsonb_pretty(eia_draw_plan()->'evidence'->'halves');
--   -- h1 n 100: mig129 0.1099 · this 0.1274 ;  h2 n 99: mig129 0.0038 · this 0.0429
--
--   SELECT has_function_privilege('anon', 'public.eia_draw_plan(text,numeric,integer)', 'EXECUTE') AS anon,
--          has_function_privilege('authenticated', 'public.eia_draw_plan(text,numeric,integer)', 'EXECUTE') AS authenticated,
--          has_function_privilege('service_role', 'public.eia_draw_plan(text,numeric,integer)', 'EXECUTE') AS service_role;
--   -- false · false · true
--
--   SELECT at, pr, note FROM ledger_change_log ORDER BY at DESC LIMIT 1;   -- this change, pr = the PR number
--
--   -- mig-143 AUDIT — anon-executable VOLATILE application functions — must return ZERO rows:
--   SELECT p.proname FROM pg_proc p
--   WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
--     AND p.prorettype <> 'trigger'::regtype AND p.provolatile = 'v'
--     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
--     AND p.proname NOT IN ('generate_referral_code', 'generate_share_token')
--     AND has_function_privilege('anon', p.oid, 'EXECUTE');
