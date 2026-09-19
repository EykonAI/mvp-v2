-- ═══════════════════════════════════════════════════════════════════════════
-- PR-2 guard tests — migrations 162 + 163 (port-call derivation repair).
--
-- Run the WHOLE file in the Supabase SQL Editor AFTER applying 162 and 163.
-- It wraps itself in BEGIN … ROLLBACK: nothing it writes survives. It first
-- takes the derivation lock, so it waits for (never races) the pg_cron jobs.
-- Each assertion prints one NOTICE "PASS n · …"; a removed guard raises
-- "FAIL n · …" and stops the file. Paste the notices back.
--
-- Synthetic rows use mmsi PR2GUARD* and days in the year 2000 — outside the
-- derivation span, so no real day is pruned or rewritten. Assertion 9
-- re-derives one real day (today − 2) twice inside the transaction, and
-- assertion 11 a third time through derive_port_calls_due: ~60–75 s in all,
-- every statement well inside the 120 s timeout. All of it rolls back.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('eykon.port_call_derivation'));

-- ─── 0 · Every object exists ───────────────────────────────────────────────
DO $$
DECLARE
  v_missing text[] := '{}';
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('table',      'public.port_call_derivation_runs'),
      ('table',      'public.port_call_days'),
      ('view',       'public.port_call_coverage'),
      ('function',   'public.port_call_first_day()'),
      ('function',   'public.derive_port_call_day(date)'),
      ('function',   'public.rebuild_port_calls(date,date)'),
      ('function',   'public.port_call_due_days()'),
      ('function',   'public.derive_port_calls_due(integer,integer)'),
      ('function',   'public.port_call_window_coverage(integer)'),
      ('function',   'public.oil_port_call_candidates(integer,numeric)'),
      ('function',   'public.prune_ais_position_history(integer,integer,integer)'),
      ('index',      'public.port_calls_generation_key'),
      ('index',      'public.idx_port_calls_port_arrived'),
      ('constraint', 'port_call_derivation_runs_shape_check'),
      ('constraint', 'port_call_derivation_runs_pruned_check'),
      ('constraint', 'port_calls_derived_by_check'),
      ('constraint', 'port_calls_v2_shape_check'),
      ('cron',       'derive-port-calls'),
      ('cron',       'prune-ais-history')
    ) AS t(kind, name)
  LOOP
    IF (r.kind IN ('table', 'view', 'index') AND to_regclass(r.name) IS NULL)
       OR (r.kind = 'function' AND to_regprocedure(r.name) IS NULL)
       OR (r.kind = 'constraint' AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.name))
       OR (r.kind = 'cron' AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = r.name AND active))
    THEN
      v_missing := v_missing || (r.kind || ' ' || r.name);
    END IF;
  END LOOP;
  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION 'FAIL 0 · missing: %', array_to_string(v_missing, ', ');
  END IF;
  RAISE NOTICE 'PASS 0 · every PR-2 object exists (2 tables, view, 8 functions, indexes, constraints, 2 active cron jobs)';
END $$;

-- ─── 1 · Retention can never go below the 14-day floor ────────────────────
DO $$
BEGIN
  BEGIN
    PERFORM public.prune_ais_position_history(13, 1, 7);
    RAISE EXCEPTION 'FAIL 1 · prune accepted a 13-day retention';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%14-day floor%' THEN
      RAISE EXCEPTION 'FAIL 1 · refused for the wrong reason: %', SQLERRM;
    END IF;
  END;
  RAISE NOTICE 'PASS 1 · a retention below 14 days is refused';
END $$;

-- ─── 2 · Prune never deletes a day that has not been derived ──────────────
DO $$
DECLARE
  v_ret     integer := (now() AT TIME ZONE 'UTC')::date - date '2000-01-10';   -- floor = 2000-01-10
  v_under   integer;
  v_derived integer;
  v_marked  timestamptz;
