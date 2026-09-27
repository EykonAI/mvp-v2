-- ═══════════════════════════════════════════════════════════════════════
-- eYKON.ai — 191 · Imagery into NOTIF, BRIEFS and posture (Imagery Layer
--             build prompt rev A, IMG-8). Requires 184, 189.
--
--   1 · A NEW CHEAP RULE TYPE, 'imagery_change': "tell me when a watched
--       site's satellite reading moves ≥ X % from its OWN median".
--       imagery_rule_evaluate() judges every NEW look for one rule and
--       writes ONE ledger row per look — outcome 'fired', 'below_threshold',
--       'no_baseline' (fewer than 3 clear looks before it) or 'void' (the
--       look did not see the site: cloudy, partly cloudy, partial swath,
--       no acquisition, processing error). A cloudy week therefore fires
--       nothing and leaves a 'void' row per look — the "logs VOID" the
--       build prompt asks for — and the ledger is also the dedupe (a look
--       is judged once per rule, like firms_alert_dispatches).
--       Sensors: s2_l2a (median NDVI, a spectral reading — the alert says
--       "NDVI moved", never "stockpile grew"); s1_grd ONLY through
--       imagery_s1_readings(), i.e. nothing until the S1 method is
--       admitted (mig 189).
--
--   2 · WEEKLY BRIEF ITEM. imagery_weekly_movements(days, pct) — per site
--       the latest clear, baselined look in the window that moved ≥ pct
--       from its own median, with its chip and date. A VOID look has no
--       value and cannot appear; a site whose only looks were VOID is
--       simply absent.
--
--   3 · POSTURE. imagery_theatre_term(bbox, days) — among ADMITTED S1
--       sites inside a theatre with a clear look in the window, the share
--       at ≥ 1.5× their own median. NULL when there is no such site
--       (today: no admission), and the posture cron then keeps the
--       four-domain formula. posture_scores.composite_formula records
--       which formula wrote each row, so readers stop guessing from
--       whether imagery is NULL (IMG-0's storedComposite heuristic).
--
-- ACCESS: RLS on, service_role only. APPLY: after 189, manually, whole file,
-- BEFORE merge. Then supabase/tests/img8_guards.sql — ONE result row.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.imagery_s1_readings(integer)') IS NULL THEN
    RAISE EXCEPTION '191 requires 189 (Sentinel-1 go-live) — apply 189 first';
  END IF;
END $$;

-- ─── 1 · Rule type ─────────────────────────────────────────────────────
ALTER TABLE public.user_notification_rules DROP CONSTRAINT IF EXISTS user_notification_rules_rule_type_check;
ALTER TABLE public.user_notification_rules ADD CONSTRAINT user_notification_rules_rule_type_check
  CHECK (rule_type IN ('single_event','multi_event','outcome_ai','cross_data_ai','aggregate','firms_proximity','imagery_change'));

DROP INDEX IF EXISTS public.idx_user_notification_rules_cheap_active;
CREATE INDEX idx_user_notification_rules_cheap_active
  ON public.user_notification_rules (rule_type, last_fired_at)
  WHERE active = true AND rule_type IN ('single_event','multi_event','aggregate','firms_proximity','imagery_change');

CREATE TABLE IF NOT EXISTS public.imagery_rule_evaluations (
  rule_id          uuid        NOT NULL REFERENCES public.user_notification_rules (id) ON DELETE CASCADE,
  aoi_id           text        NOT NULL REFERENCES public.imagery_aois (aoi_id),
  sensor           text        NOT NULL,
  acquired_at      timestamptz NOT NULL,
  coverage_state   text        NOT NULL,
  outcome          text        NOT NULL,
  value            double precision,
  baseline_median  double precision,
  baseline_n       integer,
  change_pct       double precision,
  evaluated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rule_id, aoi_id, sensor, acquired_at),
  CONSTRAINT ire_sensor  CHECK (sensor IN ('s2_l2a','s1_grd')),
  CONSTRAINT ire_outcome CHECK (outcome IN ('fired','below_threshold','no_baseline','void')),
  -- VOID: a look that did not see the site carries no value and no change
  CONSTRAINT ire_void_no_value CHECK (outcome <> 'void' OR (value IS NULL AND change_pct IS NULL)),
  CONSTRAINT ire_void_is_not_clear CHECK ((outcome = 'void') = (coverage_state <> 'clear')),
  CONSTRAINT ire_judged_has_change CHECK (outcome NOT IN ('fired','below_threshold') OR (change_pct IS NOT NULL AND baseline_n >= 3))
);

