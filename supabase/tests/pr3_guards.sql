-- ═══════════════════════════════════════════════════════════════════════
-- eYKON.ai — Reality Check PR-3 · guard tests (migration 166)
--
-- HOW TO RUN: after applying 166, paste this WHOLE file into the Supabase
-- SQL Editor and run it (not "Run selected"). It changes nothing: it runs
-- inside BEGIN … ROLLBACK, and every write it makes is also undone by its
-- own exception block, so nothing persists even if the editor did not
-- honour the transaction. It writes only rows dated 2099-01-01/02, which no
-- ingest, census or resolver ever reads.
--
-- WHAT YOU SEE
--   * One NOTICE per assertion: "PASS <id> <what>" or "FAIL <id> <what> — <detail>".
--   * The last NOTICE reads "PR-3 guards: <n> of <n> assertions passed".
--   * If every assertion passes, the last statement returns ONE ROW. Paste it
--     back with the notices.
--   * If any assertion fails, the script stops with an ERROR listing the
--     failed ids, and the result row never appears. That is the signal.
--
-- Every G-assertion CALLS the real function (not a mirror of it) and fails
-- if the guard it names is removed:
--   G1  dead ground is not sampled          (the site-operating predicate)
--   G2  every watched refinery is sampled   (refinery branch untouched)
--   G3  R-1: the CEMS cohort is sampled, keyed on power_plants.id
--   G4  a day already started is finished   (the EXISTS branch)
--   G5  the derive still fails closed without regions (085 behaviour kept)
-- The region boxes mirror FIRMS_REGIONS (apps/web/lib/firms/client.ts,
-- origin/main 0b0d4b1). The dated watch items (C1–C4) are at the bottom,
-- commented out: run each on its date by highlighting it.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

DO $guards$
DECLARE
  c_regions  constant jsonb := '[{"west":22,"south":44,"east":60,"north":62},{"west":44,"south":22,"east":60,"north":34},{"west":-10,"south":35,"east":22,"north":60},{"west":100,"south":18,"east":146,"north":46},{"west":60,"south":5,"east":100,"north":37},{"west":95,"south":-11,"east":142,"north":20},{"west":-100,"south":24,"east":-52,"north":55},{"west":-130,"south":25,"east":-100,"north":55}]'::jsonb;
  c_day1     constant date := DATE '2099-01-01';
  c_day2     constant date := DATE '2099-01-02';
  r_results  jsonb := '[]'::jsonb;
  v_ok       boolean;
  v_detail   text;
  v_md5      text;
  v_src      text;
  v_oid      oid;
  v_pre_day  date;
  -- expectations, read from the registry (never hard-coded)
  e_ref      integer;   -- refineries with geom inside the boxes
  e_live     integer;   -- >= 500 MW units at an operating site, inside the boxes
  e_dead     integer;   -- >= 500 MW units at a site with no operating unit, inside the boxes
  e_cems     integer;   -- R-1 cohort on the day before the cut
  -- observations, read back from what the function wrote
  o_rows1    integer;
  o_rows2    integer;
  o_ref      integer;
  o_live     integer;
  o_dead     integer;
  o_cems     integer;
  o_cems_key integer;
  o_ms       integer;
  o_dead_id  text;
  o_g4_count integer;
  o_g4_radius numeric;
  o_g4_fresh boolean;
  o_g5_raised boolean := false;
  t0         timestamptz;
  n_pass     integer;
  n_all      integer;
  failed     text;
