-- ═══════════════════════════════════════════════════════════════════════
-- eYKON.ai — 189 · Sentinel-1 go-live, behind the admission (Imagery Layer
--             build prompt rev A, IMG-6). Requires 185.
--
-- THE GATE COMES FIRST. IMG-3 (mig 185) built a study that decides whether
-- the S1 bright-target reading measures ships. Nothing in this migration
-- shows, scores or alerts on an S1 reading until a person has RECORDED an
-- admission that passed. On the day it is applied, every reader below
-- returns nothing and says why.
--
--   1 · ADMISSION IS A RECORDED ACT. imagery_s1_record_admission(days, by)
--       runs imagery_s1_study(days), stores the whole result, and decides
--       whether the METHOD is admitted. Called by hand, never on a schedule.
--       METHOD RULE (founder decision F-8, proposed here): at least 5
--       anchorages admitted, AND at least 70 % of the anchorages that reached
--       10 pairs admitted. One good anchorage is not a method.
--       The latest row is the state: a later run that fails revokes, and
--       switches the chokepoints back off.
--
--   2 · CALIBRATION, STATED. The reading is an AREA of bright radar return,
--       not a count. At admission the median m² per AIS vessel over the
--       admitted anchorages' paired looks is stored, and readers show
--       area ÷ that median as "vessel-equivalents" — labelled as an estimate
--       from one pinned ratio, never "vessels".
--
--   3 · CHOKEPOINT WINDOWS. Six strait windows, one per AIS chokepoint box
--       (lib/intel/aisCoverage.ts slugs), each ≤ 0.26° a side (≤ 751 km²):
--       ~5 PU a pass at 20 m (estimatePu × the orthorectify factor). A whole
--       AIS box (Hormuz is 4° a side) would hit the 2,000 px cap at ~220 m
--       cells — too coarse to see a ship at all. HAND-DRAWN from
--       public charts over the traffic lanes / anchorages; they include
--       some coast and islands, a fixed clutter the median baseline absorbs.
--       Created with NO sensor: s1_grd is switched on only by a passing
--       admission. They are why S1 matters — Bab-el-Mandeb and Hormuz are
--       where AIS is dark and a radar pass still sees.
--
--   4 · READERS. imagery_s1_status() — the latest admission, or 'no
--       admission recorded'. imagery_s1_readings(days) — passes at admitted
--       anchorages and chokepoints, VOID looks included as looks-that-did-
--       not-happen (value NULL, never 0); empty unless admitted.
--
--   5 · CONVERGENCE. imagery_s1_flag_candidates(since) — clear, admitted,
--       baselined readings ≥ 1.5 × their own median. A VOID pass has no
--       value and is never a candidate. The S1 cron writes these as
--       anomaly_flags (domain 'SAR' → source class 'sensor-s1-sar').
--
-- ACCESS: RLS on, service_role only. APPLY: after 185, manually, whole file,
-- BEFORE merge. Then supabase/tests/img6_guards.sql — ONE result row.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.imagery_s1_study(integer,integer)') IS NULL THEN
    RAISE EXCEPTION '189 requires 185 (Sentinel-1 study) — apply 185 first';
  END IF;
END $$;

-- ─── 1 · Admissions ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.imagery_s1_admissions (
  id               bigserial   PRIMARY KEY,
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  recorded_by      text        NOT NULL,
  window_days      integer     NOT NULL,
  study            jsonb       NOT NULL,
  evaluated_n      integer     NOT NULL,
  admitted_n       integer     NOT NULL,
  admitted_aois    text[]      NOT NULL DEFAULT '{}',
  method_admitted  boolean     NOT NULL,
  m2_per_vessel    double precision,
  rule             text        NOT NULL,
  CONSTRAINT isa_by CHECK (length(btrim(recorded_by)) > 0),
  CONSTRAINT isa_window CHECK (window_days BETWEEN 14 AND 180),
  CONSTRAINT isa_counts CHECK (admitted_n >= 0 AND evaluated_n >= admitted_n AND cardinality(admitted_aois) = admitted_n),
  -- the method rule, as a CHECK: an admitted method has ≥ 5 admitted
  -- anchorages, ≥ 70 % of those evaluated, and a calibration ratio
  CONSTRAINT isa_method CHECK (NOT method_admitted OR
    (admitted_n >= 5 AND admitted_n >= 0.7 * evaluated_n AND m2_per_vessel > 0))
);