BEGIN
  INSERT INTO public.ais_position_history (mmsi, latitude, longitude, speed, recorded_at)
  VALUES ('PR2GUARD01', 1.0, 1.0, 0.1, '2000-01-03 12:00+00'),   -- day never attempted
         ('PR2GUARD01', 1.0, 1.0, 0.1, '2000-01-04 12:00+00'),   -- day failed (must stay retryable)
         ('PR2GUARD01', 1.0, 1.0, 0.1, '2000-01-05 12:00+00');   -- day derived
  INSERT INTO public.port_call_derivation_runs (day, status, samples_scanned, live_hours, error, ran_at)
  VALUES ('2000-01-04', 'failed',  0, 0, 'guard-test failure', '2000-01-20+00'),
         ('2000-01-05', 'derived', 1, 1, NULL, '2000-01-20+00'),
         ('2000-01-06', 'derived', 1, 1, NULL, '2000-01-20+00');

  BEGIN
    PERFORM public.prune_ais_position_history(v_ret, 3, 7);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'FAIL 2 · prune errored instead of skipping the underived days: %', SQLERRM;
  END;

  SELECT count(*) INTO v_under   FROM public.ais_position_history
   WHERE mmsi = 'PR2GUARD01' AND recorded_at IN ('2000-01-03 12:00+00', '2000-01-04 12:00+00');
  SELECT count(*) INTO v_derived FROM public.ais_position_history
   WHERE mmsi = 'PR2GUARD01' AND recorded_at = '2000-01-05 12:00+00';
  SELECT raw_pruned_at INTO v_marked FROM public.port_call_derivation_runs WHERE day = '2000-01-05';

  IF v_under <> 2 THEN
    RAISE EXCEPTION 'FAIL 2 · prune deleted a day that is not recorded derived (2000-01-03 unattempted / 2000-01-04 failed)';
  END IF;
  IF v_derived <> 0 OR v_marked IS NULL THEN
    RAISE EXCEPTION 'FAIL 2 · prune did not delete and mark the derived day (rows left %, marked %)', v_derived, v_marked;
  END IF;
  RAISE NOTICE 'PASS 2 · prune deleted the derived day and marked raw_pruned_at; kept the unattempted and the failed day';
END $$;

-- ─── 3 · A pruned day is never re-derived (it would erase its atoms) ──────
DO $$
DECLARE
  v_res   jsonb;
  v_atoms integer;
BEGIN
  INSERT INTO public.port_call_days (mmsi, port_id, day, seq, first_at, last_at, samples)
  VALUES ('PR2GUARD01', (SELECT id FROM public.ports ORDER BY id LIMIT 1), '2000-01-05', 1,
          '2000-01-05 12:00+00', '2000-01-05 12:00+00', 1);
  BEGIN
    v_res := public.derive_port_call_day('2000-01-05');
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'FAIL 3 · derive_port_call_day did not refuse a pruned day cleanly: %', SQLERRM;
  END;
  SELECT count(*) INTO v_atoms FROM public.port_call_days WHERE mmsi = 'PR2GUARD01' AND day = '2000-01-05';
  IF v_res->>'skipped' IS DISTINCT FROM 'raw_pruned' OR v_atoms <> 1 THEN
    RAISE EXCEPTION 'FAIL 3 · pruned day was re-derived: result %, atoms left %', v_res, v_atoms;
  END IF;
  RAISE NOTICE 'PASS 3 · a pruned day is refused (%), its atoms untouched', v_res->>'skipped';
END $$;

-- ─── 4 · The run record cannot hold a zero, an unknown status, or a pruned
--        day that is not derived ─────────────────────────────────────────────
DO $$
BEGIN
  BEGIN
    INSERT INTO public.port_call_derivation_runs (day, status, samples_scanned, live_hours)
    VALUES ('2000-03-01', 'derived', 0, 0);
    RAISE EXCEPTION 'FAIL 4a · a derived day with zero samples was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'PASS 4a · "derived" with zero samples is rejected — an empty day is samples_absent, never a zero';
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.port_call_derivation_runs (day, status) VALUES ('2000-03-02', 'zero');
    RAISE EXCEPTION 'FAIL 4b · an unknown status was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'PASS 4b · the status vocabulary is closed (derived | samples_absent | failed)';
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.port_call_derivation_runs (day, status, raw_pruned_at)
    VALUES ('2000-03-03', 'samples_absent', now());
    RAISE EXCEPTION 'FAIL 4c · a pruned day that is not derived was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'PASS 4c · only a derived day can be marked raw-pruned';