BEGIN
  -- ── E · existence and definition (run first) ─────────────────────────
  v_oid := to_regprocedure('public.firms_derive_facility_observations(date, numeric, numeric, jsonb)');
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = v_oid;

  r_results := r_results || jsonb_build_object('id', 'E1', 'what', 'firms_derive_facility_observations(date, numeric, numeric, jsonb) exists',
                 'ok', v_oid IS NOT NULL, 'detail', coalesce(v_oid::text, 'missing'));
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = v_oid;
  r_results := r_results || jsonb_build_object('id', 'E2', 'what', 'its body carries the 166 predicate exactly once, in the power branch of monitored',
                 'ok', (length(v_src) - length(replace(v_src, 'mig 166 (Reality Check PR-3)', '')))
                         / length('mig 166 (Reality Check PR-3)') = 1
                       AND position(E'       AND p.capacity_mw >= p_min_mw\n       -- mig 166 (Reality Check PR-3)' IN v_src) > 0,
                 'detail', 'body md5 ' || coalesce(v_md5, 'none')
                           || CASE v_md5 WHEN '970b5efc72895bbaeb6356d36fa3f896' THEN ' (085 + 166)'
                                         WHEN 'c4296bdc42502ae41f1e364476784099' THEN ' (164 + 166)'
                                         ELSE ' (another base + 166: record it)' END);
  r_results := r_results || jsonb_build_object('id', 'E3', 'what', 'no stale 3-arg overload',
                 'ok', to_regprocedure('public.firms_derive_facility_observations(date, numeric, numeric)') IS NULL, 'detail', '');
  v_ok := v_oid IS NOT NULL
          AND NOT has_function_privilege('anon', v_oid, 'EXECUTE')
          AND NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
          AND has_function_privilege('service_role', v_oid, 'EXECUTE');
  r_results := r_results || jsonb_build_object('id', 'E4', 'what', 'service_role only (anon, authenticated cannot execute)',
                 'ok', coalesce(v_ok, false), 'detail', '');
  SELECT (at AT TIME ZONE 'UTC')::date - 1 INTO v_pre_day
    FROM public.ledger_change_log
   WHERE note LIKE 'sensor roster: FIRMS and night-lights stop sampling power sites%'
   ORDER BY at LIMIT 1;
  r_results := r_results || jsonb_build_object('id', 'E5', 'what', 'the cut is on the record in ledger_change_log',
                 'ok', v_pre_day IS NOT NULL, 'detail', coalesce('cut day ' || (v_pre_day + 1)::text, 'no row'));
  v_pre_day := coalesce(v_pre_day, (SELECT max(period) - 1 FROM firms_facility_observations));

  -- ── expectations from the registry ────────────────────────────────────
  SELECT count(*) INTO e_ref
    FROM refineries r
   WHERE r.geom IS NOT NULL AND firms_point_in_regions(r.latitude, r.longitude, c_regions);

  WITH op_sites AS (
    SELECT DISTINCT gem_location_id FROM power_plants
     WHERE status = 'operating' AND gem_location_id IS NOT NULL
  )
  SELECT count(*) FILTER (WHERE p.status = 'operating' OR p.gem_location_id IS NULL
                                 OR p.gem_location_id IN (SELECT gem_location_id FROM op_sites)),
         count(*) FILTER (WHERE NOT (p.status = 'operating' OR p.gem_location_id IS NULL
                                     OR p.gem_location_id IN (SELECT gem_location_id FROM op_sites)))
    INTO e_live, e_dead
    FROM power_plants p
   WHERE p.geom IS NOT NULL AND p.capacity_mw >= 500
     AND firms_point_in_regions(p.latitude, p.longitude, c_regions);

  SELECT count(*) INTO e_cems
    FROM firms_facility_observations o
    JOIN power_plants p ON p.id = o.facility_id
   WHERE o.period = v_pre_day AND o.facility_type = 'power_plant'
     AND p.status = 'operating' AND p.fuel_type IN ('coal', 'oil/gas', 'bioenergy')
     AND p.country = 'United States';

  -- ── G1–G5 · call the real function; undo every write ─────────────────
  BEGIN
    -- G1–G3: a day nothing has started (no rows, no detections)
    t0 := clock_timestamp();
    o_rows1 := public.firms_derive_facility_observations(c_day1, 5, 500, c_regions);
    o_ms := (extract(epoch FROM clock_timestamp() - t0) * 1000)::int;

    WITH op_sites AS (
      SELECT DISTINCT gem_location_id FROM power_plants
       WHERE status = 'operating' AND gem_location_id IS NOT NULL
    )
    SELECT count(*) FILTER (WHERE o.facility_type = 'refinery'),
           count(*) FILTER (WHERE o.facility_type = 'power_plant'
                              AND (p.status = 'operating' OR p.gem_location_id IS NULL
                                   OR p.gem_location_id IN (SELECT gem_location_id FROM op_sites))),
           count(*) FILTER (WHERE o.facility_type = 'power_plant'
                              AND NOT (p.status = 'operating' OR p.gem_location_id IS NULL
                                       OR p.gem_location_id IN (SELECT gem_location_id FROM op_sites)))
      INTO o_ref, o_live, o_dead
      FROM firms_facility_observations o
      LEFT JOIN power_plants p ON o.facility_type = 'power_plant' AND p.id = o.facility_id
     WHERE o.period = c_day1;

    -- R-1: the cohort from the day before the cut, found on the new day by
    -- the SAME key (facility_id = power_plants.id)
    SELECT count(*), count(pp.id)
      INTO o_cems, o_cems_key
      FROM firms_facility_observations pre
      JOIN power_plants p ON p.id = pre.facility_id
      JOIN firms_facility_observations nd
        ON nd.period = c_day1 AND nd.facility_type = 'power_plant' AND nd.facility_id = pre.facility_id
      LEFT JOIN power_plants pp ON pp.id = nd.facility_id
     WHERE pre.period = v_pre_day AND pre.facility_type = 'power_plant'
       AND p.status = 'operating' AND p.fuel_type IN ('coal', 'oil/gas', 'bioenergy')
       AND p.country = 'United States';

    -- G4: a removed unit that ALREADY has a row for a day is re-derived
    WITH op_sites AS (
      SELECT DISTINCT gem_location_id FROM power_plants
       WHERE status = 'operating' AND gem_location_id IS NOT NULL
    )
    SELECT p.id INTO o_dead_id
      FROM power_plants p
     WHERE p.geom IS NOT NULL AND p.capacity_mw >= 500
       AND firms_point_in_regions(p.latitude, p.longitude, c_regions)
       AND p.status <> 'operating'
       AND p.gem_location_id IS NOT NULL
       AND p.gem_location_id NOT IN (SELECT gem_location_id FROM op_sites)
     ORDER BY p.id
     LIMIT 1;

    IF o_dead_id IS NOT NULL THEN
      INSERT INTO firms_facility_observations
             (facility_type, facility_id, facility_name, country, period,
              detection_count, max_frp, nearest_km, radius_km, computed_at)
      VALUES ('power_plant', o_dead_id, 'PR-3 guard fixture', NULL, c_day2,
              7, 99.9, 0.1, 1, TIMESTAMPTZ '2000-01-01 00:00:00+00');

      o_rows2 := public.firms_derive_facility_observations(c_day2, 5, 500, c_regions);

      SELECT detection_count, radius_km, computed_at > TIMESTAMPTZ '2000-01-01 00:00:00+00'
        INTO o_g4_count, o_g4_radius, o_g4_fresh
        FROM firms_facility_observations
       WHERE facility_type = 'power_plant' AND facility_id = o_dead_id AND period = c_day2;
    END IF;

    -- G5: no regions → fails closed and loud (085 behaviour kept)
    BEGIN
      PERFORM public.firms_derive_facility_observations(c_day1, 5, 500, NULL);
    EXCEPTION WHEN raise_exception THEN
      o_g5_raised := true;
    END;

    RAISE EXCEPTION 'pr3_guard_rollback' USING ERRCODE = 'P0003';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN
    NULL;   -- every write above is undone; the variables keep the readings
  END;

  r_results := r_results || jsonb_build_object('id', 'G1', 'what', 'dead ground is not sampled: no unit at a site without an operating unit gets a row',
                 'ok', o_dead = 0 AND o_live = e_live AND e_dead > 0,
                 'detail', format('wrote %s dead-ground rows (expect 0); %s live power rows (expect %s); %s dead-ground units exist in the boxes', o_dead, o_live, e_live, e_dead));
  r_results := r_results || jsonb_build_object('id', 'G1b', 'what', 'nightly rows fall by the stated share (−48.1 % on 2026-09-18)',
                 'ok', o_rows1 = e_ref + e_live,
                 'detail', format('%s rows for a new day = %s refineries + %s power; before the cut %s → %s %% removed; derive took %s ms',
                                  o_rows1, e_ref, e_live, e_ref + e_live + e_dead,
                                  round(100.0 * e_dead / NULLIF(e_ref + e_live + e_dead, 0), 1), o_ms));
  r_results := r_results || jsonb_build_object('id', 'G2', 'what', 'every watched refinery is sampled',
                 'ok', o_ref = e_ref AND o_ref = (SELECT count(*) FROM firms_facility_observations
                                                  WHERE period = v_pre_day AND facility_type = 'refinery'),
                 'detail', format('%s refinery rows (expect %s, and the pre-cut day''s count)', o_ref, e_ref));
  r_results := r_results || jsonb_build_object('id', 'G3', 'what', 'R-1: the CEMS cohort is sampled, same key (facility_id = power_plants.id)',
                 'ok', e_cems > 0 AND o_cems = e_cems AND o_cems_key = e_cems,
                 'detail', format('%s of %s cohort unit rows on the new day, %s joining power_plants.id (2026-09-18: 582)', o_cems, e_cems, o_cems_key));
  r_results := r_results || jsonb_build_object('id', 'G4', 'what', 'a day already started is finished: a removed unit''s existing row is re-derived, none added',
                 'ok', o_dead_id IS NOT NULL AND o_rows2 = o_rows1 + 1
                       AND o_g4_count = 0 AND o_g4_radius = 5 AND coalesce(o_g4_fresh, false),
                 'detail', format('fixture %s: rows %s (expect %s), detection_count %s (expect 0), radius %s (expect 5), recomputed %s',
                                  o_dead_id, o_rows2, o_rows1 + 1, o_g4_count, o_g4_radius, o_g4_fresh));
  r_results := r_results || jsonb_build_object('id', 'G5', 'what', 'no regions → raises (fails closed and loud, as 085)',
                 'ok', o_g5_raised, 'detail', '');

  -- ── report ───────────────────────────────────────────────────────────
  -- An assertion whose check could not be computed (NULL) is a FAIL.
  SELECT count(*) FILTER (WHERE coalesce((x->>'ok')::boolean, false)), count(*),
         string_agg(x->>'id', ', ') FILTER (WHERE NOT coalesce((x->>'ok')::boolean, false))
    INTO n_pass, n_all, failed
    FROM jsonb_array_elements(r_results) x;

  FOR v_detail IN
    SELECT CASE WHEN coalesce((x->>'ok')::boolean, false) THEN 'PASS ' ELSE 'FAIL ' END
           || (x->>'id') || ' ' || (x->>'what')
           || CASE WHEN coalesce(x->>'detail', '') = '' THEN '' ELSE ' — ' || (x->>'detail') END
      FROM jsonb_array_elements(r_results) x
  LOOP
    RAISE NOTICE '%', v_detail;
  END LOOP;
  RAISE NOTICE 'PR-3 guards: % of % assertions passed', n_pass, n_all;

  IF failed IS NOT NULL THEN
    RAISE EXCEPTION 'PR-3 guards FAILED: %', failed;
  END IF;
