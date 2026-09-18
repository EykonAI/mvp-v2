-- ═══════════════════════════════════════════════════════════════════════════
-- eYKON.ai — 163 · Port-call coverage view, consumers that state their
--            denominator, and AIS-history retention decoupled from the
--            derivation. Reality Check programme PR-2 (part 2 of 2), build
--            prompt rev H §4.2 and §9. Requires 162 (apply 162 first).
-- ═══════════════════════════════════════════════════════════════════════════
--
-- PURPOSE
-- -------
-- 1 · port_call_coverage — one row per UTC day of the derivation span with a
--     load-bearing status vocabulary:
--       derived         the day was scanned (partial = true when the AIS layer
--                       delivered fewer than 24 live hours that day)
--       samples_absent  the AIS layer held no sample that day: VOID, never zero
--       failed          attempted and errored; derive_port_calls_due retries it
--       missing         never attempted: read as NO DATA, never as zero
--       pending         today (not over), or yesterday before the 00:17 UTC tick
--     A partially derived window must read as incomplete, never as quiet ports.
--
-- 2 · port_call_window_coverage(days) — the denominator every consumer states:
--     "coverage 15/21 days" over the last N COMPLETED UTC days (today is
--     pending and outside the window). complete = every day derived, none
--     partial.
--
-- 3 · oil_port_call_candidates(lookback, radius) — now reads v2 episodes only
--     (derived_by = 'v2_day'), and returns the coverage denominator on every
--     row. The return shape changes, so the function is dropped and recreated.
--     Same filter as mig 104 (a port within p_radius_m of a registry refinery),
--     evaluated once per port instead of once per call. EXECUTE is now
--     service_role only: its one caller is the derive-mineral-shipments cron,
--     and it reads service-only tables (anon already got zero rows through RLS).
--
-- 4 · prune_ais_position_history(retention, max_days, quarantine) on its own
--     pg_cron job ('prune-ais-history', hourly at :44, one UTC day per tick).
--     Until now the only prune ran AFTER the RPC that always timed out, so
--     nothing has ever been pruned (oldest row 2026-07-05). A day is deleted
--     only when ALL of these hold:
--       · port_call_derivation_runs records it 'derived' — never a day not yet
--         derived, never a failed or missing day;
--       · the NEXT day is recorded derived or samples_absent — its atoms' 6 h
--         look-back into this day's raw rows has been taken;
--       · it is older than the retention floor (never below 14 days — raises);
--       · its derivation ran more than p_quarantine_days ago (7 on the cron),
--         so the founder's day-by-day comparison of the backfill can still end
--         in a re-derivation.
--     The day is then marked raw_pruned_at, and derive_port_call_day refuses
--     to re-derive it (it would erase the atoms).
--
-- RETENTION RE-SIZE (founder decision, 18 Sep) — the reader audit
--   Every reader of ais_position_history, from `git grep` over the repo
--   (apps/web, services/) and pg_proc/pg_views in production, 2026-09-18:
--     · app/api/intel/shadow-fleet/track/route.ts          last 14 days, one vessel
--     · app/api/intel/shadow-fleet/evidence-pack/route.ts  last 14 days, fix count
--     · refresh_vessel_cadence()  (pg_cron, mig 122)       last 14 days
--     · derive_port_call_day()    (mig 162)                one UTC day ± 6 h, only
--                                                          until derived
--     · calibration_monitor_health() (mig 138)             max(recorded_at) only
--     · app/api/cron/sample-ais-history                    the writer
--   No view reads it; nothing in services/ reads it.
--   Longest real lookback = 14 days = the floor → retention 14 days.
--
-- PROJECTED SIZE AT 14 DAYS — stated, not chosen silently
--   Post-step days (08-25 → 09-17) hold 425k–526k rows, mean ~470k. With a
--   14-day floor the table holds 14 full days + today: ~6.6–7.1 M rows.
--   Measured all-in footprint today: 3,187,081,216 B / 11,777,457 rows =
--   270.6 B/row (heap 114, indexes 156, of which 62 is the duplicate index
--   in (b)). → ~1.8–1.9 GB of live data.
--   Against mig 078's budget (~2 GB / ~4.4 M rows): INSIDE the byte budget with
--   ~5 % margin, OVER the row figure by ~50–60 %. Proposed, for the founder to
--   decide — NOT done in this file:
--     (a) name the budget: ≤ 7.5 M rows / ≤ 2.0 GB total relation size;
--     (b) drop idx_ais_history_mmsi_time (mmsi, recorded_at DESC): 693 MB today,
--         a duplicate of the unique (mmsi, recorded_at) index, which a btree can
--         scan in either direction → ~1.4–1.5 GB at 14 days;
--     (c) or narrow the stored fleet (vessel_profiles, 45,579 rows; ~33k
--         vessels sampled a day) — a product decision.
--   On disk: DELETE frees space for reuse; the table file stops growing but
--   does not shrink below its high-water mark (~3.0 GB now, ~4 GB after the
--   7-day quarantine) without VACUUM FULL (exclusive lock — blocks the hourly
--   sampler while it runs) or pg_repack. Also a founder decision; not here.
--
-- APPLY: the whole file, in the Supabase SQL Editor, AFTER 162 and BEFORE
-- merging the PR. The final SELECT is the VERIFY block: paste its rows back.
-- Idempotent — safe to re-run. No temp tables, no session state.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1 · Coverage view ─────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.port_call_coverage
WITH (security_invoker = true) AS
WITH clock AS (
  SELECT (now() AT TIME ZONE 'UTC')::date AS today
),
span AS (
  SELECT gs::date AS day
    FROM clock k,
         generate_series(public.port_call_first_day()::timestamp, k.today::timestamp, interval '1 day') gs
)
SELECT s.day,
       CASE
         WHEN s.day >= k.today                        THEN 'pending'
         WHEN r.day IS NULL AND s.day = k.today - 1   THEN 'pending'
         WHEN r.day IS NULL                           THEN 'missing'
         ELSE r.status
       END                                                          AS status,
       COALESCE(r.status = 'derived' AND r.live_hours < 24, false)  AS partial,
       r.live_hours,
       r.samples_scanned,
       r.slow_samples,
       r.near_samples,
       r.atoms,
       r.vessel_days,
       r.ports_touched,
       r.duration_ms,
       r.error,
       r.ran_at,
       r.raw_pruned_at
  FROM span s
 CROSS JOIN clock k
  LEFT JOIN public.port_call_derivation_runs r ON r.day = s.day;