COMMENT ON TABLE public.imagery_s1_admissions IS
  'IMG-6 (mig 189). One row per recorded run of the S1 study. The LATEST row is the admission state: method_admitted false (or no row) means no S1 reading is shown, scored or alerted on. Rule: >= 5 anchorages admitted AND >= 70% of anchorages with >= 10 pairs admitted (founder decision F-8).';

CREATE OR REPLACE FUNCTION public.imagery_s1_record_admission(p_days integer, p_by text)
RETURNS TABLE (admission_id bigint, evaluated_n integer, admitted_n integer, method_admitted boolean,
               m2_per_vessel double precision, chokepoints_enabled integer)
LANGUAGE plpgsql
AS $function$
#variable_conflict use_column
DECLARE
  v_study    jsonb;
  v_eval     integer;
  v_adm      text[];
  v_ok       boolean;
  v_ratio    double precision;
  v_id       bigint;
  v_cp       integer := 0;
BEGIN
  IF p_by IS NULL OR length(btrim(p_by)) = 0 THEN
    RAISE EXCEPTION 'imagery_s1_record_admission: say who records it (p_by)';
  END IF;
  SET LOCAL statement_timeout = '60s';

  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.aoi_id), '[]'::jsonb),
         count(*) FILTER (WHERE s.pairs >= 10)::integer,
         coalesce(array_agg(s.aoi_id ORDER BY s.aoi_id) FILTER (WHERE s.admitted), '{}')
    INTO v_study, v_eval, v_adm
    FROM public.imagery_s1_study(p_days, 30) s;

  -- m² of bright return per AIS vessel: the median over every paired look at
  -- an admitted anchorage with at least one vessel (same pairing as the study)
  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY p.s1 / p.ais)
    INTO v_ratio
    FROM (
      SELECT o.metric_value AS s1, a.vessels_fresh::double precision AS ais
        FROM public.imagery_observations o
        CROSS JOIN LATERAL (
          SELECT c.vessels_fresh FROM public.ais_aoi_counts c
           WHERE c.aoi_id = o.aoi_id AND c.vessels_fresh IS NOT NULL
             AND c.sampled_at BETWEEN o.acquired_at - interval '30 minutes' AND o.acquired_at + interval '30 minutes'
           ORDER BY abs(extract(epoch FROM (c.sampled_at - o.acquired_at))) LIMIT 1) a
       WHERE o.sensor = 's1_grd' AND o.metric_name = 'bright_target_area_m2'
         AND o.coverage_state = 'clear' AND o.metric_value IS NOT NULL
         AND o.acquired_at >= now() - make_interval(days => p_days)
         AND o.aoi_id = ANY (v_adm)
    ) p
   WHERE p.ais > 0;

  v_ok := cardinality(v_adm) >= 5 AND cardinality(v_adm) >= 0.7 * v_eval AND coalesce(v_ratio, 0) > 0;

  INSERT INTO public.imagery_s1_admissions
    (recorded_by, window_days, study, evaluated_n, admitted_n, admitted_aois, method_admitted, m2_per_vessel, rule)
  VALUES
    (btrim(p_by), p_days, v_study, v_eval, cardinality(v_adm), v_adm, v_ok,
     CASE WHEN v_ok THEN v_ratio END,
     'F-8: >= 5 anchorages admitted AND >= 70% of anchorages with >= 10 pairs; anchorage rule mig 185 (rho >= 0.70 on >= 10 pairs, |share drift| <= ln 1.5)')
  RETURNING id INTO v_id;

  -- the chokepoint windows follow the latest admission, both ways
  UPDATE public.imagery_aois a
     SET sensors_enabled = CASE WHEN v_ok
                                THEN ARRAY(SELECT DISTINCT unnest(a.sensors_enabled || ARRAY['s1_grd']))
                                ELSE array_remove(a.sensors_enabled, 's1_grd') END,
         priority = CASE WHEN v_ok THEN 3 ELSE a.priority END,
         updated_at = now()
   WHERE a.kind = 'chokepoint' AND a.retired_at IS NULL;
  SELECT count(*) INTO v_cp FROM public.imagery_aois a
   WHERE a.kind = 'chokepoint' AND a.retired_at IS NULL AND 's1_grd' = ANY (a.sensors_enabled);

  admission_id := v_id; evaluated_n := v_eval; admitted_n := cardinality(v_adm);
  method_admitted := v_ok; m2_per_vessel := CASE WHEN v_ok THEN v_ratio END; chokepoints_enabled := v_cp;
  RETURN NEXT;