END $$;

-- ─── 5 · An AIS-outage day is samples_absent, not a zero ──────────────────
DO $$
DECLARE
  v_res jsonb;
  v_st  text;
BEGIN
  -- 2026-08-10 is inside the 08-06 → 08-16 outage: zero rows in ais_position_history.
  IF EXISTS (SELECT 1 FROM public.ais_position_history
              WHERE recorded_at >= '2026-08-10 00:00+00' AND recorded_at < '2026-08-11 00:00+00') THEN
    RAISE EXCEPTION 'FAIL 5 · precondition: 2026-08-10 is expected to hold no samples';
  END IF;
  BEGIN
    v_res := public.derive_port_call_day('2026-08-10');
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'FAIL 5 · deriving the outage day raised: %', SQLERRM;
  END;
  SELECT status INTO v_st FROM public.port_call_coverage WHERE day = '2026-08-10';
  IF v_res->>'status' IS DISTINCT FROM 'samples_absent' OR v_st IS DISTINCT FROM 'samples_absent' THEN
    RAISE EXCEPTION 'FAIL 5 · outage day derived as %, coverage reads %', v_res->>'status', v_st;
  END IF;
  RAISE NOTICE 'PASS 5 · 2026-08-10 (AIS outage) is samples_absent in the run record and the coverage view';
END $$;

-- ─── 6 · A day never attempted reads "missing", never zero; today is pending
DO $$
DECLARE
  v_st    text;
  v_today text;
BEGIN
  DELETE FROM public.port_call_derivation_runs WHERE day = '2026-07-06';
  SELECT status INTO v_st FROM public.port_call_coverage WHERE day = '2026-07-06';
  SELECT status INTO v_today FROM public.port_call_coverage WHERE day = (now() AT TIME ZONE 'UTC')::date;
  IF v_st IS DISTINCT FROM 'missing' THEN
    RAISE EXCEPTION 'FAIL 6 · an unattempted day reads % instead of missing', v_st;
  END IF;
  IF v_today IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'FAIL 6 · today reads % instead of pending', v_today;
  END IF;
  IF EXISTS (SELECT 1 FROM public.port_call_coverage
              WHERE status NOT IN ('derived', 'samples_absent', 'failed', 'missing', 'pending')
                 OR status IS NULL) THEN
    RAISE EXCEPTION 'FAIL 6 · the coverage view emitted a status outside the vocabulary';
  END IF;
  RAISE NOTICE 'PASS 6 · unattempted day = missing, today = pending, vocabulary closed';
END $$;

-- ─── 7 · Consumers carry the denominator and degrade when incomplete ──────
DO $$
DECLARE
  v_today  date := (now() AT TIME ZONE 'UTC')::date;
  v_port   text;
  c        record;
  o        record;