COMMENT ON TABLE public.imagery_rule_evaluations IS
  'IMG-8 (mig 191). One row per (imagery_change rule, site, look): how the rule judged that look. void = the look did not see the site (logged, never fired, never zero); no_baseline = fewer than 3 earlier clear looks. Also the dedupe: a look is judged once per rule.';

CREATE OR REPLACE FUNCTION public.imagery_rule_evaluate(
  p_rule_id uuid, p_sensor text, p_aoi_id text, p_kind text,
  p_direction text, p_min_change_pct double precision, p_since timestamptz)
RETURNS TABLE (aoi_id text, name text, kind text, sensor text, acquired_at timestamptz, coverage_state text,
               outcome text, value double precision, baseline_median double precision, baseline_n integer,
               change_pct double precision, chip_path text)
LANGUAGE plpgsql
AS $function$
#variable_conflict use_column
BEGIN
  IF p_sensor NOT IN ('s2_l2a','s1_grd') THEN RAISE EXCEPTION 'imagery_rule_evaluate: sensor %', p_sensor; END IF;
  IF p_direction NOT IN ('up','down','either') THEN RAISE EXCEPTION 'imagery_rule_evaluate: direction %', p_direction; END IF;
  IF p_min_change_pct IS NULL OR p_min_change_pct < 10 OR p_min_change_pct > 500 THEN
    RAISE EXCEPTION 'imagery_rule_evaluate: min_change_pct must be 10..500';
  END IF;
  IF p_aoi_id IS NULL AND p_kind IS NULL THEN RAISE EXCEPTION 'imagery_rule_evaluate: name a site or a site kind'; END IF;

  RETURN QUERY
  WITH looks AS (
    SELECT o.aoi_id, a.name, a.kind, o.sensor, o.acquired_at, o.coverage_state, o.metric_value AS v,
           o.baseline_median AS b, o.baseline_n AS bn, o.chip_path
      FROM public.imagery_observations o
      JOIN public.imagery_aois a ON a.aoi_id = o.aoi_id
     WHERE p_sensor = 's2_l2a' AND o.sensor = 's2_l2a'
       AND o.acquired_at >= p_since
       AND (p_aoi_id IS NULL OR o.aoi_id = p_aoi_id) AND (p_kind IS NULL OR a.kind = p_kind)
    UNION ALL
    -- S1 only through the admission gate (empty until admitted)
    SELECT r.aoi_id, r.name, r.kind, 's1_grd', r.acquired_at, r.coverage_state, r.bright_area_m2,
           r.baseline_median, r.baseline_n, NULL::text
      FROM public.imagery_s1_readings(120) r
     WHERE p_sensor = 's1_grd' AND r.acquired_at >= p_since
       AND (p_aoi_id IS NULL OR r.aoi_id = p_aoi_id) AND (p_kind IS NULL OR r.kind = p_kind)
  ), judged AS (
    SELECT l.*,
           CASE WHEN l.coverage_state = 'clear' AND l.v IS NOT NULL AND l.bn >= 3 AND l.b > 0
                THEN round(((l.v / l.b - 1) * 100)::numeric, 1)::double precision END AS pct
      FROM looks l
  ), classed AS (
    SELECT j.*,
           CASE WHEN j.coverage_state <> 'clear' OR j.v IS NULL THEN 'void'
                WHEN j.pct IS NULL THEN 'no_baseline'
                WHEN (p_direction = 'up'     AND j.pct >=  p_min_change_pct)
                  OR (p_direction = 'down'   AND j.pct <= -p_min_change_pct)
                  OR (p_direction = 'either' AND abs(j.pct) >= p_min_change_pct) THEN 'fired'
                ELSE 'below_threshold' END AS oc
      FROM judged j
  ), ins AS (
    INSERT INTO public.imagery_rule_evaluations AS e
      (rule_id, aoi_id, sensor, acquired_at, coverage_state, outcome, value, baseline_median, baseline_n, change_pct)
    SELECT p_rule_id, c.aoi_id, c.sensor, c.acquired_at, c.coverage_state, c.oc,
           CASE WHEN c.oc = 'void' THEN NULL ELSE c.v END, c.b, c.bn,
           CASE WHEN c.oc IN ('fired','below_threshold') THEN c.pct END
      FROM classed c
    ON CONFLICT (rule_id, aoi_id, sensor, acquired_at) DO NOTHING
    RETURNING e.aoi_id, e.sensor, e.acquired_at
  )
  SELECT c.aoi_id, c.name, c.kind, c.sensor, c.acquired_at, c.coverage_state, c.oc,
         CASE WHEN c.oc = 'void' THEN NULL ELSE c.v END, c.b, c.bn,
         CASE WHEN c.oc IN ('fired','below_threshold') THEN c.pct END, c.chip_path
    FROM classed c
    JOIN ins i ON i.aoi_id = c.aoi_id AND i.sensor = c.sensor AND i.acquired_at = c.acquired_at
   ORDER BY c.acquired_at, c.aoi_id;