COMMENT ON VIEW public.port_call_coverage IS
  'One row per UTC day from port_call_first_day() to today (mig 163). status: derived | samples_absent (VOID, not zero) | failed | missing (never attempted: no data, not zero) | pending (today; or yesterday before the 00:17 UTC derivation). partial = derived with < 24 live AIS hours.';

REVOKE ALL ON public.port_call_coverage FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.port_call_coverage TO service_role;

-- ─── 2 · The denominator ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.port_call_window_coverage(p_days integer DEFAULT 21)
RETURNS TABLE (
  first_day            date,
  last_day             date,
  days_total           integer,
  days_derived         integer,
  days_partial         integer,
  days_samples_absent  integer,
  days_failed          integer,
  days_missing         integer,
  days_pending         integer,
  complete             boolean,
  label                text
)
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  IF p_days IS NULL OR p_days < 1 OR p_days > 366 THEN
    RAISE EXCEPTION 'port_call_window_coverage: p_days must be between 1 and 366 (got %)', p_days;
  END IF;

  RETURN QUERY
  WITH w AS (
    SELECT c.status AS st, c.partial AS pt
      FROM port_call_coverage c
     WHERE c.day >= v_today - p_days AND c.day < v_today
  ),
  agg AS (
    SELECT (count(*) FILTER (WHERE w.st = 'derived'))::integer               AS n_derived,
           (count(*) FILTER (WHERE w.st = 'derived' AND w.pt))::integer      AS n_partial,
           (count(*) FILTER (WHERE w.st = 'samples_absent'))::integer        AS n_absent,
           (count(*) FILTER (WHERE w.st = 'failed'))::integer                AS n_failed,
           (count(*) FILTER (WHERE w.st = 'missing'))::integer               AS n_missing,
           (count(*) FILTER (WHERE w.st = 'pending'))::integer               AS n_pending
      FROM w
  )
  SELECT v_today - p_days,
         v_today - 1,
         p_days,
         a.n_derived,
         a.n_partial,
         a.n_absent,
         a.n_failed,
         a.n_missing,
         a.n_pending,
         (a.n_derived = p_days AND a.n_partial = 0),
         format('coverage %s/%s days', a.n_derived, p_days)
           || CASE WHEN a.n_partial > 0 THEN format(' (%s partial)', a.n_partial) ELSE '' END
    FROM agg a;
END;
$$;

COMMENT ON FUNCTION public.port_call_window_coverage(integer) IS
  'Port-call coverage over the last N completed UTC days (today excluded): derived / partial / samples_absent / failed / missing / pending counts, complete = all N derived and none partial, and the label "coverage 15/21 days". Days before port_call_first_day() count against the denominator. Cheap: safe over the API (mig 163).';