BEGIN
  -- Every one of the last 21 completed days derived, full feed.
  INSERT INTO public.port_call_derivation_runs AS r (day, status, samples_scanned, live_hours, ran_at)
  SELECT gs::date, 'derived', 1, 24, now()
    FROM generate_series((v_today - 21)::timestamp, (v_today - 1)::timestamp, interval '1 day') gs
  ON CONFLICT (day) DO UPDATE SET status = 'derived', samples_scanned = GREATEST(r.samples_scanned, 1),
                                  live_hours = 24, error = NULL;
  SELECT * INTO c FROM public.port_call_window_coverage(21);
  IF NOT c.complete OR c.label <> 'coverage 21/21 days' THEN
    RAISE EXCEPTION 'FAIL 7 · a fully derived window reads % / complete %', c.label, c.complete;
  END IF;

  -- One day artificially un-derived.
  DELETE FROM public.port_call_derivation_runs WHERE day = v_today - 5;
  SELECT * INTO c FROM public.port_call_window_coverage(21);
  IF c.complete OR c.days_derived <> 20 OR c.days_missing <> 1 OR c.label <> 'coverage 20/21 days' THEN
    RAISE EXCEPTION 'FAIL 7 · one missing day reads % / derived % / missing % / complete %',
      c.label, c.days_derived, c.days_missing, c.complete;
  END IF;

  -- oil_port_call_candidates: v2 rows only, each carrying the same denominator.
  SELECT p.id INTO v_port FROM public.ports p
   WHERE EXISTS (SELECT 1 FROM public.refineries r WHERE ST_DWithin(r.geom, p.geom, 5000))
   ORDER BY p.id LIMIT 1;
  IF v_port IS NULL THEN RAISE EXCEPTION 'FAIL 7 · precondition: no port within 5 km of a refinery'; END IF;
  INSERT INTO public.port_calls (mmsi, port_id, arrived_at, departed_at, sample_count, day_count,
                                 arrival_observed, departure_observed, derived_by)
  VALUES ('PR2GUARD02', v_port, now() - interval '2 days', now() - interval '2 days' + interval '3 hours',
          3, 1, true, false, 'v2_day');
  INSERT INTO public.port_calls (mmsi, port_id, arrived_at, departed_at, sample_count, derived_by)
  VALUES ('PR2GUARD03', v_port, now() - interval '2 days', NULL, 1, 'v1_window');

  SELECT * INTO o FROM public.oil_port_call_candidates(21, 5000) WHERE mmsi = 'PR2GUARD02';
  IF o.mmsi IS NULL OR o.coverage_days_derived <> 20 OR o.coverage_days_total <> 21
     OR o.coverage_complete OR o.coverage_label <> 'coverage 20/21 days' THEN
    RAISE EXCEPTION 'FAIL 7 · oil candidate lacks the denominator: %', row_to_json(o);
  END IF;
  IF EXISTS (SELECT 1 FROM public.oil_port_call_candidates(21, 5000) WHERE mmsi = 'PR2GUARD03') THEN
    RAISE EXCEPTION 'FAIL 7 · oil_port_call_candidates returned a legacy v1_window row';
  END IF;

  -- A partial feed day is not full coverage either.
  INSERT INTO public.port_call_derivation_runs (day, status, samples_scanned, live_hours, ran_at)
  VALUES (v_today - 5, 'derived', 1, 20, now());
  SELECT * INTO c FROM public.port_call_window_coverage(21);
  IF c.complete OR c.label <> 'coverage 21/21 days (1 partial)' THEN
    RAISE EXCEPTION 'FAIL 7 · a partial day reads % / complete %', c.label, c.complete;
  END IF;
  RAISE NOTICE 'PASS 7 · "coverage 21/21 days" → one day un-derived → "coverage 20/21 days", complete false, on the oil candidates too (v1 rows excluded); a partial day also blocks complete';
END $$;

-- ─── 8 · v1 is retired; the two generations coexist without collisions ────
DO $$
DECLARE
  v_port text := (SELECT id FROM public.ports ORDER BY id LIMIT 1);