END
$function$;

COMMENT ON FUNCTION public.imagery_rule_evaluate(uuid, text, text, text, text, double precision, timestamptz) IS
  'IMG-8 (mig 191). Judges every look not yet judged for this imagery_change rule and returns the NEWLY judged ones with their outcome (fired | below_threshold | no_baseline | void). A VOID look is logged and never fires. S1 only via imagery_s1_readings (admitted).';

-- ─── 2 · Weekly brief item ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.imagery_weekly_movements(p_days integer DEFAULT 7, p_min_change_pct double precision DEFAULT 20)
RETURNS TABLE (aoi_id text, name text, kind text, sensor text, acquired_at timestamptz, metric_name text,
               value double precision, baseline_median double precision, baseline_n integer, change_pct double precision,
               chip_path text)
LANGUAGE sql
STABLE
AS $function$
  WITH s2 AS (
    SELECT o.aoi_id, a.name, a.kind, o.sensor, o.acquired_at, o.metric_name, o.metric_value AS v,
           o.baseline_median AS b, o.baseline_n AS bn, o.chip_path
      FROM public.imagery_observations o
      JOIN public.imagery_aois a ON a.aoi_id = o.aoi_id
     WHERE o.sensor = 's2_l2a' AND o.coverage_state = 'clear' AND o.metric_value IS NOT NULL
       AND o.baseline_n >= 3 AND o.baseline_median > 0
       AND o.acquired_at >= now() - make_interval(days => least(greatest(p_days, 1), 31))
  ), s1 AS (
    SELECT r.aoi_id, r.name, r.kind, 's1_grd'::text, r.acquired_at, 'bright_target_area_m2'::text, r.bright_area_m2,
           r.baseline_median, r.baseline_n, NULL::text
      FROM public.imagery_s1_readings(least(greatest(p_days, 1), 31)) r
     WHERE r.coverage_state = 'clear' AND r.bright_area_m2 IS NOT NULL AND r.baseline_n >= 3 AND r.baseline_median > 0
  ), latest AS (
    SELECT DISTINCT ON (x.aoi_id, x.sensor) x.*
      FROM (SELECT * FROM s2 UNION ALL SELECT * FROM s1) x
     ORDER BY x.aoi_id, x.sensor, x.acquired_at DESC
  )
  SELECT l.aoi_id, l.name, l.kind, l.sensor, l.acquired_at, l.metric_name, l.v, l.b, l.bn,
         round(((l.v / l.b - 1) * 100)::numeric, 1)::double precision, l.chip_path
    FROM latest l
   WHERE abs(l.v / l.b - 1) * 100 >= greatest(p_min_change_pct, 10)
   ORDER BY abs(l.v / l.b - 1) DESC, l.aoi_id
   LIMIT 12
