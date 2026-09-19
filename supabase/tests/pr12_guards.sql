-- ═══════════════════════════════════════════════════════════════
-- PR-12 · FIRMS twin guard — guard tests for migration 164
--
-- Run in the Supabase SQL Editor AFTER migration 164 is applied (the
-- whole file). It wraps itself in BEGIN … ROLLBACK: everything it
-- inserts, links, derives or retracts is thrown away. Each assertion
-- raises one NOTICE ('PASS …') or stops the script with 'FAIL …'. The
-- last row on screen reads "all 15 assertions passed" only when every
-- one of them did (a failure stops the script before it).
--
-- Every assertion names the guard it proves; each fails if that guard
-- is removed. Synthetic rows use acq_date 2099-06-0x so they can never
-- meet real data. The real-data assertions (R-) re-run the hourly code
-- path — firms_derive_facility_observations + firms_detect_significant
-- _events — on the real nights, so they hold whether or not the
-- firms-twin-backfill job has finished; takes ~20–40 s.
-- ═══════════════════════════════════════════════════════════════
BEGIN;

-- ─── E1 · existence: columns ───────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'firms_thermal_anomalies'
                    AND column_name = 'twin_of' AND data_type = 'uuid')
  OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'firms_facility_observations'
                    AND column_name = 'twins_excluded' AND is_nullable = 'NO') THEN
    RAISE EXCEPTION 'FAIL E1: firms_thermal_anomalies.twin_of (uuid) or firms_facility_observations.twins_excluded (not null) missing';
  END IF;
  RAISE NOTICE 'PASS E1: twin_of and twins_excluded exist';
END $$;

-- ─── E2 · existence + behaviour: FK and not-self CHECK ─────────
-- Fails if either constraint is dropped: the bad writes below succeed.
DO $$
DECLARE v_id uuid;
BEGIN
  IF (SELECT count(*) FROM pg_constraint
       WHERE conrelid = 'public.firms_thermal_anomalies'::regclass
         AND conname IN ('firms_anom_twin_of_fkey', 'firms_anom_twin_not_self')) <> 2 THEN
    RAISE EXCEPTION 'FAIL E2: firms_anom_twin_of_fkey / firms_anom_twin_not_self not both present';
  END IF;

  INSERT INTO public.firms_thermal_anomalies
    (satellite, acq_date, acq_time, latitude, longitude, brightness, bright_ti5, frp, daynight, ingested_at)
  VALUES ('VIIRS_NOAA20_NRT', '2099-06-09', '0100', 25.9, -90.9, 300, 280, 1, 'N', '2099-06-09 02:00+00')
  RETURNING id INTO v_id;

  BEGIN
    UPDATE public.firms_thermal_anomalies SET twin_of = id WHERE id = v_id;
    RAISE EXCEPTION 'FAIL E2: a record was allowed to be its own twin';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE public.firms_thermal_anomalies SET twin_of = gen_random_uuid() WHERE id = v_id;
    RAISE EXCEPTION 'FAIL E2: twin_of accepted an id that is not a FIRMS record';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS E2: twin_of must reference another existing record';
END $$;

-- ─── E3 · existence: indexes ───────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'firms_anom_twin_of_idx')
  OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'firms_facobs_twins_idx') THEN
    RAISE EXCEPTION 'FAIL E3: firms_anom_twin_of_idx or firms_facobs_twins_idx missing';
  END IF;
  RAISE NOTICE 'PASS E3: twin indexes exist';
END $$;