BEGIN
  BEGIN
    PERFORM public.derive_port_calls(now() - interval '1 minute');
    RAISE EXCEPTION 'FAIL 8 · derive_port_calls(timestamptz) still runs';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL%' OR SQLERRM NOT LIKE '%retired by migration 162%' THEN
      RAISE EXCEPTION 'FAIL 8 · v1 not retired: %', SQLERRM;
    END IF;
  END;

  INSERT INTO public.port_calls (mmsi, port_id, arrived_at, sample_count, derived_by)
  VALUES ('PR2GUARD05', v_port, '2000-04-01 10:00+00', 1, 'v1_window');
  INSERT INTO public.port_calls (mmsi, port_id, arrived_at, departed_at, sample_count, day_count,
                                 arrival_observed, departure_observed, derived_by)
  VALUES ('PR2GUARD05', v_port, '2000-04-01 10:00+00', '2000-04-01 11:00+00', 2, 1, false, false, 'v2_day');
  BEGIN
    INSERT INTO public.port_calls (mmsi, port_id, arrived_at, departed_at, sample_count, day_count,
                                   arrival_observed, departure_observed, derived_by)
    VALUES ('PR2GUARD05', v_port, '2000-04-01 10:00+00', '2000-04-01 11:00+00', 2, 1, false, false, 'v2_day');
    RAISE EXCEPTION 'FAIL 8 · a duplicate v2 episode was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.port_calls (mmsi, port_id, arrived_at, sample_count, derived_by)
    VALUES ('PR2GUARD05', v_port, '2000-04-02 10:00+00', 1, 'v3');
    RAISE EXCEPTION 'FAIL 8 · an unknown derived_by was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.port_calls (mmsi, port_id, arrived_at, sample_count, derived_by)
    VALUES ('PR2GUARD05', v_port, '2000-04-03 10:00+00', 1, 'v2_day');
    RAISE EXCEPTION 'FAIL 8 · a v2 episode without evidence flags was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'PASS 8 · v1 derivation raises "retired"; v1 and v2 rows share a key; v2 is unique, labelled and carries its evidence';
END $$;

-- ─── 9 · Re-derivation is a replacement; the rollup is idempotent ─────────
DO $$
DECLARE
  v_day    date := (now() AT TIME ZONE 'UTC')::date - 2;
  v_md5_1  text;  v_md5_2  text;
  v_pc_1   text;  v_pc_2   text;
  v_runs   integer;
  v_again  jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM public.port_call_derivation_runs WHERE day = v_day AND raw_pruned_at IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL 9 · precondition: % is already pruned', v_day;
  END IF;

  BEGIN
    PERFORM public.derive_port_call_day(v_day);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'FAIL 9 · first derivation of % raised: %', v_day, SQLERRM;
  END;
  SELECT md5(string_agg(concat_ws('|', mmsi, port_id, seq, first_at, last_at, samples,
                                  prev_fix_at, prev_fix_at_port, next_fix_at, next_fix_at_port),
                        ',' ORDER BY mmsi, port_id, seq))
    INTO v_md5_1 FROM public.port_call_days WHERE day = v_day;
  SELECT md5(string_agg(concat_ws('|', id, mmsi, port_id, arrived_at, departed_at, sample_count,
                                  day_count, arrival_observed, departure_observed),
                        ',' ORDER BY mmsi, port_id, arrived_at))
    INTO v_pc_1 FROM public.port_calls
   WHERE derived_by = 'v2_day'
     AND departed_at >= (v_day::timestamp AT TIME ZONE 'UTC')
     AND arrived_at  <  ((v_day + 1)::timestamp AT TIME ZONE 'UTC');

  BEGIN
    PERFORM public.derive_port_call_day(v_day);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'FAIL 9 · re-deriving % raised (not a replacement): %', v_day, SQLERRM;
  END;
  SELECT md5(string_agg(concat_ws('|', mmsi, port_id, seq, first_at, last_at, samples,
                                  prev_fix_at, prev_fix_at_port, next_fix_at, next_fix_at_port),
                        ',' ORDER BY mmsi, port_id, seq))
    INTO v_md5_2 FROM public.port_call_days WHERE day = v_day;
  SELECT md5(string_agg(concat_ws('|', id, mmsi, port_id, arrived_at, departed_at, sample_count,
                                  day_count, arrival_observed, departure_observed),
                        ',' ORDER BY mmsi, port_id, arrived_at))
    INTO v_pc_2 FROM public.port_calls
   WHERE derived_by = 'v2_day'
     AND departed_at >= (v_day::timestamp AT TIME ZONE 'UTC')
     AND arrived_at  <  ((v_day + 1)::timestamp AT TIME ZONE 'UTC');
  SELECT count(*) INTO v_runs FROM public.port_call_derivation_runs WHERE day = v_day;

  v_again := public.rebuild_port_calls(v_day, v_day);

  IF v_md5_1 IS NULL OR v_md5_1 IS DISTINCT FROM v_md5_2 THEN
    RAISE EXCEPTION 'FAIL 9 · re-deriving % changed its atoms', v_day;
  END IF;
  IF v_pc_1 IS DISTINCT FROM v_pc_2 THEN
    RAISE EXCEPTION 'FAIL 9 · re-deriving % changed its episodes (ids or values)', v_day;
  END IF;
  IF v_runs <> 1 THEN
    RAISE EXCEPTION 'FAIL 9 · % has % run rows', v_day, v_runs;
  END IF;
  IF (v_again->>'written')::int <> 0 OR (v_again->>'deleted')::int <> 0 THEN
    RAISE EXCEPTION 'FAIL 9 · a repeated rollup still wrote: %', v_again;
  END IF;
  RAISE NOTICE 'PASS 9 · % derived twice: identical atoms and episodes, one run row; repeated rollup wrote 0 · deleted 0', v_day;