END
$guards$;

ROLLBACK;

SELECT 'PR-3 guards: all assertions passed (E1–E5, G1–G5); nothing was written' AS result;

-- ═══════════════════════════════════════════════════════════════════════
-- DATED WATCH ITEMS — read-only. Highlight ONE block and "Run selected" on
-- the day it names; paste the rows back. The cut day is read from the
-- ledger_change_log row 166 wrote, so nothing here needs editing.
-- ═══════════════════════════════════════════════════════════════════════

-- C1 · apply day + 1 (after the first hourly ingest): rows per day.
--      Expect the cut day and the day before at 431 refinery / 10,125 power
--      (started before the cut, finished by the derive), every later day at
--      431 / 5,046. Exception: if 166 was applied before the cut day's first
--      successful derive (just after 00:00 UTC), the cut day already reads
--      431 / 5,046 — also correct, nothing had been started for it.
-- WITH cut AS (SELECT min(at) AS at FROM public.ledger_change_log
--               WHERE note LIKE 'sensor roster: FIRMS and night-lights stop sampling power sites%')
-- SELECT o.period, o.facility_type, count(*) AS rows, max(o.computed_at) AS newest_compute
--   FROM firms_facility_observations o, cut
--  WHERE o.period >= (cut.at AT TIME ZONE 'UTC')::date - 1
--  GROUP BY 1, 2 ORDER BY 1, 2;

