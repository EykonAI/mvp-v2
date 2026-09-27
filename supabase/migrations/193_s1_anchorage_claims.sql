-- ═══════════════════════════════════════════════════════════════════════
-- eYKON.ai — 193 · Calibration claim family s1:anchorage_count, measured
--             walk-forward BEFORE issuance (Imagery Layer build prompt
--             rev A, IMG-10). Requires 189 (S1 admission) and 170.
--
-- THE CLAIM. "At admitted anchorage <aoi>, the median Sentinel-1 bright-
-- return area over ISO week W (Monday–Sunday UTC) is above the anchorage's
-- own median of clear looks in the 120 days before W, frozen at issue."
-- feature 's1_anchorage_above_median', source 's1-anchorage', track machine,
-- observable s1:anchorage_count:<aoi>:<week_start>. Median, never mean.
--
-- THE ORDER OF THINGS (brief §8.6 — measure before building):
--   1 · Nothing issues until the S1 METHOD is admitted (mig 189). Today it
--       is not: every function below says so and issues nothing.
--   2 · Then s1_anchorage_backtest() measures the family WALK-FORWARD on the
--       admitted anchorages' own history: each past week is forecast only
--       from weeks before it — p = (k + 10) / (n + 20), the shrunk family
--       rate every eYKON machine family issues at — and scored. It prints
--       judged weeks, base rate, Brier, skill against the base rate, and
--       split-half skill. Issuance needs >= 30 judged backtest weeks (founder
--       decision F-9, proposed); the skill is printed whatever its sign.
--   3 · After issuance the family reads 'Calibrating: n of 90 judged' until
--       90 claims are judged (s1_anchorage_walkforward, as refinery-rc).
--
-- VOID, NEVER A GUESS (s1_anchorage_resolution):
--   · a week with no clear pass at that anchorage          → VOID
--   · the method or the anchorage no longer admitted       → VOID
--   · malformed context                                    → VOID
--   · no S1 check has covered the week 45 days after it    → VOID
--   · the S1 check has not yet looked past the week        → defer (#482)
-- and a source with no resolver case is VOID in the scorer (mig 170).
--
-- ACCESS: service_role only. APPLY: after 189 and 170, manually, whole
-- file, BEFORE merge. Then supabase/tests/img10_guards.sql — ONE row.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL lock_timeout = '10s';

DO $$
BEGIN
  IF to_regprocedure('public.imagery_s1_status()') IS NULL THEN
    RAISE EXCEPTION '193 requires 189 (Sentinel-1 go-live) — apply 189 first';
  END IF;
  IF to_regprocedure('public.refinery_rc_resolution(text,jsonb,timestamptz)') IS NULL THEN
    RAISE EXCEPTION '193 requires 170 (refinery-rc claims) — its source list is extended here';
  END IF;
END $$;

-- ─── 1 · Resolution ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s1_anchorage_resolution(p_context jsonb, p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $function$
DECLARE
  c_stale_days CONSTANT integer := 45;
  v_aoi   text := p_context->>'aoi_id';
  v_ws    date;
  v_we    date;
  v_base  double precision;
  v_adm   record;
  v_clock timestamptz;
  v_med   double precision;
  v_n     integer;
BEGIN
  BEGIN
    v_ws   := (p_context->>'week_start')::date;
    v_we   := (p_context->>'week_end')::date;
    v_base := (p_context->>'baseline_median')::double precision;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('state', 'void', 'void_reason', 's1-anchorage claim context is malformed (' || SQLERRM || ')');
  END;
  IF v_aoi IS NULL OR v_ws IS NULL OR v_we IS NULL OR v_we - v_ws <> 6 OR extract(isodow FROM v_ws) <> 1
     OR v_base IS NULL OR v_base <= 0 THEN
    RETURN jsonb_build_object('state', 'void', 'void_reason',
             's1-anchorage claim needs aoi_id, a Monday–Sunday week and a positive frozen baseline_median');
  END IF;

  SELECT * INTO v_adm FROM public.imagery_s1_admissions ORDER BY id DESC LIMIT 1;
  IF v_adm.id IS NULL OR NOT v_adm.method_admitted OR NOT (v_aoi = ANY (v_adm.admitted_aois)) THEN
    RETURN jsonb_build_object('state', 'void', 'void_reason',
             'Sentinel-1 method or anchorage ' || v_aoi || ' is not admitted at resolution (latest admission '
             || coalesce(v_adm.id::text, 'none') || ') — the reading is not served, so the claim is not judged');
  END IF;

  -- the anchorage's own S1 data clock: how far the ingest has looked
  SELECT max(c.window_to) INTO v_clock FROM public.imagery_aoi_checks c
   WHERE c.aoi_id = v_aoi AND c.sensor = 's1_grd' AND c.error IS NULL;
  IF v_clock IS NULL OR v_clock < (v_we + 1)::timestamptz THEN
    IF p_now >= (v_we + 1 + c_stale_days)::timestamptz THEN
      RETURN jsonb_build_object('state', 'void', 'void_reason',
               'no Sentinel-1 check covered ' || v_ws || '..' || v_we || ' within ' || c_stale_days || ' days — unobserved, not below baseline');
    END IF;
    RETURN jsonb_build_object('state', 'defer', 'data_clock', v_clock);
  END IF;

  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY o.metric_value), count(*)
    INTO v_med, v_n
    FROM public.imagery_observations o
   WHERE o.aoi_id = v_aoi AND o.sensor = 's1_grd' AND o.metric_name = 'bright_target_area_m2'
     AND o.coverage_state = 'clear' AND o.metric_value IS NOT NULL
     AND o.acquired_at >= v_ws::timestamptz AND o.acquired_at < (v_we + 1)::timestamptz;
  IF v_n = 0 THEN
    RETURN jsonb_build_object('state', 'void', 'void_reason',
             'no clear Sentinel-1 pass at ' || v_aoi || ' in ' || v_ws || '..' || v_we || ' — a week not seen is not a week below baseline');
  END IF;

  RETURN jsonb_build_object('state', 'ready', 'observed', CASE WHEN v_med > v_base THEN 1 ELSE 0 END,
           'evidence', jsonb_build_object('week_median_m2', v_med, 'clear_passes', v_n, 'baseline_median_m2', v_base, 'data_clock', v_clock));
END
$function$;

-- ─── 2 · Walk-forward backtest (before any issuance) ───────────────────
CREATE OR REPLACE FUNCTION public.s1_anchorage_backtest(p_weeks integer DEFAULT 26)
RETURNS TABLE (measurable boolean, reason text, anchorages integer, judged integer, unseen_weeks integer,
               no_baseline_weeks integer, base_rate double precision, brier double precision, skill double precision,
               skill_half_1 double precision, skill_half_2 double precision, n_half_1 integer, n_half_2 integer,
               first_forecast double precision)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $function$
DECLARE
  v_adm  record;
  v_from date;
BEGIN
  SELECT * INTO v_adm FROM public.imagery_s1_admissions ORDER BY id DESC LIMIT 1;
  IF v_adm.id IS NULL OR NOT v_adm.method_admitted THEN
    RETURN QUERY SELECT false, 'not measurable: the Sentinel-1 method is not admitted ('
                        || CASE WHEN v_adm.id IS NULL THEN 'no admission recorded' ELSE 'latest admission failed' END || ')',
                        0, 0, 0, 0, NULL::double precision, NULL::double precision, NULL::double precision,
                        NULL::double precision, NULL::double precision, 0, 0, NULL::double precision;
    RETURN;
  END IF;
  -- whole ISO weeks, ending with the last complete one
  v_from := (date_trunc('week', now()) - make_interval(weeks => least(greatest(p_weeks, 4), 104)))::date;

  RETURN QUERY
  WITH weeks AS (
    SELECT a.aoi, w::date AS ws
      FROM unnest(v_adm.admitted_aois) AS a(aoi)
      CROSS JOIN generate_series(v_from, (date_trunc('week', now()) - interval '1 week')::date, interval '1 week') AS w
  ), graded AS (
    SELECT wk.aoi, wk.ws,
           (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY o.metric_value)
              FROM public.imagery_observations o
             WHERE o.aoi_id = wk.aoi AND o.sensor = 's1_grd' AND o.coverage_state = 'clear' AND o.metric_value IS NOT NULL
               AND o.acquired_at >= wk.ws::timestamptz AND o.acquired_at < (wk.ws + 7)::timestamptz) AS week_med,
           (SELECT count(*) FROM public.imagery_observations o
             WHERE o.aoi_id = wk.aoi AND o.sensor = 's1_grd' AND o.coverage_state = 'clear' AND o.metric_value IS NOT NULL
               AND o.acquired_at >= (wk.ws - 120)::timestamptz AND o.acquired_at < wk.ws::timestamptz) AS base_n,
           (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY o.metric_value)
              FROM public.imagery_observations o
             WHERE o.aoi_id = wk.aoi AND o.sensor = 's1_grd' AND o.coverage_state = 'clear' AND o.metric_value IS NOT NULL
               AND o.acquired_at >= (wk.ws - 120)::timestamptz AND o.acquired_at < wk.ws::timestamptz) AS base_med
      FROM weeks wk
  ), judged AS (
    SELECT g.aoi, g.ws, CASE WHEN g.week_med > g.base_med THEN 1 ELSE 0 END AS o
      FROM graded g
     WHERE g.week_med IS NOT NULL AND g.base_n >= 3 AND g.base_med > 0
  ), forecast AS (
    -- walk-forward: week W's forecast uses only outcomes of weeks strictly before W
    SELECT j.*,
           (coalesce((SELECT sum(p.o) FROM judged p WHERE p.ws < j.ws), 0) + 10)::double precision
             / ((SELECT count(*) FROM judged p WHERE p.ws < j.ws) + 20) AS p_fc
      FROM judged j
  ), halves AS (
    SELECT f.*, ntile(2) OVER (ORDER BY f.ws, f.aoi) AS h FROM forecast f
  ), agg AS (
    SELECT count(*)::integer AS n, avg(o::double precision) AS base, avg((p_fc - o) ^ 2) AS brier,
           count(*) FILTER (WHERE h = 1)::integer AS n1, count(*) FILTER (WHERE h = 2)::integer AS n2,
           avg(o::double precision) FILTER (WHERE h = 1) AS base1, avg((p_fc - o) ^ 2) FILTER (WHERE h = 1) AS brier1,
           avg(o::double precision) FILTER (WHERE h = 2) AS base2, avg((p_fc - o) ^ 2) FILTER (WHERE h = 2) AS brier2
      FROM halves
  )
  SELECT true,
         CASE WHEN a.n >= 30 THEN 'measured: ' || a.n || ' judged backtest weeks'
              ELSE 'measured but too short to issue: ' || a.n || ' of 30 judged backtest weeks' END,
         cardinality(v_adm.admitted_aois),
         a.n,
         (SELECT count(*)::integer FROM graded g WHERE g.week_med IS NULL),
         (SELECT count(*)::integer FROM graded g WHERE g.week_med IS NOT NULL AND NOT (g.base_n >= 3 AND g.base_med > 0)),
         a.base, a.brier,
         CASE WHEN a.base * (1 - a.base) > 0.001 THEN 1 - a.brier / (a.base * (1 - a.base)) END,
         CASE WHEN a.base1 * (1 - a.base1) > 0.001 THEN 1 - a.brier1 / (a.base1 * (1 - a.base1)) END,
         CASE WHEN a.base2 * (1 - a.base2) > 0.001 THEN 1 - a.brier2 / (a.base2 * (1 - a.base2)) END,
         a.n1, a.n2,
         -- the earliest judged week had no earlier outcomes: its forecast must be the
         -- flat prior 10/20 = 0.5 — anything else means the forecast looked ahead
         (SELECT f.p_fc FROM forecast f ORDER BY f.ws, f.aoi LIMIT 1)
    FROM agg a;