END $$;

-- ─── 10 · Arrivals and departures count only when observed ────────────────
DO $$
DECLARE
  v_port text := (SELECT id FROM public.ports ORDER BY id LIMIT 1);
  v_res  jsonb;
  v_rows integer;
  a      record;
  b      record;
BEGIN
  -- Island 1: atoms A (02-01) + B (02-02), 1 h apart. A's previous fix was
  -- away from the port (arrival seen); B's next fix was away (departure seen).
  -- Island 2: atom C, first seen already there, never seen leaving.
  INSERT INTO public.port_call_days
    (mmsi, port_id, day, seq, first_at, last_at, samples, prev_fix_at, prev_fix_at_port, next_fix_at, next_fix_at_port)
  VALUES
    ('PR2GUARD04', v_port, '2000-02-01', 1, '2000-02-01 10:00+00', '2000-02-01 23:30+00', 14,
     '2000-02-01 07:00+00', false, '2000-02-02 00:30+00', true),
    ('PR2GUARD04', v_port, '2000-02-02', 1, '2000-02-02 00:30+00', '2000-02-02 05:00+00', 5,
     '2000-02-01 23:30+00', true, '2000-02-02 06:00+00', false),
    ('PR2GUARD04', v_port, '2000-02-02', 2, '2000-02-02 15:00+00', '2000-02-02 16:00+00', 2,
     NULL, NULL, NULL, NULL);

  PERFORM public.rebuild_port_calls('2000-02-01', '2000-02-02');

  SELECT count(*) INTO v_rows FROM public.port_calls WHERE mmsi = 'PR2GUARD04' AND derived_by = 'v2_day';
  SELECT * INTO a FROM public.port_calls
   WHERE mmsi = 'PR2GUARD04' AND derived_by = 'v2_day' AND arrived_at = '2000-02-01 10:00+00';
  SELECT * INTO b FROM public.port_calls
   WHERE mmsi = 'PR2GUARD04' AND derived_by = 'v2_day' AND arrived_at = '2000-02-02 15:00+00';

  IF v_rows <> 2 THEN
    RAISE EXCEPTION 'FAIL 10 · expected 2 episodes, got %', v_rows;
  END IF;
  IF a.departed_at <> '2000-02-02 05:00+00' OR a.day_count <> 2 OR a.sample_count <> 19
     OR a.arrival_observed IS NOT TRUE OR a.departure_observed IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL 10 · the observed episode is wrong: %', row_to_json(a);
  END IF;
  IF b.arrival_observed IS NOT FALSE OR b.departure_observed IS NOT FALSE OR b.departed_at IS NULL THEN
    RAISE EXCEPTION 'FAIL 10 · a first-seen-already-there episode counts as an arrival: %', row_to_json(b);
  END IF;

  v_res := public.rebuild_port_calls('2000-02-01', '2000-02-02');
  IF (v_res->>'written')::int <> 0 OR (v_res->>'deleted')::int <> 0 THEN
    RAISE EXCEPTION 'FAIL 10 · a repeated rollup wrote: %', v_res;
  END IF;
  RAISE NOTICE 'PASS 10 · atoms 1 h apart roll into one episode (2 days, 19 samples, arrival and departure observed); a first-seen-already-there episode is arrival_observed = false';