-- C2 · apply day + 3 — needs migration 159 (PR-1). Every FIRMS day after
--      the cut day is `usable`, roster_size = rows_present = 431 / 5,046.
-- WITH cut AS (SELECT min(at) AS at FROM public.ledger_change_log
--               WHERE note LIKE 'sensor roster: FIRMS and night-lights stop sampling power sites%')
-- SELECT c.sensor, c.facility_type, c.night, c.rows_present, c.roster_size, c.coverage_ratio, c.status
--   FROM public.sensor_night_census c, cut
--  WHERE c.sensor = 'firms' AND c.night > (cut.at AT TIME ZONE 'UTC')::date
--  ORDER BY c.night, c.facility_type;

-- C3 · apply day + ~12 — needs migration 159 (PR-1). The first Black Marble
--      nights whose ingest ran on or after cut day + 6 (the worker's roster is
--      FIRMS rows dated today-5..today, so the removed sites' last rows — the
--      cut day — leave it then): `usable` for both types, power roster ≈ 5,046,
--      refineries 431. The build prompt's acceptance: "the first post-cut
--      night is usable in the census".
-- WITH cut AS (SELECT min(at) AS at FROM public.ledger_change_log
--               WHERE note LIKE 'sensor roster: FIRMS and night-lights stop sampling power sites%')
-- SELECT c.sensor, c.facility_type, c.night, c.rows_present, c.roster_size, c.coverage_ratio,
--        c.ingest_ran_at, c.status
--   FROM public.sensor_night_census c, cut
--  WHERE c.sensor = 'blackmarble'
--    AND (c.ingest_ran_at AT TIME ZONE 'UTC')::date >= (cut.at AT TIME ZONE 'UTC')::date + 6
--  ORDER BY c.night, c.facility_type
--  LIMIT 8;

