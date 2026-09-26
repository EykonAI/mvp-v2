-- IMG-3b · anchorage derivation without a spill — acceptance checks for 186.
--
-- READ ONLY and LIGHT: it runs EXPLAIN only (nothing is executed) inside
-- BEGIN … ROLLBACK. It checks the PLAN production would use for the cell
-- aggregation on the real ais_position_history: inlined, hash-aggregated,
-- no Sort, no planned partitions (a planned spill). A clean run ends with
-- ONE RESULT ROW ("IMG-3b guards: PASS 1-4 …"); 'Success. No rows returned'
-- means it did NOT run whole.

BEGIN;
SET LOCAL work_mem = '128MB';

DO $$
DECLARE
  r      record;
  v_plan text := '';
  v_src  text;
BEGIN
  -- ── 1. Objects ─────────────────────────────────────────────────────────
  IF to_regprocedure('public.imagery_stationary_cells(timestamptz,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'FAIL 1a: imagery_stationary_cells missing — 186 not applied';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = 'public.imagery_derive_anchorages(integer,integer)'::regprocedure;
  IF v_src NOT LIKE '%imagery_stationary_cells%' OR v_src ILIKE '%count(DISTINCT%' THEN
    RAISE EXCEPTION 'FAIL 1b: imagery_derive_anchorages is not the 186 version';
  END IF;
  IF v_src NOT LIKE '%greatest(p_days, 1), 3)%' THEN
    RAISE EXCEPTION 'FAIL 1c: the derivation window is not capped at 3 days';
  END IF;
  RAISE NOTICE 'PASS 1: 186 functions in place, window capped at 3 days';

  -- ── 2. Access ──────────────────────────────────────────────────────────
  IF has_function_privilege('anon', 'public.imagery_stationary_cells(timestamptz,timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.imagery_derive_anchorages(integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL 2: anon/authenticated can execute a 186 function';
  END IF;
  RAISE NOTICE 'PASS 2: service_role only';

  -- ── 3. The real plan on production data (EXPLAIN only) ─────────────────
  FOR r IN EXECUTE $q$EXPLAIN SELECT * FROM public.imagery_stationary_cells(now() - interval '3 days', now())$q$ LOOP
    v_plan := v_plan || r."QUERY PLAN" || E'\n';
  END LOOP;
  IF v_plan LIKE '%Function Scan%' THEN
    RAISE EXCEPTION 'FAIL 3a: imagery_stationary_cells was not inlined — its plan cannot be checked:%', E'\n' || v_plan;
  END IF;
  IF v_plan NOT LIKE '%HashAggregate%' THEN
    RAISE EXCEPTION 'FAIL 3b: no HashAggregate in the plan:%', E'\n' || v_plan;
  END IF;
  IF v_plan ~ '(^|\n)\s*(->\s*)?(Incremental )?Sort\M' THEN
    RAISE EXCEPTION 'FAIL 3c: the plan sorts the history — a spill risk:%', E'\n' || v_plan;
  END IF;
  IF v_plan LIKE '%Planned Partitions%' THEN
    RAISE EXCEPTION 'FAIL 3d: the planner expects the hash aggregate to spill:%', E'\n' || v_plan;
  END IF;
  RAISE NOTICE 'PASS 3: inlined · HashAggregate · no Sort · no planned partitions';

  -- ── 4. The history index is what the scan uses ─────────────────────────
  IF v_plan NOT LIKE '%idx_ais_history_recorded%' THEN
    RAISE EXCEPTION 'FAIL 4: the scan does not use idx_ais_history_recorded:%', E'\n' || v_plan;
  END IF;
  RAISE NOTICE 'PASS 4: range scan on idx_ais_history_recorded';
END
$$;

ROLLBACK;

SELECT 'IMG-3b guards: PASS 1-4 (186 in place + 3-day cap, service_role only, inlined HashAggregate with no Sort and no planned spill, index range scan)' AS result,
       (SELECT count(*) FROM public.ais_position_history WHERE recorded_at >= now() - interval '1 hour') AS history_rows_last_hour;