END $$;

-- ─── 11 · A recent day whose raw history grew after it was derived is
--         re-derived (late_rows) ahead of the backlog; a pruned day never is
DO $$
DECLARE
  v_day  date := (now() AT TIME ZONE 'UTC')::date - 2;   -- derived by assertion 9
  v_n    integer;
  v_why  text;
  v_res  jsonb;
BEGIN
  -- Every recent derived day scanned exactly what the raw history holds …
  UPDATE public.port_call_derivation_runs r
     SET samples_scanned = c.n
    FROM (SELECT (h.recorded_at AT TIME ZONE 'UTC')::date AS d, count(*)::integer AS n
            FROM public.ais_position_history h
           WHERE h.recorded_at >= (((now() AT TIME ZONE 'UTC')::date - 5)::timestamp AT TIME ZONE 'UTC')
             AND h.recorded_at <  (((now() AT TIME ZONE 'UTC')::date)::timestamp AT TIME ZONE 'UTC')
           GROUP BY 1) c
   WHERE r.day = c.d AND r.status = 'derived' AND r.raw_pruned_at IS NULL;
  -- … except v_day, derived before its last row landed (the sampler back-dates
  -- snapshot fixes up to ~3 days: 6,764 rows for 09-03 → 09-05 on 09-06).
  UPDATE public.port_call_derivation_runs
     SET samples_scanned = samples_scanned - 1
   WHERE day = v_day AND status = 'derived' AND raw_pruned_at IS NULL AND samples_scanned > 1;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FAIL 11 · precondition: % is not a derived, unpruned day with samples', v_day;
  END IF;

  SELECT d.reason INTO v_why FROM public.port_call_due_days() d WHERE d.day = v_day;
  IF v_why IS DISTINCT FROM 'late_rows' THEN
    RAISE EXCEPTION 'FAIL 11 · % holds more raw rows than it scanned but reads % instead of late_rows',
      v_day, COALESCE(v_why, 'not due');
  END IF;

  -- The pg_cron entry point takes it first: yesterday is recorded (assertion 7),
  -- and the backlog (2026-07-06 is missing since assertion 6) waits behind it.
  v_res := public.derive_port_calls_due(1);
  IF v_res->'days'->0->>'day' IS DISTINCT FROM v_day::text
     OR v_res->'days'->0->>'reason' IS DISTINCT FROM 'late_rows'
     OR v_res->'days'->0->>'status' IS DISTINCT FROM 'derived' THEN
    RAISE EXCEPTION 'FAIL 11 · derive_port_calls_due(1) did not re-derive the late day % first: %', v_day, v_res->'days';
  END IF;
  IF EXISTS (SELECT 1 FROM public.port_call_due_days() d WHERE d.day = v_day) THEN
    RAISE EXCEPTION 'FAIL 11 · % is still due after its re-derivation', v_day;
  END IF;

  -- A pruned day is never due again, whatever its counts say.
  UPDATE public.port_call_derivation_runs
     SET samples_scanned = samples_scanned - 1, raw_pruned_at = now()
   WHERE day = v_day;
  IF EXISTS (SELECT 1 FROM public.port_call_due_days() d WHERE d.day = v_day) THEN
    RAISE EXCEPTION 'FAIL 11 · a pruned day is listed as due';
  END IF;
  RAISE NOTICE 'PASS 11 · % with more raw rows than its run record scanned is due (late_rows) and re-derived first by derive_port_calls_due; once pruned it is never due', v_day;
END $$;

ROLLBACK;