END
$function$;

COMMENT ON FUNCTION public.s1_anchorage_backtest(integer) IS
  'IMG-10 (mig 193). Walk-forward backtest of s1_anchorage_above_median over the admitted anchorages'' last p_weeks whole ISO weeks: each week forecast from earlier weeks only at p = (k+10)/(n+20); weeks with no clear pass are unseen (not judged), weeks without a 120-day baseline of >= 3 clear looks are not judged. Prints base rate, Brier, skill vs base rate and split halves. Not measurable until the S1 method is admitted.';

-- ─── 3 · Post-issuance monitor ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s1_anchorage_walkforward(p_min_judged integer DEFAULT 90, p_alpha integer DEFAULT 20)
RETURNS TABLE (issued integer, judged integer, k integer, void integer, open integer, base_rate double precision,
               brier double precision, skill double precision, p_next double precision, status text)
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  WITH c AS (
    SELECT r.id, o.prediction_id IS NOT NULL AS resolved, o.void_reason, o.observed_value, o.brier
      FROM public.predictions_register r
      LEFT JOIN public.prediction_outcomes o ON o.prediction_id = r.id
     WHERE r.source = 's1-anchorage' AND r.track = 'machine'
  ), a AS (
    SELECT count(*)::integer AS issued,
           count(*) FILTER (WHERE resolved AND void_reason IS NULL AND brier IS NOT NULL)::integer AS judged,
           coalesce(sum(observed_value) FILTER (WHERE resolved AND void_reason IS NULL AND brier IS NOT NULL), 0)::integer AS k,
           count(*) FILTER (WHERE void_reason IS NOT NULL)::integer AS void,
           count(*) FILTER (WHERE NOT resolved)::integer AS open,
           avg(observed_value) FILTER (WHERE resolved AND void_reason IS NULL AND brier IS NOT NULL) AS base,
           avg(brier) FILTER (WHERE resolved AND void_reason IS NULL AND brier IS NOT NULL) AS brier
      FROM c
  )
  SELECT a.issued, a.judged, a.k, a.void, a.open, a.base, a.brier,
         CASE WHEN a.base * (1 - a.base) > 0.001 THEN 1 - a.brier / (a.base * (1 - a.base)) END,
         (a.k + p_alpha / 2.0) / (a.judged + p_alpha),
         CASE WHEN a.judged < p_min_judged THEN format('Calibrating: %s of %s judged claims', a.judged, p_min_judged)
              ELSE 'Scored' END
    FROM a