-- ─── E4 · existence + grants: the 7 functions ──────────────────
-- Fails if a function is missing, or anon/authenticated can execute it.
DO $$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(s.sig, ', ') INTO v_bad
    FROM (VALUES
      ('public.firms_acq_minutes(text)'),
      ('public.firms_link_twins(date,date)'),
      ('public.firms_twin_correct_observations(date)'),
      ('public.firms_significance_judge_day(date,integer,integer,numeric,numeric,integer,boolean)'),
      ('public.firms_twin_backfill_step(integer)'),
      ('public.firms_derive_facility_observations(date,numeric,numeric,jsonb)'),
      ('public.firms_detect_significant_events(date,integer,integer,numeric,numeric,integer)')) s(sig)
   WHERE to_regprocedure(s.sig) IS NULL
      OR has_function_privilege('anon',          to_regprocedure(s.sig), 'EXECUTE')
      OR has_function_privilege('authenticated', to_regprocedure(s.sig), 'EXECUTE')
      OR NOT has_function_privilege('service_role', to_regprocedure(s.sig), 'EXECUTE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL E4: missing or wrongly granted: %', v_bad;
  END IF;
  RAISE NOTICE 'PASS E4: all 7 functions exist, service_role only';
END $$;

-- ─── E5 · wiring ───────────────────────────────────────────────
-- Fails if the rollup stops linking before it reads, or the detector
-- stops going through the one classifier.
DO $$
BEGIN
  IF position('firms_link_twins' IN pg_get_functiondef(
       'public.firms_derive_facility_observations(date,numeric,numeric,jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'FAIL E5: firms_derive_facility_observations no longer calls firms_link_twins';
  END IF;
  IF position('firms_significance_judge_day' IN pg_get_functiondef(
       'public.firms_detect_significant_events(date,integer,integer,numeric,numeric,integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'FAIL E5: firms_detect_significant_events no longer calls firms_significance_judge_day';
  END IF;
  RAISE NOTICE 'PASS E5: derive links first; detect runs through the judge';
END $$;

-- ─── Synthetic records (acq_date 2099-06-0x) ───────────────────
-- 06-01 · the Sweeny shape: preliminary 4,475.89 MW, later-filed 2.02 MW,
--         ~55 m apart, identical I-4 / I-5, 700 m from Sweeny Refinery.
-- 06-02 · the mirror: the LATER-filed record is the large one.
-- 06-03 · rule edges, in open water (25.5 N 90.5 W), no facility near.
INSERT INTO public.firms_thermal_anomalies
  (id, satellite, acq_date, acq_time, latitude, longitude, brightness, bright_ti5, frp, daynight, ingested_at)
VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'VIIRS_NOAA20_NRT', '2099-06-01', '0733', 29.06969, -95.75241, 308.31, 290.17, 4475.89, 'N', '2099-06-01 07:38+00'),
  ('00000000-0000-4000-8000-0000000000b1', 'VIIRS_NOAA20_NRT', '2099-06-01', '0731', 29.06941, -95.75288, 308.31, 290.17,    2.02, 'N', '2099-06-01 10:43+00'),

  ('00000000-0000-4000-8000-0000000000a2', 'VIIRS_NOAA20_NRT', '2099-06-02', '0733', 29.06969, -95.75241, 310.10, 291.20,    3.10, 'N', '2099-06-02 07:38+00'),
  ('00000000-0000-4000-8000-0000000000b2', 'VIIRS_NOAA20_NRT', '2099-06-02', '0732', 29.06941, -95.75288, 310.10, 291.20, 2500.00, 'N', '2099-06-02 10:43+00'),

  -- S2 hour boundary: 0759 → 0801 is 2 minutes, not 42
  ('00000000-0000-4000-8000-0000000000c1', 'VIIRS_NOAA20_NRT', '2099-06-03', '0759', 25.50000, -90.50000, 305.55, 288.11, 1.50, 'N', '2099-06-03 08:05+00'),
  ('00000000-0000-4000-8000-0000000000c2', 'VIIRS_NOAA20_NRT', '2099-06-03', '0801', 25.50010, -90.50010, 305.55, 288.11, 1.20, 'N', '2099-06-03 10:05+00'),
  -- S3 I-4 differs by 0.01 K
  ('00000000-0000-4000-8000-0000000000d1', 'VIIRS_NOAA20_NRT', '2099-06-03', '0900', 25.51000, -90.50000, 301.00, 280.00, 1.00, 'N', '2099-06-03 09:05+00'),
  ('00000000-0000-4000-8000-0000000000d2', 'VIIRS_NOAA20_NRT', '2099-06-03', '0901', 25.51010, -90.50000, 301.01, 280.00, 1.00, 'N', '2099-06-03 11:05+00'),
  -- S4 three minutes apart
  ('00000000-0000-4000-8000-0000000000e1', 'VIIRS_NOAA20_NRT', '2099-06-03', '1000', 25.52000, -90.50000, 302.00, 281.00, 1.00, 'N', '2099-06-03 10:05+00'),
  ('00000000-0000-4000-8000-0000000000e2', 'VIIRS_NOAA20_NRT', '2099-06-03', '1003', 25.52010, -90.50000, 302.00, 281.00, 1.00, 'N', '2099-06-03 12:05+00'),
  -- S5 ~155 m apart
  ('00000000-0000-4000-8000-0000000000f1', 'VIIRS_NOAA20_NRT', '2099-06-03', '1100', 25.53000, -90.50000, 303.00, 282.00, 1.00, 'N', '2099-06-03 11:05+00'),
  ('00000000-0000-4000-8000-0000000000f2', 'VIIRS_NOAA20_NRT', '2099-06-03', '1101', 25.53140, -90.50000, 303.00, 282.00, 1.00, 'N', '2099-06-03 13:05+00'),
  -- S6 different satellites, same everything else
  ('00000000-0000-4000-8000-000000000101', 'VIIRS_SNPP_NRT',   '2099-06-03', '1200', 25.54000, -90.50000, 304.00, 283.00, 1.00, 'N', '2099-06-03 12:05+00'),
  ('00000000-0000-4000-8000-000000000102', 'VIIRS_NOAA20_NRT', '2099-06-03', '1200', 25.54000, -90.50000, 304.00, 283.00, 1.00, 'N', '2099-06-03 14:05+00'),
  -- S7 the ~1-minute exact duplicate the unique key cannot catch
  ('00000000-0000-4000-8000-000000000201', 'VIIRS_NOAA20_NRT', '2099-06-03', '1300', 25.55000, -90.50000, 306.50, 284.50, 5.50, 'N', '2099-06-03 13:05+00'),
  ('00000000-0000-4000-8000-000000000202', 'VIIRS_NOAA20_NRT', '2099-06-03', '1301', 25.55000, -90.50000, 306.50, 284.50, 5.50, 'N', '2099-06-03 14:05+00'),
  -- S9 MODIS: identical brightness, no I-5 band
  ('00000000-0000-4000-8000-000000000301', 'MODIS_NRT',        '2099-06-03', '1400', 25.56000, -90.50000, 320.00,   NULL, 9.00, 'N', '2099-06-03 14:05+00'),
  ('00000000-0000-4000-8000-000000000302', 'MODIS_NRT',        '2099-06-03', '1401', 25.56000, -90.50000, 320.00,   NULL, 9.00, 'N', '2099-06-03 16:05+00'),
  -- S10 same ingest batch, same minute: the larger id is canonical,
  --     and here it carries the SMALLER FRP
  ('00000000-0000-4000-8000-00000000040a', 'VIIRS_NOAA20_NRT', '2099-06-03', '1500', 25.57000, -90.50000, 307.00, 285.00, 9.00, 'N', '2099-06-03 15:05+00'),
  ('00000000-0000-4000-8000-00000000040b', 'VIIRS_NOAA20_NRT', '2099-06-03', '1500', 25.57005, -90.50000, 307.00, 285.00, 1.00, 'N', '2099-06-03 15:05+00');

-- ─── S1 · the rule links exactly what it should on 2099-06-03 ──
-- Fails if the acq_time parse is removed (0759/0801 read 42 apart), if
-- any criterion is loosened (S3–S6, S9 would link), if the ~1-minute
-- exact duplicate is not linked (S7), or if the tie-break stops being
-- deterministic (S10).
DO $$
DECLARE
  v_changed int;
  v_links   text;
  v_expect  text := '00000000-0000-4000-8000-0000000000c1>00000000-0000-4000-8000-0000000000c2,'
                 || '00000000-0000-4000-8000-000000000201>00000000-0000-4000-8000-000000000202,'
                 || '00000000-0000-4000-8000-00000000040a>00000000-0000-4000-8000-00000000040b';
BEGIN
  v_changed := public.firms_link_twins('2099-06-03', '2099-06-03');
  SELECT string_agg(id::text || '>' || twin_of::text, ',' ORDER BY id) INTO v_links
    FROM public.firms_thermal_anomalies
   WHERE acq_date = '2099-06-03' AND twin_of IS NOT NULL;
  IF v_links IS DISTINCT FROM v_expect OR v_changed <> 3 THEN
    RAISE EXCEPTION 'FAIL S1: expected exactly 3 links (hour boundary, exact duplicate, tie) — got % (changed %)', v_links, v_changed;
  END IF;
  RAISE NOTICE 'PASS S1: 0759→0801 linked; exact 1-min duplicate linked; tie → larger id; I-4 +0.01 K, 3 min, 155 m, cross-satellite and MODIS not linked';
END $$;

-- ─── S2 · linking is idempotent ────────────────────────────────
-- Fails if the UPDATE loses its IS DISTINCT FROM guard (a re-run would
-- rewrite every linked row).
DO $$
DECLARE v int;
BEGIN
  v := public.firms_link_twins('2099-06-03', '2099-06-03');
  IF v <> 0 THEN
    RAISE EXCEPTION 'FAIL S2: a second link pass changed % rows', v;
  END IF;
  RAISE NOTICE 'PASS S2: a second link pass changes 0 rows';
END $$;

-- Synthetic 10-day baseline for Sweeny before 2099-06-01 (3 detections a
-- night, 2.50 MW peak), and a stale 'elevated' event for 2099-06-01 as the
-- detector would have written it had it judged the day before the
-- later-filed twin arrived.
INSERT INTO public.firms_facility_observations
  (facility_type, facility_id, facility_name, country, period, detection_count, max_frp, nearest_km, radius_km, twins_excluded)
SELECT 'refinery', 'way:528529366', 'Sweeny Refinery', NULL, d::date, 3, 2.50, 0.7, 5, 0
  FROM generate_series('2099-05-22'::date, '2099-05-31'::date, interval '1 day') d;

INSERT INTO public.firms_significant_events
  (facility_type, facility_id, facility_name, country, period, event_type,
   observed_count, observed_max_frp, baseline_days, baseline_rate, baseline_mean_frp, deviation)
VALUES ('refinery', 'way:528529366', 'Sweeny Refinery', NULL, '2099-06-01', 'elevated',
        2, 4475.89, 10, 1.0, 2.50, 1790.356);

-- ─── S3 · the rollup counts a twin pair once, at the later-filed FRP ─
-- Fails if firms_derive_facility_observations stops linking or stops
-- excluding superseded records (it would read 2 detections, 4,475.89 MW).
DO $$
DECLARE r record;
BEGIN
  PERFORM public.firms_derive_facility_observations(
    '2099-06-01', 5, 500, '[{"west":-96.2,"south":28.8,"east":-95.3,"north":29.3}]'::jsonb);
  SELECT detection_count, max_frp, twins_excluded INTO r
    FROM public.firms_facility_observations
   WHERE facility_type = 'refinery' AND facility_id = 'way:528529366' AND period = '2099-06-01';
  IF r.detection_count IS DISTINCT FROM 1 OR r.max_frp IS DISTINCT FROM 2.02 OR r.twins_excluded IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'FAIL S3: Sweeny-shaped pair read % detections at % MW (twins excluded %), expected 1 at 2.02 MW (1)',
      r.detection_count, r.max_frp, r.twins_excluded;
  END IF;
  RAISE NOTICE 'PASS S3: the pair is one detection at the later-filed 2.02 MW; twins_excluded = 1';
END $$;

-- ─── S4 · no elevated event, and the stale one is retracted with a record
-- Fails if the retraction is removed (the stale row survives) or if the
-- rollup exclusion is removed (the pair re-classifies as elevated).
DO $$
DECLARE v_events int; v_logged int;
BEGIN
  PERFORM public.firms_detect_significant_events('2099-06-01', 30, 7, 3.0, 0.6, 3);
  SELECT count(*) INTO v_events FROM public.firms_significant_events
   WHERE facility_type = 'refinery' AND facility_id = 'way:528529366'
     AND period = '2099-06-01' AND event_type = 'elevated';
  SELECT count(*) INTO v_logged FROM public.firms_significant_event_retractions
   WHERE facility_type = 'refinery' AND facility_id = 'way:528529366'
     AND period = '2099-06-01' AND event_type = 'elevated'
     AND (event->>'observed_max_frp')::numeric = 4475.89;
  IF v_events <> 0 OR v_logged <> 1 THEN
    RAISE EXCEPTION 'FAIL S4: elevated rows left %, retractions logged % (expected 0 and 1)', v_events, v_logged;
  END IF;
  RAISE NOTICE 'PASS S4: no elevated event; the stale 4,475.89 MW event was retracted and logged';
END $$;

-- ─── S5 · never drop a pixel for being large ───────────────────
-- 2099-06-02: the LATER-filed record is the 2,500 MW one. It is canonical
-- and it is read. Fails if the rule ever picks by magnitude (a cap, or
-- "keep the smaller FRP").
DO $$
DECLARE r record; v_evt numeric;
BEGIN
  PERFORM public.firms_derive_facility_observations(
    '2099-06-02', 5, 500, '[{"west":-96.2,"south":28.8,"east":-95.3,"north":29.3}]'::jsonb);
  PERFORM public.firms_detect_significant_events('2099-06-02', 30, 7, 3.0, 0.6, 3);
  SELECT detection_count, max_frp INTO r
    FROM public.firms_facility_observations
   WHERE facility_type = 'refinery' AND facility_id = 'way:528529366' AND period = '2099-06-02';
  SELECT observed_max_frp INTO v_evt FROM public.firms_significant_events
   WHERE facility_type = 'refinery' AND facility_id = 'way:528529366'
     AND period = '2099-06-02' AND event_type = 'elevated';
  IF (SELECT twin_of FROM public.firms_thermal_anomalies WHERE id = '00000000-0000-4000-8000-0000000000a2')
       IS DISTINCT FROM '00000000-0000-4000-8000-0000000000b2'::uuid
     OR r.max_frp IS DISTINCT FROM 2500.00 OR r.detection_count IS DISTINCT FROM 1
     OR v_evt IS DISTINCT FROM 2500.00 THEN
    RAISE EXCEPTION 'FAIL S5: later-filed 2,500 MW record not read (rollup % MW / % det, event %)', r.max_frp, r.detection_count, v_evt;
  END IF;
  RAISE NOTICE 'PASS S5: the later-filed 2,500 MW record is canonical, read, and raises its elevated event';
END $$;

-- ─── S6 · the backfill correction is UPDATE-only and refuses broken history
-- Fails if firms_twin_correct_observations inserts rows, or rewrites a
-- row whose raw detections no longer reproduce it.
DO $$
DECLARE v_before int; v_after int; v jsonb;
BEGIN
  -- A stored row claiming 5 + 1 detections while only ONE raw record is
  -- left on 2099-06-04 (history lost to something other than twins):
  -- it must be refused and left as it stands, not rewritten to 1.
  INSERT INTO public.firms_thermal_anomalies
    (satellite, acq_date, acq_time, latitude, longitude, brightness, bright_ti5, frp, daynight, ingested_at)
  VALUES ('VIIRS_NOAA20_NRT', '2099-06-04', '0733', 29.06969, -95.75241, 309.00, 289.00, 3.30, 'N', '2099-06-04 07:38+00');
  INSERT INTO public.firms_facility_observations
    (facility_type, facility_id, facility_name, period, detection_count, max_frp, nearest_km, radius_km, twins_excluded)
  VALUES ('refinery', 'way:528529366', 'Sweeny Refinery', '2099-06-04', 5, 9.9, 0.5, 5, 1);
  SELECT count(*) INTO v_before FROM public.firms_facility_observations WHERE period = '2099-06-04';
  v := public.firms_twin_correct_observations('2099-06-04');
  SELECT count(*) INTO v_after FROM public.firms_facility_observations WHERE period = '2099-06-04';
  IF v_after <> v_before
     OR (v->>'skipped_not_intact')::int <> 1
     OR (SELECT detection_count FROM public.firms_facility_observations
          WHERE facility_id = 'way:528529366' AND period = '2099-06-04') <> 5 THEN
    RAISE EXCEPTION 'FAIL S6: correction inserted rows or rewrote an unreproducible row (%)', v;
  END IF;
  -- On a reproducible day it agrees with the live derive: 06-01 unchanged.
  v := public.firms_twin_correct_observations('2099-06-01');
  IF (v->>'updated')::int <> 0 THEN
    RAISE EXCEPTION 'FAIL S6: correction disagrees with the derive on 2099-06-01 (%)', v;
  END IF;
  RAISE NOTICE 'PASS S6: correction never inserts, refuses unreproducible rows, agrees with the derive';
END $$;

-- ─── Real data (production rows, re-run inside this transaction) ─

-- ─── R1 · Sweeny, 2026-09-05 ───────────────────────────────────
-- Fails if the pair is not linked with the 10:43 record canonical, if the
-- rollup reads 4,475.89 MW, or if an elevated event survives a re-judge.
DO $$
DECLARE r record; v_events int; v_logged int;
  v_regions jsonb := '[{"west":22,"south":44,"east":60,"north":62},{"west":44,"south":22,"east":60,"north":34},{"west":-10,"south":35,"east":22,"north":60},{"west":100,"south":18,"east":146,"north":46},{"west":60,"south":5,"east":100,"north":37},{"west":95,"south":-11,"east":142,"north":20},{"west":-100,"south":24,"east":-52,"north":55},{"west":-130,"south":25,"east":-100,"north":55}]';
BEGIN
  IF (SELECT twin_of FROM public.firms_thermal_anomalies WHERE id = '078bc27e-ef98-4959-80ae-dfba862f83f0')
       IS DISTINCT FROM '9b852901-13dc-4dbb-ad76-7cc9d4679b82'::uuid
     OR (SELECT twin_of FROM public.firms_thermal_anomalies WHERE id = '9b852901-13dc-4dbb-ad76-7cc9d4679b82') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL R1: Sweeny 07:33 (4,475.89 MW, filed 07:38) is not superseded by 07:31 (2.02 MW, filed 10:43)';
  END IF;

  PERFORM public.firms_derive_facility_observations('2026-09-05', 5, 500, v_regions);
  PERFORM public.firms_detect_significant_events('2026-09-05', 30, 7, 3.0, 0.6, 3);

  SELECT detection_count, max_frp, twins_excluded INTO r
    FROM public.firms_facility_observations
   WHERE facility_type = 'refinery' AND facility_id = 'way:528529366' AND period = '2026-09-05';
  SELECT count(*) INTO v_events FROM public.firms_significant_events
   WHERE facility_type = 'refinery' AND facility_id = 'way:528529366'
     AND period = '2026-09-05' AND event_type = 'elevated';
  SELECT count(*) INTO v_logged FROM public.firms_significant_event_retractions
   WHERE facility_type = 'refinery' AND facility_id = 'way:528529366'
     AND period = '2026-09-05' AND event_type = 'elevated';

  IF r.max_frp IS DISTINCT FROM 2.02 OR r.detection_count IS DISTINCT FROM 2
     OR r.twins_excluded IS DISTINCT FROM 2 OR v_events <> 0 OR v_logged < 1 THEN
    RAISE EXCEPTION 'FAIL R1: Sweeny 09-05 reads % det at % MW (twins %), elevated rows %, retractions logged %',
      r.detection_count, r.max_frp, r.twins_excluded, v_events, v_logged;
  END IF;
  RAISE NOTICE 'PASS R1: Sweeny 09-05 — the pair is one detection at 2.02 MW (2 canonical of 4 records); no elevated event; retraction on record';
END $$;

-- ─── R2 · 2026-08-25 north-Texas wildfire keeps its full FRP ───
-- Fails if the rule starts preferring a magnitude, or the canonical
-- record loses its 1,016.87 MW.
DO $$
BEGIN
  IF (SELECT twin_of FROM public.firms_thermal_anomalies WHERE id = 'a6265bc0-a71f-468d-ac87-4c2a7789301c')
       IS DISTINCT FROM 'e896c33b-1dc8-4071-97d0-424b6ec624eb'::uuid
     OR NOT (SELECT twin_of IS NULL AND frp = 1016.87 FROM public.firms_thermal_anomalies
              WHERE id = 'e896c33b-1dc8-4071-97d0-424b6ec624eb') THEN
    RAISE EXCEPTION 'FAIL R2: the wildfire pair is not linked with a 1,016.87 MW canonical record';
  END IF;
  RAISE NOTICE 'PASS R2: wildfire pair linked (07:41 → 10:37 filing); the canonical record keeps 1,016.87 MW';
END $$;

-- ─── R3 · the 12 known >= 1,000 MW preliminaries are superseded ─
-- Fails if any of them is read as canonical again.
DO $$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(k.id::text, ', ') INTO v_bad
    FROM (VALUES
      ('d2a96d3d-b673-49ee-a2e8-59c228ea0bb8'::uuid), ('59839374-6cb4-4a73-9fb7-31e4d94b1adc'),
      ('a207e674-d70f-4aff-9596-cb57d032d365'),       ('d97415ea-be28-4f26-9ec6-687ba6d2cd0f'),
      ('226963f8-d97e-4f2c-9084-aa22007d7236'),       ('2a819581-3d85-4090-a1f0-b06d4e105f7b'),
      ('2ac2a24e-5e6c-47c6-bda3-abe042cdf593'),       ('7e3d0100-feca-4a02-8ef7-a42650ddf833'),
      ('2a752257-be40-40e0-8682-c71ab4de3340'),       ('58969ebb-6794-4e72-991f-73b2cead3523'),
      ('faf8175d-9ca6-45d1-b32a-7eacc7cffa1d'),       ('078bc27e-ef98-4959-80ae-dfba862f83f0')) k(id)
    LEFT JOIN public.firms_thermal_anomalies p ON p.id = k.id
    LEFT JOIN public.firms_thermal_anomalies t ON t.id = p.twin_of
   WHERE p.frp IS NULL OR p.frp < 1000
      OR t.id IS NULL OR t.frp NOT BETWEEN 0.7 AND 3.3
      OR t.ingested_at <= p.ingested_at;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL R3: not superseded by a later-filed 0.7–3.3 MW twin: %', v_bad;
  END IF;
  RAISE NOTICE 'PASS R3: all 12 known >= 1,000 MW preliminaries are superseded by their later-filed 0.7–3.3 MW twins';
END $$;

-- ─── R4 · replay 2026-08-18 → today on the hourly code path ────
-- Every day since 08-18 that carries a superseded record >= 1,000 MW, or
-- a VIIRS night record >= 1,000 MW, is re-derived and re-judged. No rollup row and no event may then read
-- a superseded record's FRP, and the named facility-days read their
-- later-filed values. Fails if either the rollup exclusion or the
-- retraction/refresh is removed.
DO $$
DECLARE
  d        date;
  v_days   text;
  v_obs    int;
  v_evt    int;
  v_named  text;
  v_regions jsonb := '[{"west":22,"south":44,"east":60,"north":62},{"west":44,"south":22,"east":60,"north":34},{"west":-10,"south":35,"east":22,"north":60},{"west":100,"south":18,"east":146,"north":46},{"west":60,"south":5,"east":100,"north":37},{"west":95,"south":-11,"east":142,"north":20},{"west":-100,"south":24,"east":-52,"north":55},{"west":-130,"south":25,"east":-100,"north":55}]';
BEGIN
  FOR d IN
    SELECT DISTINCT acq_date FROM public.firms_thermal_anomalies
     WHERE frp >= 1000
       AND (twin_of IS NOT NULL OR (satellite LIKE 'VIIRS%' AND daynight = 'N'))
       AND acq_date >= '2026-08-18' AND acq_date <= CURRENT_DATE
     ORDER BY 1
  LOOP
    PERFORM public.firms_derive_facility_observations(d, 5, 500, v_regions);
    PERFORM public.firms_detect_significant_events(d, 30, 7, 3.0, 0.6, 3);
    v_days := COALESCE(v_days || ', ', '') || d::text;
  END LOOP;

  -- A superseded record whose later-filed twin reads a DIFFERENT FRP
  -- (the wildfire pair agrees at 1,016.87 MW, so it is not a tell).
  SELECT count(*) INTO v_obs
    FROM public.firms_facility_observations o
    JOIN public.firms_thermal_anomalies s
      ON s.acq_date = o.period AND s.twin_of IS NOT NULL AND s.frp >= 1000 AND s.frp = o.max_frp
    JOIN public.firms_thermal_anomalies t
      ON t.id = s.twin_of AND t.frp IS DISTINCT FROM s.frp
   WHERE o.period >= '2026-08-18';
  SELECT count(*) INTO v_evt
    FROM public.firms_significant_events e
    JOIN public.firms_thermal_anomalies s
      ON s.acq_date = e.period AND s.twin_of IS NOT NULL AND s.frp >= 1000 AND s.frp = e.observed_max_frp
    JOIN public.firms_thermal_anomalies t
      ON t.id = s.twin_of AND t.frp IS DISTINCT FROM s.frp
   WHERE e.period >= '2026-08-18';

  SELECT string_agg(o.facility_id || '@' || o.period || '=' || COALESCE(o.max_frp::text, 'null'), ' ; ' ORDER BY o.period, o.facility_id)
    INTO v_named
    FROM public.firms_facility_observations o
   WHERE (o.facility_type, o.facility_id, o.period) IN (
           ('refinery',    'relation:9394011', '2026-08-21'::date),
           ('power_plant', 'G100000401939',    '2026-08-24'::date),
           ('refinery',    'relation:9386940', '2026-08-25'::date),
           ('refinery',    'relation:9386941', '2026-08-25'::date),
           ('refinery',    'way:528529366',    '2026-09-05'::date));

  IF v_obs <> 0 OR v_evt <> 0
     OR v_named IS DISTINCT FROM
        'relation:9394011@2026-08-21=14.52 ; G100000401939@2026-08-24=2.61 ; relation:9386940@2026-08-25=6.83 ; relation:9386941@2026-08-25=6.83 ; way:528529366@2026-09-05=2.02' THEN
    RAISE EXCEPTION 'FAIL R4: after replaying % — rollup rows on a superseded FRP %, events on a superseded FRP %, named reads [%]',
      v_days, v_obs, v_evt, v_named;
  END IF;
  RAISE NOTICE 'PASS R4: replayed % — no rollup row or event reads a superseded FRP; Coop 14.52, Green Power 2 2.61, Norco/St. Charles 6.83, Sweeny 2.02 MW', v_days;
END $$;

ROLLBACK;

SELECT 'PR-12 guards: all 15 assertions passed (E1–E5, S1–S6, R1–R4 — see the notices above); transaction rolled back, nothing written' AS result;
