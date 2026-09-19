-- PR-4 · reference-snapshot freshness — acceptance checks for migration 167.
--
-- READ ONLY. Run in the Supabase SQL Editor AFTER applying 167 (whole file).
-- Wrapped in BEGIN … ROLLBACK anyway, so nothing it touches can persist.
-- Each check RAISEs EXCEPTION on failure, which stops the script with its
-- FAIL message. A clean run ends with ONE RESULT ROW ("PR-4 guards: PASS
-- 1-5 …") — paste that row back, plus the PASS notices if the editor shows
-- them. The row is the signal because the DO block and the ROLLBACK return
-- no rows of their own: without it a clean run would read "Success. No rows
-- returned", the same banner a file that never ran whole shows.
--
-- Existence first (D-1), then the build-prompt acceptance: power_plants is
-- listed with its 2026-04-28 load and an age beyond its interval (stale →
-- the chip renders); a table inside its interval is not stale (→ no chip).

BEGIN;

DO $$
DECLARE
  v_invoker boolean;
  r         record;
  n_rows    integer;
BEGIN
  -- ── 1. The object exists, is security_invoker, service-role only ─────────
  IF NOT EXISTS (SELECT 1 FROM information_schema.views
                  WHERE table_schema = 'public' AND table_name = 'reference_snapshot_freshness') THEN
    RAISE EXCEPTION 'FAIL 1a: view public.reference_snapshot_freshness does not exist — 167 not applied';
  END IF;
  SELECT 'security_invoker=true' = ANY (c.reloptions) INTO v_invoker
    FROM pg_class c WHERE c.oid = 'public.reference_snapshot_freshness'::regclass;
  IF v_invoker IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 1b: view is not security_invoker';
  END IF;
  IF has_table_privilege('anon', 'public.reference_snapshot_freshness', 'SELECT')
     OR has_table_privilege('authenticated', 'public.reference_snapshot_freshness', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL 1c: anon or authenticated can read the view';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.reference_snapshot_freshness', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL 1d: service_role cannot read the view';
  END IF;
  RAISE NOTICE 'PASS 1: view exists · security_invoker · service_role only';

  -- ── 2. Every served registry has exactly one row ─────────────────────────
  SELECT count(*) INTO n_rows FROM public.reference_snapshot_freshness
   WHERE table_name IN ('power_plants','oil_pipelines','gas_pipelines','lng_terminals',
                        'refineries','airports','ports','mines');
  IF n_rows <> 8 THEN
    RAISE EXCEPTION 'FAIL 2: expected 8 registry rows, found %', n_rows;
  END IF;
  RAISE NOTICE 'PASS 2: 8 registries listed';

  -- ── 3. power_plants: loaded 2026-04-28, older than its interval, stale ───
  SELECT * INTO r FROM public.reference_snapshot_freshness WHERE table_name = 'power_plants';
  IF r.loaded_at::date <> DATE '2026-04-28' THEN
    RAISE EXCEPTION 'FAIL 3a: power_plants loaded_at is % (expected 2026-04-28 unless the registry was reloaded — if so, say so and re-read)', r.loaded_at;
  END IF;
  IF r.row_count <> 182417 THEN
    RAISE EXCEPTION 'FAIL 3b: power_plants row_count % (expected 182,417)', r.row_count;
  END IF;
  IF NOT (r.age_days > r.expected_refresh_days AND r.freshness_state = 'stale' AND r.is_stale) THEN
    RAISE EXCEPTION 'FAIL 3c: power_plants age % d vs interval % d, state %, is_stale % — expected stale',
      r.age_days, r.expected_refresh_days, r.freshness_state, r.is_stale;
  END IF;
  RAISE NOTICE 'PASS 3: power_plants loaded % · age % d > interval % d · stale (chip renders)',
    r.loaded_at::date, r.age_days, r.expected_refresh_days;

  -- ── 4. A table inside its interval is not stale (no chip) ────────────────
  SELECT * INTO r FROM public.reference_snapshot_freshness
   WHERE freshness_state = 'within_interval' ORDER BY table_name LIMIT 1;
  IF r.table_name IS NULL THEN
    RAISE EXCEPTION 'FAIL 4a: no registry is inside its interval (expected ports until 2027-04-28)';
  END IF;
  IF r.is_stale OR r.age_days > r.expected_refresh_days THEN
    RAISE EXCEPTION 'FAIL 4b: % reads within_interval but is_stale % / age % d vs % d',
      r.table_name, r.is_stale, r.age_days, r.expected_refresh_days;
  END IF;
  RAISE NOTICE 'PASS 4: % inside its interval (age % d ≤ % d) · not stale (no chip)',
    r.table_name, r.age_days, r.expected_refresh_days;

  -- ── 5. The state vocabulary is closed and consistent with is_stale ───────
  IF EXISTS (SELECT 1 FROM public.reference_snapshot_freshness
              WHERE freshness_state NOT IN ('stale','within_interval','upstream_frozen','empty')
                 OR (freshness_state = 'stale') IS DISTINCT FROM is_stale) THEN
    RAISE EXCEPTION 'FAIL 5: a row has an unknown state or is_stale disagrees with freshness_state';
  END IF;
  SELECT * INTO r FROM public.reference_snapshot_freshness WHERE table_name = 'mines';
  IF r.freshness_state <> 'upstream_frozen' OR r.is_stale THEN
    RAISE EXCEPTION 'FAIL 5b: mines (MRDS, frozen upstream) reads % / is_stale %', r.freshness_state, r.is_stale;
  END IF;
  RAISE NOTICE 'PASS 5: states closed · is_stale = (state = stale) · mines upstream_frozen';

  -- ── 6. A filtered read touches one table (the app reads it per request) ──
  -- Not asserted here (EXPLAIN output cannot be captured in a DO block); run
  --   EXPLAIN SELECT * FROM public.reference_snapshot_freshness WHERE table_name = 'power_plants';
  -- by hand: seven branches must show "One-Time Filter: false".
END
$$;

ROLLBACK;

-- RESULT ROW (read-only). Reached only when every check above passed: a FAIL
-- aborts the script before this statement runs. Paste this row back.
SELECT 'PR-4 guards: PASS 1-5 (exists, 8 registries, power_plants stale, one inside its interval, states closed)' AS result,
       f.loaded_at::date          AS power_plants_loaded_on,
       f.age_days                 AS power_plants_age_days,
       f.expected_refresh_days    AS power_plants_interval_days,
       f.freshness_state          AS power_plants_state,
       (SELECT string_agg(w.table_name, ', ' ORDER BY w.table_name)
          FROM public.reference_snapshot_freshness w
         WHERE w.freshness_state = 'within_interval') AS inside_interval_no_chip
  FROM public.reference_snapshot_freshness f
 WHERE f.table_name = 'power_plants';