$function$;

-- ─── 4 · Issuance plan: gate + candidates ──────────────────────────────
CREATE OR REPLACE FUNCTION public.s1_anchorage_claim_plan(p_min_backtest integer DEFAULT 30)
RETURNS TABLE (issuing boolean, reason text, aoi_id text, name text, week_start date, week_end date,
               baseline_median double precision, baseline_n integer, p double precision, admission_id bigint,
               backtest jsonb, family_status text)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $function$
DECLARE
  v_adm  record;
  v_bt   record;
  v_wf   record;
  v_ws   date := (date_trunc('week', now()) + interval '1 week')::date;   -- next Monday: nothing of W is on disk
BEGIN
  SELECT * INTO v_adm FROM public.imagery_s1_admissions ORDER BY id DESC LIMIT 1;
  SELECT * INTO v_bt FROM public.s1_anchorage_backtest(26);
  SELECT * INTO v_wf FROM public.s1_anchorage_walkforward(90, 20);
  IF v_adm.id IS NULL OR NOT v_adm.method_admitted THEN
    RETURN QUERY SELECT false, 'not issuing: the Sentinel-1 method is not admitted', NULL::text, NULL::text, NULL::date, NULL::date,
      NULL::double precision, NULL::integer, NULL::double precision, v_adm.id, to_jsonb(v_bt), v_wf.status;
    RETURN;
  END IF;
  IF NOT v_bt.measurable OR v_bt.judged < p_min_backtest THEN
    RETURN QUERY SELECT false, 'not issuing: walk-forward backtest has ' || coalesce(v_bt.judged, 0) || ' of ' || p_min_backtest || ' judged weeks',
      NULL::text, NULL::text, NULL::date, NULL::date, NULL::double precision, NULL::integer, NULL::double precision,
      v_adm.id, to_jsonb(v_bt), v_wf.status;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT true, 'issuing', a.aoi_id, a.name, v_ws, v_ws + 6, b.med, b.n, v_wf.p_next, v_adm.id, to_jsonb(v_bt), v_wf.status
    FROM public.imagery_aois a
    CROSS JOIN LATERAL (
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY o.metric_value) AS med, count(*)::integer AS n
        FROM public.imagery_observations o
       WHERE o.aoi_id = a.aoi_id AND o.sensor = 's1_grd' AND o.coverage_state = 'clear' AND o.metric_value IS NOT NULL
         AND o.acquired_at >= (v_ws - 120)::timestamptz AND o.acquired_at < now()) b
   WHERE a.aoi_id = ANY (v_adm.admitted_aois) AND a.retired_at IS NULL
     AND b.n >= 3 AND b.med > 0
     AND NOT EXISTS (SELECT 1 FROM public.predictions_register r
                      WHERE r.source = 's1-anchorage' AND r.target_observable = 's1:anchorage_count:' || a.aoi_id || ':' || v_ws)
   ORDER BY a.aoi_id;