END
$function$;

COMMENT ON FUNCTION public.imagery_s1_record_admission(integer, text) IS
  'IMG-6 (mig 189). Runs imagery_s1_study(p_days), records the whole result and the method decision (F-8), stores the m2-per-vessel calibration when admitted, and switches s1_grd on (admitted) or off (not) for the chokepoint windows. By hand only.';

-- ─── 2 · Chokepoint windows (no sensor until admitted) ─────────────────
INSERT INTO public.imagery_aois (aoi_id, kind, name, geom, centroid_lat, centroid_lon, area_km2, buffer_rule)
SELECT 'chokepoint:' || w.slug, 'chokepoint', w.name,
       ST_MakeEnvelope(w.lon0, w.lat0, w.lon1, w.lat1, 4326),
       (w.lat0 + w.lat1) / 2, (w.lon0 + w.lon1) / 2,
       ST_Area(ST_MakeEnvelope(w.lon0, w.lat0, w.lon1, w.lat1, 4326)::geography) / 1e6,
       'IMG-6 hand-drawn strait window over the lanes/anchorage, <= 0.26 deg a side (mig 189)'
  FROM (VALUES
    ('bab-el-mandeb', 'Bab-el-Mandeb strait (S1 window)', 12.45, 43.25, 12.70, 43.50),
    ('hormuz',        'Strait of Hormuz (S1 window)',     26.45, 56.30, 26.70, 56.55),
    ('suez',          'Suez Bay anchorage (S1 window)',   29.80, 32.48, 29.96, 32.62),
    ('bosphorus',     'Bosphorus south anchorage (S1 window)', 40.93, 28.88, 41.03, 29.05),
    ('malacca',       'Singapore Strait east (S1 window)', 1.18, 103.80,  1.34, 104.06),
    ('panama',        'Panama Pacific anchorage (S1 window)', 8.80, -79.62, 8.96, -79.44)
  ) AS w(slug, name, lat0, lon0, lat1, lon1)
ON CONFLICT (aoi_id) DO NOTHING;

-- ─── 3 · Readers ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.imagery_s1_status()
RETURNS TABLE (state text, admission_id bigint, recorded_at timestamptz, recorded_by text,
               evaluated_n integer, admitted_n integer, method_admitted boolean, m2_per_vessel double precision,
               admitted_aois text[], rule text)
LANGUAGE sql
STABLE
AS $function$
  SELECT CASE WHEN a.id IS NULL THEN 'no admission recorded'
              WHEN a.method_admitted THEN 'admitted'
              ELSE 'not admitted' END,
         a.id, a.recorded_at, a.recorded_by, a.evaluated_n, a.admitted_n, a.method_admitted,
         a.m2_per_vessel, a.admitted_aois, a.rule
    FROM (SELECT 1) one
    LEFT JOIN LATERAL (SELECT * FROM public.imagery_s1_admissions ORDER BY id DESC LIMIT 1) a ON true
$function$;

CREATE OR REPLACE FUNCTION public.imagery_s1_readings(p_days integer DEFAULT 30)
RETURNS TABLE (aoi_id text, kind text, name text, centroid_lat double precision, centroid_lon double precision,
               acquired_at timestamptz, coverage_state text, bright_area_m2 double precision,
               vessel_equivalents double precision, baseline_median double precision, baseline_n integer,
               ratio_to_baseline double precision, admission_id bigint)
