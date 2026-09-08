-- 137 · calibration_cohorts(): skill by ISSUANCE cohort, and the change log it is read against
--
-- WHY THE PUBLIC PAGE NEEDS THIS. The ledger's headline is cumulative and it
-- carries the ~38,000 machine claims issued under a flat 0.5 prior (25–27
-- August, sharpness 0.000) forever: −0.199 all-time, and it will move only by
-- slow arithmetic as new cohorts resolve. "Brier by resolution week" (mig 124)
-- cannot show WHEN the forecaster changed either — a resolution week mixes
-- claims issued under different forecasters. Skill by ISSUANCE day does: on
-- 2026-09-08 it reads −0.388 (08-25), −0.279 / −0.330 with sharpness 0.000
-- (08-26/27, the flat prior), −0.235, −0.170, −0.170, then −0.021 and −0.044
-- (08-31, 09-01) once #465 gave the issuer a measured base rate. That is the
-- honest way to show a trajectory without hiding the past: the headline stays,
-- the cohort view sits beside it.
--
-- SUMS, NOT MEANS. Each cohort row carries n, sum_brier, sum_y and sum_absdev
-- alongside the derived figures, so a client can re-bucket days into weeks
-- EXACTLY (the house track issues weekly and would otherwise be one claim per
-- point). Skill is the relative Brier skill score, 1 − Brier / base·(1−base),
-- as everywhere on the ledger; NULL when the base rate is degenerate.
--
-- ONLY COMPLETE COHORTS ARE COMPARABLE. A cohort is complete when every claim
-- issued that day has passed its deadline. The claims that resolve first are
-- the ones that reappeared first — on 2026-09-08 the first 43 of the 6,607
-- claims issued on 09-07 read +0.296, which says nothing about the cohort
-- (#401 was this exact censoring: "has not had time to fail" scored as
-- success). Incomplete cohorts are returned with complete=false and their
-- open count so the page can draw them greyed and labelled, never as a bar to
-- compare against.
--
-- THE CHANGE LOG. A cohort chart without deploy markers invites the wrong
-- story. ledger_change_log holds the moments the forecaster changed, seeded
-- with the merge timestamps (UTC, from GitHub) of the four changes that
-- matter to this series. Append-only; RLS on with no policies, like every
-- run table (service role writes it from the admin module later).

CREATE TABLE IF NOT EXISTS public.ledger_change_log (
  at    timestamptz PRIMARY KEY,
  pr    text        NOT NULL,
  note  text        NOT NULL
);
ALTER TABLE public.ledger_change_log ENABLE ROW LEVEL SECURITY;

INSERT INTO public.ledger_change_log (at, pr, note) VALUES
  ('2026-09-06 21:20:37+00', '#465', 'dark-gap resolver keyed on event id; issuer anchored on a measured base rate'),
  ('2026-09-07 13:48:48+00', '#470', 'machine issuance capped per box; forecast = the box''s own rate'),
  ('2026-09-07 21:13:08+00', '#482', 'resolvers defer until the instrument has published the window'),
  ('2026-09-07 21:34:40+00', '#483', 'night-lights detection restored (period-led index, pg_cron)')
ON CONFLICT (at) DO NOTHING;

CREATE OR REPLACE FUNCTION public.calibration_cohorts(p_days integer DEFAULT 120)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH claims AS (
    SELECT r.track,
           (r.issued_at AT TIME ZONE 'UTC')::date AS day,
           r.resolves_at,
           (r.predicted_distribution->>'mean')::numeric AS p,
           o.brier, o.observed_value, o.void_reason
      FROM predictions_register r
      LEFT JOIN prediction_outcomes o ON o.prediction_id = r.id
     WHERE r.issued_at >= now() - make_interval(days => GREATEST(p_days, 1))
       AND r.track IN ('house', 'machine', 'creator')
  ),
  cohort AS (
    SELECT track, day,
           COUNT(*)                                                     AS issued,
           COUNT(*) FILTER (WHERE brier IS NOT NULL AND void_reason IS NULL) AS n,
           SUM(brier)          FILTER (WHERE brier IS NOT NULL AND void_reason IS NULL) AS sum_brier,
           SUM(observed_value) FILTER (WHERE brier IS NOT NULL AND void_reason IS NULL) AS sum_y,
           SUM(ABS(p - 0.5))   FILTER (WHERE brier IS NOT NULL AND void_reason IS NULL) AS sum_absdev,
           bool_and(resolves_at <= now())                                AS complete
      FROM claims
     GROUP BY track, day
  ),
  derived AS (
    SELECT *,
           CASE WHEN n > 0 THEN sum_brier / n END                        AS brier,
           CASE WHEN n > 0 THEN sum_y::numeric / n END                   AS base_rate,
           CASE WHEN n > 0 THEN sum_absdev / n END                       AS sharpness
      FROM cohort
  )
  SELECT jsonb_build_object(
    'days', GREATEST(p_days, 1),
    'tracks', COALESCE((
      SELECT jsonb_object_agg(track, rows) FROM (
        SELECT track, jsonb_agg(jsonb_build_object(
                 'day',        to_char(day, 'YYYY-MM-DD'),
                 'issued',     issued,
                 'n',          n,
                 'open',       issued - n,
                 'complete',   complete,
                 'sum_brier',  round(COALESCE(sum_brier, 0)::numeric, 4),
                 'sum_y',      COALESCE(sum_y, 0),
                 'sum_absdev', round(COALESCE(sum_absdev, 0)::numeric, 4),
                 'brier',      round(brier::numeric, 4),
                 'base_rate',  round(base_rate::numeric, 4),
                 'sharpness',  round(sharpness::numeric, 4),
                 'skill',      CASE WHEN base_rate IS NOT NULL AND base_rate * (1 - base_rate) > 0.001
                                    THEN round((1 - brier / (base_rate * (1 - base_rate)))::numeric, 4) END
               ) ORDER BY day) AS rows
          FROM derived GROUP BY track) t), '{}'::jsonb),
    'changes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('at', to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'pr', pr, 'note', note) ORDER BY at)
        FROM public.ledger_change_log
       WHERE at >= now() - make_interval(days => GREATEST(p_days, 1))), '[]'::jsonb)
  );
$$;

-- STEP 1 — READ ONLY (2026-09-08 expectations): machine complete cohorts 08-25..09-01
-- with skill −0.388, −0.279, −0.330, −0.235, −0.170, −0.170, −0.021, −0.044 and
-- sharpness 0.000 on 08-26/27; cohorts 09-06/07/08 complete=false; house 08-24 and
-- 08-31 complete, 09-07 open; four change-log rows.
SELECT public.calibration_cohorts(120);
