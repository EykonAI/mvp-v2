-- 155 · A cohort is "judged" when nothing in it is still open — and a VOID is
--       not open. Also: the scorer works the claims that CAN resolve first.
--
-- WHAT WENT WRONG (seen 2026-09-09 23:53 UTC, first scorer tick on the 09-06 cohort)
-- ---------------------------------------------------------------------------
-- 1. calibration_cohorts() (mig 137) reports open = issued − n, where n counts
--    SCORED claims only. A voided claim therefore counts as "open" forever.
--    #513 made the public headline and both cohort charts require open = 0
--    before a cohort is quoted; with 1,816 duplicate voids in the 09-01 cohort
--    and 3,858 in 09-06 (mig 150), neither could ever qualify, and the headline
--    fell back to 08-31 (n 4,882, −0.021) instead of 09-01 (n 1,826, −0.044).
--    Fix: open = issued − n − void, and `void` is reported on every cohort.
-- 2. due_unscored_predictions() (mig 120) orders due claims oldest-first with
--    a LIMIT of 500 per tick. The 207 night-lights / FIRMS claims that the
--    data-clock guard (#482) defers every hour are the OLDEST due rows, so
--    they occupy 207 of the 500 slots on every tick: the 22:10 and 23:07 ticks
--    scored 293 each while 7,657 dark-contact claims (whose outcome is already
--    known) waited. At that rate the 09-06 cohort needs ~26 ticks. Fix: claims
--    from sources whose resolver waits on a data clock ('blackmarble',
--    'firms-recovery') are ordered LAST; within each group oldest-first as
--    before. Nothing is skipped — a deferred claim is still tried whenever
--    slots remain — and the LIMIT and signature are unchanged.

BEGIN;

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
           COUNT(*) FILTER (WHERE void_reason IS NOT NULL)              AS void,
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
                 'void',       void,
                 -- open = not yet judged: neither scored nor voided (mig 155)
                 'open',       issued - n - void,
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

COMMENT ON FUNCTION public.calibration_cohorts(integer) IS
  'Skill by issuance cohort per track (mig 137); mig 155 adds void per cohort and defines open = issued − n − void, so a judged cohort reads open = 0.';

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
  -- Sources whose resolver waits on an instrument's data clock (#482) go last:
  -- they defer for days and would otherwise hold slots on every tick (mig 155).
  ORDER BY CASE WHEN r.source IN ('blackmarble', 'firms-recovery') THEN 1 ELSE 0 END,
           r.resolves_at
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 2000);
$$;

COMMENT ON FUNCTION public.due_unscored_predictions(integer) IS
  'Due, unscored claims for the scorer (mig 120); mig 155 orders data-clock-deferred sources (blackmarble, firms-recovery) after everything else so a deferring claim never starves one that can resolve.';

REVOKE EXECUTE ON FUNCTION public.due_unscored_predictions(integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.due_unscored_predictions(integer) TO service_role;

COMMIT;

-- STEP 1 — READ ONLY, before applying (2026-09-09 23:5x UTC expectations):
--   SELECT day, issued, n, open FROM jsonb_to_recordset(calibration_cohorts(30)->'tracks'->'machine')
--     AS x(day text, issued int, n int, open int) WHERE day IN ('2026-09-01','2026-09-06');
--   -- 09-01: issued 3,642 · n 1,826 · open 1,816 (the voids counted as open — the fault)
--   -- 09-06: issued 12,101 · n ~586+ · open ~11,515 (3,858 voids + the unjudged remainder)
--   SELECT source, count(*) FROM due_unscored_predictions(500) GROUP BY 1;
--   -- blackmarble ~196 · firms-recovery ~10 · eia 1 · ais-darkgap ~293 (deferrers first)
--
-- VERIFY, after applying (rows on screen):
--   SELECT day, issued, n, void, open, complete FROM jsonb_to_recordset(calibration_cohorts(30)->'tracks'->'machine')
--     AS x(day text, issued int, n int, void int, open int, complete boolean) WHERE day IN ('2026-08-31','2026-09-01','2026-09-06');
--   -- 09-01: void 1,816 · open 0 · complete true ; 09-06: void 3,858 · open = 8,243 − n ; 08-31: void 0 · open 0
--   SELECT source, count(*) FROM due_unscored_predictions(500) GROUP BY 1;
--   -- ais-darkgap 500 while a dark-contact backlog exists; blackmarble/firms-recovery only once it is drained
--   SELECT has_function_privilege('anon', 'public.due_unscored_predictions(integer)', 'EXECUTE') AS anon,
--          has_function_privilege('service_role', 'public.due_unscored_predictions(integer)', 'EXECUTE') AS service_role;   -- false · true
--   -- mig-143 audit (must return zero rows):
--   SELECT p.proname FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
--     AND p.prorettype <> 'trigger'::regtype AND p.provolatile = 'v'
--     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
--     AND p.proname NOT IN ('generate_referral_code', 'generate_share_token')
--     AND has_function_privilege('anon', p.oid, 'EXECUTE');