LANGUAGE sql
STABLE
AS $function$
  WITH adm AS (
    SELECT * FROM public.imagery_s1_admissions ORDER BY id DESC LIMIT 1
  )
  SELECT o.aoi_id, a.kind, a.name, a.centroid_lat, a.centroid_lon, o.acquired_at, o.coverage_state,
         o.metric_value,
         round((o.metric_value / adm.m2_per_vessel)::numeric, 1)::double precision,
         o.baseline_median, o.baseline_n,
         CASE WHEN o.metric_value IS NOT NULL AND o.baseline_median > 0
              THEN round((o.metric_value / o.baseline_median)::numeric, 2)::double precision END,
         adm.id
    FROM adm
    JOIN public.imagery_observations o ON o.sensor = 's1_grd'
    JOIN public.imagery_aois a ON a.aoi_id = o.aoi_id
   WHERE adm.method_admitted
     AND (a.kind = 'chokepoint' OR o.aoi_id = ANY (adm.admitted_aois))
     AND a.retired_at IS NULL
     AND o.acquired_at >= now() - make_interval(days => least(greatest(p_days, 1), 120))
   ORDER BY o.acquired_at DESC, o.aoi_id
   LIMIT 2000
$function$;

COMMENT ON FUNCTION public.imagery_s1_readings(integer) IS
  'IMG-6 (mig 189). S1 passes at admitted anchorages and chokepoint windows, VOID looks included with NULL values (never 0). Empty unless the latest admission passed. vessel_equivalents = bright area / the admission''s median m2 per AIS vessel — an estimate from one pinned ratio, not a count.';

-- ─── 4 · Convergence candidates ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.imagery_s1_flag_candidates(p_since timestamptz)
RETURNS TABLE (site_key text, aoi_id text, kind text, name text, latitude double precision, longitude double precision,
               acquired_at timestamptz, bright_area_m2 double precision, vessel_equivalents double precision,
               baseline_median double precision, baseline_n integer, ratio_to_baseline double precision, admission_id bigint)
LANGUAGE sql
STABLE
AS $function$
  SELECT r.aoi_id || '@' || to_char(r.acquired_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
         r.aoi_id, r.kind, r.name, r.centroid_lat, r.centroid_lon, r.acquired_at, r.bright_area_m2,
         r.vessel_equivalents, r.baseline_median, r.baseline_n, r.ratio_to_baseline, r.admission_id
    FROM public.imagery_s1_readings(120) r
   WHERE r.coverage_state = 'clear'
     AND r.bright_area_m2 IS NOT NULL
     AND r.baseline_n >= 3
     AND r.ratio_to_baseline >= 1.5
     AND r.acquired_at >= p_since
   ORDER BY r.acquired_at, r.aoi_id
$function$;

COMMENT ON FUNCTION public.imagery_s1_flag_candidates(timestamptz) IS
  'IMG-6 (mig 189). Admitted, clear, baselined (n >= 3) S1 readings at >= 1.5x their own 120-day median since p_since — what the S1 cron writes to anomaly_flags (domain SAR). A VOID pass has no value and is never a candidate.';

-- ─── 5 · Access ────────────────────────────────────────────────────────
ALTER TABLE public.imagery_s1_admissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.imagery_s1_admissions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.imagery_s1_admissions TO service_role;
GRANT USAGE ON SEQUENCE public.imagery_s1_admissions_id_seq TO service_role;

REVOKE EXECUTE ON FUNCTION public.imagery_s1_record_admission(integer, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.imagery_s1_status()                         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.imagery_s1_readings(integer)                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.imagery_s1_flag_candidates(timestamptz)     FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.imagery_s1_record_admission(integer, text) TO service_role;
GRANT  EXECUTE ON FUNCTION public.imagery_s1_status()                         TO service_role;
GRANT  EXECUTE ON FUNCTION public.imagery_s1_readings(integer)                TO service_role;
GRANT  EXECUTE ON FUNCTION public.imagery_s1_flag_candidates(timestamptz)     TO service_role;

COMMIT;

-- VERIFY (read only): six windows with no sensor, no admission, readers empty.
SELECT (SELECT count(*) FROM public.imagery_aois WHERE kind = 'chokepoint' AND retired_at IS NULL)            AS chokepoint_windows,
       (SELECT count(*) FROM public.imagery_aois WHERE kind = 'chokepoint' AND 's1_grd' = ANY (sensors_enabled)) AS with_s1_on,
       (SELECT max(round(area_km2)) FROM public.imagery_aois WHERE kind = 'chokepoint')                          AS largest_km2,
       (SELECT state FROM public.imagery_s1_status())                                                           AS s1_state,
       (SELECT count(*) FROM public.imagery_s1_readings(120))                                                   AS readings_shown;