END
$function$;

COMMENT ON FUNCTION public.s1_anchorage_claim_plan(integer) IS
  'IMG-10 (mig 193). What the S1 issuer may claim for the NEXT ISO week (nothing of it on disk): one claim per admitted anchorage with a 120-day baseline of >= 3 clear looks, at p = the family''s shrunk judged rate. Refuses — with the reason and the backtest — until the method is admitted and the walk-forward backtest has >= p_min_backtest judged weeks.';

REVOKE EXECUTE ON FUNCTION public.s1_anchorage_resolution(jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.s1_anchorage_backtest(integer)             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.s1_anchorage_walkforward(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.s1_anchorage_claim_plan(integer)          FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.s1_anchorage_resolution(jsonb, timestamptz) TO service_role;
GRANT  EXECUTE ON FUNCTION public.s1_anchorage_backtest(integer)             TO service_role;
GRANT  EXECUTE ON FUNCTION public.s1_anchorage_walkforward(integer, integer) TO service_role;
GRANT  EXECUTE ON FUNCTION public.s1_anchorage_claim_plan(integer)          TO service_role;

-- ─── 5 · The source (every existing value kept) ────────────────────────
ALTER TABLE public.predictions_register DROP CONSTRAINT IF EXISTS predictions_register_source_check;
ALTER TABLE public.predictions_register
  ADD CONSTRAINT predictions_register_source_check
  CHECK (source = ANY (ARRAY[
    'manual'::text, 'polymarket'::text, 'eia'::text, 'ofac'::text, 'kalshi'::text, 'ai'::text,
    'ais'::text, 'ais-darkgap'::text, 'firms'::text,
    'firms-recovery'::text,   -- mig 127
    'blackmarble'::text,      -- mig 128
    'refinery-rc'::text,      -- mig 170
    's1-anchorage'::text      -- mig 193: Sentinel-1 anchorage family (resolver above)
  ])) NOT VALID;
ALTER TABLE public.predictions_register VALIDATE CONSTRAINT predictions_register_source_check;

-- ─── 6 · The scorer works data-clock sources last (mig 170 body + one source)
CREATE OR REPLACE FUNCTION public.due_unscored_predictions(p_limit integer DEFAULT 500)
RETURNS TABLE(id uuid, feature text, source text, predicted_distribution jsonb, target_observable text,
              resolves_at timestamptz, issued_at timestamptz, context jsonb, persona text)
LANGUAGE sql
STABLE
AS $function$
  SELECT r.id, r.feature, r.source, r.predicted_distribution, r.target_observable,
         r.resolves_at, r.issued_at, r.context, r.persona
  FROM predictions_register r
  WHERE r.resolves_at <= now()
    AND NOT EXISTS (
      SELECT 1 FROM prediction_outcomes o WHERE o.prediction_id = r.id
    )
  -- Sources whose resolver waits on an instrument's data clock (#482) go last:
  -- they defer for days and would otherwise hold slots on every tick (mig 155;
  -- 'refinery-rc' added by mig 170, 's1-anchorage' by mig 193).
  ORDER BY CASE WHEN r.source IN ('blackmarble', 'firms-recovery', 'refinery-rc', 's1-anchorage') THEN 1 ELSE 0 END,
           r.resolves_at
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 2000);
$function$;

-- ─── 7 · The decision, on the record ───────────────────────────────────
INSERT INTO public.ledger_change_log (at, pr, note)
SELECT now(), 'IMG-10 · mig 193',
       's1-anchorage (mig 193): machine-track family s1_anchorage_above_median — the weekly median Sentinel-1 bright-return area at an admitted anchorage vs its own 120-day median, frozen at issue. Issues nothing until the S1 method is admitted (mig 189) AND a walk-forward backtest on the anchorages'' own history has >= 30 judged weeks (F-9, proposed); p = (k + 10) / (n + 20); Calibrating until 90 judged. A week with no clear pass, a revoked admission or a 45-day-unobserved week is VOID, never 0.5.'
 WHERE NOT EXISTS (SELECT 1 FROM public.ledger_change_log WHERE note LIKE 's1-anchorage (mig 193)%');

COMMIT;

-- VERIFY (read only; the Sentinel-1 functions are service_role only — run as postgres in the SQL Editor)
SELECT (SELECT pg_get_constraintdef(oid) LIKE '%s1-anchorage%' FROM pg_constraint WHERE conname = 'predictions_register_source_check') AS source_added,
       (SELECT pg_get_functiondef('public.due_unscored_predictions'::regproc) LIKE '%s1-anchorage%')                     AS scorer_orders_it_last,
       (SELECT reason FROM public.s1_anchorage_claim_plan(30) LIMIT 1)                                                   AS issuing_now,
       (SELECT status FROM public.s1_anchorage_walkforward(90, 20))                                                      AS family_status;