$function$;

COMMENT ON FUNCTION public.imagery_weekly_movements(integer, double precision) IS
  'IMG-8 (mig 191). For the weekly brief: per site and sensor, the LATEST clear, baselined (n >= 3) look in the window, kept when it moved >= pct from its own median. VOID looks have no value and never appear; S1 only when admitted. At most 12.';

-- ─── 3 · Posture imagery term ──────────────────────────────────────────
ALTER TABLE public.posture_scores ADD COLUMN IF NOT EXISTS composite_formula text;
COMMENT ON COLUMN public.posture_scores.composite_formula IS
  'IMG-8 (mig 191). The formula that wrote this row: four-domain-v2 (imagery NULL) or five-domain-v3 (real imagery term). NULL = written before 191 — the legacy fixture-imagery rows IMG-0 reconstructs.';

CREATE OR REPLACE FUNCTION public.imagery_theatre_term(
  p_lat_min double precision, p_lat_max double precision, p_lon_min double precision, p_lon_max double precision,
  p_days integer DEFAULT 14)
RETURNS TABLE (sites_seen integer, sites_above integer, share double precision)
LANGUAGE sql
STABLE
AS $function$
  WITH latest AS (
    SELECT DISTINCT ON (r.aoi_id) r.aoi_id, r.ratio_to_baseline
      FROM public.imagery_s1_readings(least(greatest(p_days, 1), 60)) r
     WHERE r.coverage_state = 'clear' AND r.bright_area_m2 IS NOT NULL AND r.baseline_n >= 3
       AND r.ratio_to_baseline IS NOT NULL
       AND r.centroid_lat BETWEEN p_lat_min AND p_lat_max
       AND r.centroid_lon BETWEEN p_lon_min AND p_lon_max
     ORDER BY r.aoi_id, r.acquired_at DESC
  )
  SELECT count(*)::integer,
         count(*) FILTER (WHERE l.ratio_to_baseline >= 1.5)::integer,
         CASE WHEN count(*) > 0
              THEN round((count(*) FILTER (WHERE l.ratio_to_baseline >= 1.5))::numeric / count(*), 3)::double precision END
    FROM latest l
$function$;

COMMENT ON FUNCTION public.imagery_theatre_term(double precision, double precision, double precision, double precision, integer) IS
  'IMG-8 (mig 191). Posture imagery term: share of ADMITTED S1 sites in the theatre bbox whose latest clear, baselined look is >= 1.5x its own median. share NULL when no admitted site had a clear look — the posture cron then keeps the four-domain formula.';

-- ─── 4 · Access ────────────────────────────────────────────────────────
ALTER TABLE public.imagery_rule_evaluations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.imagery_rule_evaluations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.imagery_rule_evaluations TO service_role;

REVOKE EXECUTE ON FUNCTION public.imagery_rule_evaluate(uuid, text, text, text, text, double precision, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.imagery_weekly_movements(integer, double precision) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.imagery_theatre_term(double precision, double precision, double precision, double precision, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.imagery_rule_evaluate(uuid, text, text, text, text, double precision, timestamptz) TO service_role;
GRANT  EXECUTE ON FUNCTION public.imagery_weekly_movements(integer, double precision) TO service_role;
GRANT  EXECUTE ON FUNCTION public.imagery_theatre_term(double precision, double precision, double precision, double precision, integer) TO service_role;

COMMIT;

-- VERIFY (read only)
SELECT (SELECT pg_get_constraintdef(oid) LIKE '%imagery_change%' FROM pg_constraint
         WHERE conname = 'user_notification_rules_rule_type_check')                          AS rule_type_added,
       (SELECT count(*) FROM public.imagery_weekly_movements(7, 20))                           AS weekly_items_now,
       (SELECT share FROM public.imagery_theatre_term(11, 14, 42, 45, 14))                     AS bab_el_mandeb_term,
       (SELECT count(*) FROM public.posture_scores WHERE composite_formula IS NOT NULL)        AS rows_with_formula;