REVOKE EXECUTE ON FUNCTION public.port_call_window_coverage(integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.port_call_window_coverage(integer) TO service_role;

-- ─── 3 · oil_port_call_candidates: v2 only, with its denominator ─────────
DROP FUNCTION IF EXISTS public.oil_port_call_candidates(integer, numeric);

CREATE FUNCTION public.oil_port_call_candidates(
  p_lookback_days integer DEFAULT 21,
  p_radius_m      numeric DEFAULT 5000
)
RETURNS TABLE (
  mmsi                   text,
  port_id                text,
  port_name              text,
  country_code           text,
  arrived_at             timestamptz,
  departed_at            timestamptz,
  coverage_days_derived  integer,
  coverage_days_total    integer,
  coverage_complete      boolean,
  coverage_label         text
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH cov AS (
    SELECT * FROM public.port_call_window_coverage(p_lookback_days)
  ),
  oil_ports AS (
    SELECT p.id, p.country_code
      FROM public.ports p
     WHERE EXISTS (SELECT 1 FROM public.refineries r
                    WHERE ST_DWithin(r.geom, p.geom, p_radius_m))
  )
  SELECT DISTINCT ON (pc.mmsi)
         pc.mmsi, pc.port_id, pc.port_name, op.country_code::text,
         pc.arrived_at, pc.departed_at,
         cov.days_derived, cov.days_total, cov.complete, cov.label
    FROM public.port_calls pc
    JOIN oil_ports op ON op.id = pc.port_id
   CROSS JOIN cov
   WHERE pc.derived_by = 'v2_day'
     AND pc.arrived_at > now() - make_interval(days => p_lookback_days)
   ORDER BY pc.mmsi, pc.arrived_at DESC;
$$;

COMMENT ON FUNCTION public.oil_port_call_candidates(integer, numeric) IS
  'Most recent v2 port call per vessel in the lookback at a port within p_radius_m of a registry refinery, with the port-call coverage denominator of the lookback on every row (mig 163; replaces mig 104). A zero-row result still has a denominator: call port_call_window_coverage(p_lookback_days).';

REVOKE EXECUTE ON FUNCTION public.oil_port_call_candidates(integer, numeric) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.oil_port_call_candidates(integer, numeric) TO service_role;

-- ─── 4 · Retention, decoupled and guarded ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.prune_ais_position_history(
  p_retention_days  integer DEFAULT 14,
  p_max_days        integer DEFAULT 1,
  p_quarantine_days integer DEFAULT 7
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_floor  date;
  v_day    date;
  v_n      integer;
  v_total  bigint := 0;
  v_out    jsonb := '[]'::jsonb;
BEGIN
  IF p_retention_days IS NULL OR p_retention_days < 14 THEN
    RAISE EXCEPTION 'prune_ais_position_history: retention % d is below the 14-day floor (the longest reader lookback: shadow-fleet track, evidence pack, refresh_vessel_cadence)', p_retention_days;
  END IF;
  IF p_max_days IS NULL OR p_max_days < 1 OR p_max_days > 3 THEN
    RAISE EXCEPTION 'prune_ais_position_history: p_max_days must be between 1 and 3 (got %)', p_max_days;
  END IF;
  IF p_quarantine_days IS NULL OR p_quarantine_days < 0 THEN
    RAISE EXCEPTION 'prune_ais_position_history: p_quarantine_days must be >= 0 (got %)', p_quarantine_days;
  END IF;

  -- Never concurrently with a derivation (same key as mig 162).
  IF NOT pg_try_advisory_xact_lock(hashtext('eykon.port_call_derivation')) THEN
    RETURN jsonb_build_object('skipped', 'a port-call derivation holds the lock');
  END IF;

  v_floor := (now() AT TIME ZONE 'UTC')::date - p_retention_days;

  FOR v_day IN
    SELECT r.day
      FROM port_call_derivation_runs r
     WHERE r.day < v_floor
       AND r.status = 'derived'                 -- GUARD: never a day not yet derived
       AND r.raw_pruned_at IS NULL
       AND r.ran_at < now() - make_interval(days => p_quarantine_days)
       AND EXISTS (SELECT 1 FROM port_call_derivation_runs nx
                    WHERE nx.day = r.day + 1
                      AND nx.status IN ('derived', 'samples_absent'))
     ORDER BY r.day
     LIMIT p_max_days
  LOOP
    DELETE FROM ais_position_history h
     WHERE h.recorded_at >= (v_day::timestamp AT TIME ZONE 'UTC')
       AND h.recorded_at <  ((v_day + 1)::timestamp AT TIME ZONE 'UTC');
    GET DIAGNOSTICS v_n = ROW_COUNT;

    UPDATE port_call_derivation_runs
       SET raw_pruned_at = now(), raw_rows_pruned = v_n
     WHERE day = v_day;

    v_total := v_total + v_n;
    v_out := v_out || jsonb_build_array(jsonb_build_object('day', v_day, 'rows', v_n));
  END LOOP;

  RETURN jsonb_build_object('floor', v_floor, 'retention_days', p_retention_days,
                            'quarantine_days', p_quarantine_days, 'pruned', v_out, 'rows', v_total);
END;
$$;

COMMENT ON FUNCTION public.prune_ais_position_history(integer, integer, integer) IS
  'Deletes ais_position_history one UTC day at a time, only for days recorded derived in port_call_derivation_runs whose next day is also recorded, older than the retention floor (>= 14 d, raises below) and derived more than p_quarantine_days ago; marks raw_pruned_at. pg_cron job prune-ais-history (mig 163). Never over the API.';

REVOKE EXECUTE ON FUNCTION public.prune_ais_position_history(integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.prune_ais_position_history(integer, integer, integer) TO service_role;

COMMENT ON TABLE public.ais_position_history IS
  'Hourly samples of the vessel_profiles fleet (mig 078). Retention 14 days (mig 163) — the longest reader lookback — enforced by pg_cron job prune-ais-history, which deletes a UTC day only after the port-call derivation has recorded it derived (and the next day), and at least 7 days after that derivation ran. Do not argue feed liveness from its floor (mig 131).';

-- ─── 5 · Schedule (unschedule-if-exists, then schedule) ──────────────────
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'prune-ais-history';
SELECT cron.schedule('prune-ais-history', '44 * * * *',
                     $job$ SELECT public.prune_ais_position_history(14, 1, 7) $job$);

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY — paste these rows back. Every row must read ok = true; the last
-- three rows are information (coverage today, the 21-day denominator, size).
-- ═══════════════════════════════════════════════════════════════════════════
WITH want_functions(sig) AS (
  VALUES ('public.port_call_window_coverage(integer)'),
         ('public.oil_port_call_candidates(integer,numeric)'),
         ('public.prune_ais_position_history(integer,integer,integer)')
)
SELECT 'view port_call_coverage (security_invoker)' AS "check",
       COALESCE((SELECT 'security_invoker=true' = ANY (c.reloptions)
                   FROM pg_class c WHERE c.oid = to_regclass('public.port_call_coverage')), false) AS ok,
       NULL::text AS detail
UNION ALL
SELECT 'view port_call_coverage not readable by anon',
       to_regclass('public.port_call_coverage') IS NOT NULL
       AND NOT has_table_privilege('anon', 'public.port_call_coverage', 'SELECT')
       AND has_table_privilege('service_role', 'public.port_call_coverage', 'SELECT'),
       NULL
UNION ALL
SELECT 'function ' || w.sig || ' (anon may not execute, service_role may)',
       to_regprocedure(w.sig) IS NOT NULL
       AND NOT has_function_privilege('anon', to_regprocedure(w.sig), 'EXECUTE')
       AND NOT has_function_privilege('authenticated', to_regprocedure(w.sig), 'EXECUTE')
       AND has_function_privilege('service_role', to_regprocedure(w.sig), 'EXECUTE'),
       pg_get_function_result(to_regprocedure(w.sig))
  FROM want_functions w
UNION ALL
SELECT 'oil_port_call_candidates returns the coverage denominator',
       COALESCE(pg_get_function_result(to_regprocedure('public.oil_port_call_candidates(integer,numeric)'))
                LIKE '%coverage_label text%', false),
       NULL
UNION ALL
SELECT 'cron job prune-ais-history', j.active AND j.schedule = '44 * * * *',
       j.schedule || ' · ' || j.command
  FROM cron.job j WHERE j.jobname = 'prune-ais-history'
UNION ALL
SELECT 'cron job prune-ais-history is unique',
       (SELECT count(*) FROM cron.job WHERE jobname = 'prune-ais-history') = 1, NULL
UNION ALL
SELECT 'coverage vocabulary is closed',
       NOT EXISTS (SELECT 1 FROM public.port_call_coverage
                    WHERE status NOT IN ('derived', 'samples_absent', 'failed', 'missing', 'pending')),
       NULL
UNION ALL
SELECT 'info · coverage now', true,
       (SELECT string_agg(status || ' ' || n, ' · ' ORDER BY status)
          FROM (SELECT status, count(*) AS n FROM public.port_call_coverage GROUP BY status) x)
UNION ALL
SELECT 'info · 21-day denominator', true,
       (SELECT label || ' · complete ' || complete FROM public.port_call_window_coverage(21))
UNION ALL
SELECT 'info · ais_position_history now', true,
       (SELECT pg_size_pretty(pg_total_relation_size('public.ais_position_history')) || ' · ~'
               || to_char(c.reltuples, 'FM999,999,999') || ' rows (estimate)'
          FROM pg_class c WHERE c.oid = 'public.ais_position_history'::regclass);