-- C4 · apply day + ~21: what happened to machine claims at the sites the cut
--      removed. Expect `void` or `scored`; `scored` with window_after_cut =
--      true on firms_went_dark_recovery would mean a claim was scored on a
--      window with no FIRMS look at all — report it as a defect.
-- WITH cut AS (SELECT min(at) AS at FROM public.ledger_change_log
--               WHERE note LIKE 'sensor roster: FIRMS and night-lights stop sampling power sites%'),
-- op_sites AS (SELECT DISTINCT gem_location_id FROM power_plants
--               WHERE status = 'operating' AND gem_location_id IS NOT NULL),
-- units AS (SELECT round(p.latitude::numeric, 4)::text || ':' || round(p.longitude::numeric, 4)::text AS site_key,
--                  (p.status = 'operating' OR p.gem_location_id IS NULL
--                   OR p.gem_location_id IN (SELECT gem_location_id FROM op_sites)) AS kept
--             FROM power_plants p WHERE p.capacity_mw >= 500 AND p.geom IS NOT NULL),
-- removed_sites AS (SELECT site_key FROM units GROUP BY 1 HAVING NOT bool_or(kept)
--                   EXCEPT
--                   SELECT round(r.latitude::numeric, 4)::text || ':' || round(r.longitude::numeric, 4)::text
--                     FROM refineries r)
-- SELECT r.feature,
--        CASE WHEN o.prediction_id IS NULL THEN 'open'
--             WHEN o.void_reason IS NOT NULL THEN 'void' ELSE 'scored' END AS outcome,
--        (r.context->>'flagged_period')::date >= (SELECT (at AT TIME ZONE 'UTC')::date FROM cut) AS window_after_cut,
--        count(*) AS claims
--   FROM predictions_register r
--   LEFT JOIN prediction_outcomes o ON o.prediction_id = r.id
--  WHERE r.track = 'machine' AND r.source IN ('blackmarble', 'firms-recovery')
--    AND r.context->>'site_key' IN (SELECT site_key FROM removed_sites)
--    AND r.resolves_at >= (SELECT at - interval '14 days' FROM cut)
--  GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
