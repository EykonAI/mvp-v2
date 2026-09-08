-- 142 · blackmarble_claim_plan(): computed by pg_cron, read from a table.
--
-- The plan (mig 128) rebuilds the two night-lights base rates on every call:
-- a GROUP BY over the whole radiance table joined to the facilities view,
-- then every settled event joined to its horizon window. Measured 2026-09-08:
-- 4.6 s alone at 15:12 UTC, 6.5 s at 15:30 — under PostgREST's 8 s statement
-- timeout with no margin, and over it whenever anything else is running:
-- the admin monitor's 15:11 UTC render got "canceling statement due to
-- statement timeout" and showed both families as NO PLAN. The public ledger
-- route (#485) and the night-lights issuer (detect-nightlights-significance)
-- call the same function; an issuer tick that times out issues nothing and
-- says so only in its own response.
--
-- Same cure as mig 134: the heavy SQL runs under pg_cron's 120 s budget and
-- writes a row; readers read the row. The plan changes only when nights are
-- ingested (worker ~09:45 UTC) or judged (10:05 UTC), so one refresh at :12
-- every hour is more than enough and costs ~6 s of DB time per hour.
--
-- What stays LIVE in the reader, because it must: issued_today / remaining
-- (the issuer's quota for the current UTC day) and data_clock. What is
-- cached: n, base_rate, eligible, reason, cells — the measured record.
-- The reader keeps the signature and the output shape; every caller is
-- unchanged. Three keys are added: computed_at, cache ('hit' | 'miss'),
-- stale (cache older than 26 h). A row exists iff a refresh ran: on a cache
-- miss the reader computes live and says cache = 'miss' rather than fail.

-- ─────────────────────────────────────────────────────────────────────
-- STEP 1 — READ ONLY. Expect ~5–7 s for the call and cache_table_present 0.
-- ─────────────────────────────────────────────────────────────────────
SELECT clock_timestamp() AS t0,
       (public.blackmarble_claim_plan())->'families'->'first_light'->>'n' AS first_light_n,
       clock_timestamp() AS t1,
       (SELECT count(*) FROM information_schema.tables WHERE table_name = 'blackmarble_claim_plan_cache') AS cache_table_present;

-- ─────────────────────────────────────────────────────────────────────
-- STEP 2 — THE CHANGE (≈ 7 s: the first refresh runs at the end).
-- ─────────────────────────────────────────────────────────────────────
BEGIN;

-- 1 · the computation, verbatim from mig 128, under a new name
CREATE OR REPLACE FUNCTION public.blackmarble_claim_plan_compute(
  p_horizon_days integer DEFAULT 7,
  p_daily_cap    integer DEFAULT 100,
  p_shrink       numeric DEFAULT 8,
  p_min_n        integer DEFAULT 80,
  p_band_lo      numeric DEFAULT 0.20,
  p_band_hi      numeric DEFAULT 0.80
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
WITH fac AS (
  SELECT b.facility_id,
         round(f.latitude::numeric,4)::text || ':' || round(f.longitude::numeric,4)::text AS site_key
  FROM blackmarble_facility_radiance b
  JOIN firms_monitored_facilities f USING (facility_id)
  GROUP BY 1,2
),
-- The data clock, never the wall clock: this sensor runs ~13 days behind.
clk AS (SELECT max(period) AS newest FROM blackmarble_facility_radiance),
settled AS (
  SELECT e.event_type, e.site_key, e.period,
         e.observed_radiance, e.baseline_mean, e.deviation_sigma, e.dark_nights,
         count(*) FILTER (WHERE r.cloud_confidence = 'confident_clear')            AS clear_nights,
         max(r.radiance_3x3) FILTER (WHERE r.cloud_confidence = 'confident_clear') AS max_clear
  FROM nightlights_significant_sites e
  LEFT JOIN fac f ON f.site_key = e.site_key
  LEFT JOIN blackmarble_facility_radiance r
         ON r.facility_id = f.facility_id
        AND r.period >  e.period
        AND r.period <= e.period + p_horizon_days
  WHERE e.event_type IN ('first_light', 'went_dark_lights')
    AND e.period + p_horizon_days <= (SELECT newest FROM clk)
  GROUP BY 1,2,3,4,5,6,7
),
scored AS (
  SELECT event_type, site_key,
         CASE WHEN event_type = 'first_light'
              THEN (max_clear >= 0.5 * observed_radiance)::int
              ELSE (max_clear >= 0.5 * baseline_mean)::int END AS y,
         -- FIXED cut points, not quantiles: an issuer cannot know future
         -- quantiles, so a quantile-defined cell would mean something
         -- different every week.
         CASE WHEN deviation_sigma < 2.3 THEN 1 WHEN deviation_sigma < 3.4 THEN 2 ELSE 3 END AS sig_b,
         CASE WHEN observed_radiance < 1.5 THEN 1 ELSE 2 END                                 AS rad_b,
         least(coalesce(dark_nights, 0), 4)                                                  AS dn_b
  FROM settled
  WHERE clear_nights > 0          -- uncovered windows VOID; they inform nothing
),
glob AS (SELECT event_type, count(*) AS n, avg(y) AS rate FROM scored GROUP BY event_type),
cells AS (
  SELECT s.event_type,
         CASE WHEN s.event_type = 'first_light'
              THEN s.sig_b || ':' || s.rad_b
              ELSE s.dn_b::text END AS cell,
         count(*) AS n, sum(s.y) AS k,
         (sum(s.y) + p_shrink * g.rate) / (count(*) + p_shrink) AS rate
  FROM scored s JOIN glob g USING (event_type)
  GROUP BY 1,2,g.rate
),
issued_today AS (
  SELECT context->>'nl_event_type' AS event_type, count(*) AS issued
  FROM predictions_register
  WHERE source = 'blackmarble' AND issued_at >= date_trunc('day', now())
  GROUP BY 1
)
SELECT jsonb_build_object(
  'horizon_days', p_horizon_days,
  'data_clock',   (SELECT newest FROM clk),
  'daily_cap',    p_daily_cap,
  'rule', 'v1 · site-level · ' || p_horizon_days || 'd horizon on the DATA clock · confident_clear nights only · VOID when uncovered · forecast = cell rate shrunk toward family rate · <=' || p_daily_cap || '/day per family',
  'families', COALESCE((
    SELECT jsonb_object_agg(g.event_type, jsonb_build_object(
      'n', g.n,
      'base_rate', round(g.rate::numeric, 4),
      'eligible', g.rate BETWEEN p_band_lo AND p_band_hi AND g.n >= p_min_n,
      'reason', CASE WHEN g.n < p_min_n THEN 'thin: n < ' || p_min_n
                     WHEN g.rate < p_band_lo OR g.rate > p_band_hi THEN 'outside informative band'
                     END,
      'issued_today', COALESCE(i.issued, 0),
      'remaining', greatest(0, p_daily_cap - COALESCE(i.issued, 0)::int),
      'cells', COALESCE((
        SELECT jsonb_object_agg(c.cell, jsonb_build_object('n', c.n, 'rate', round(c.rate::numeric, 4)))
        FROM cells c WHERE c.event_type = g.event_type), '{}'::jsonb)
    ))
    FROM glob g LEFT JOIN issued_today i ON i.event_type = g.event_type), '{}'::jsonb)
);
$function$;

-- 2 · the row
CREATE TABLE IF NOT EXISTS public.blackmarble_claim_plan_cache (
  params_key  text PRIMARY KEY,          -- 'horizon:cap:shrink:min_n:lo:hi'
  plan        jsonb NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  duration_ms integer
);
ALTER TABLE public.blackmarble_claim_plan_cache ENABLE ROW LEVEL SECURITY;

-- 3 · the refresh (pg_cron, or by hand)
CREATE OR REPLACE FUNCTION public.blackmarble_claim_plan_refresh(
  p_horizon_days integer DEFAULT 7,
  p_daily_cap    integer DEFAULT 100,
  p_shrink       numeric DEFAULT 8,
  p_min_n        integer DEFAULT 80,
  p_band_lo      numeric DEFAULT 0.20,
  p_band_hi      numeric DEFAULT 0.80
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_key  text := format('%s:%s:%s:%s:%s:%s', p_horizon_days, p_daily_cap, p_shrink, p_min_n, p_band_lo, p_band_hi);
  v_t0   timestamptz := clock_timestamp();
  v_plan jsonb;
  v_ms   integer;
BEGIN
  v_plan := public.blackmarble_claim_plan_compute(p_horizon_days, p_daily_cap, p_shrink, p_min_n, p_band_lo, p_band_hi);
  v_ms   := (extract(epoch from clock_timestamp() - v_t0) * 1000)::int;
  INSERT INTO public.blackmarble_claim_plan_cache (params_key, plan, computed_at, duration_ms)
  VALUES (v_key, v_plan, clock_timestamp(), v_ms)
  ON CONFLICT (params_key) DO UPDATE
    SET plan = EXCLUDED.plan, computed_at = EXCLUDED.computed_at, duration_ms = EXCLUDED.duration_ms;
  RETURN jsonb_build_object('params_key', v_key, 'computed_at', clock_timestamp(), 'duration_ms', v_ms,
                            'families', (SELECT jsonb_object_agg(f.k, f.v->'n') FROM jsonb_each(v_plan->'families') AS f(k, v)));
END;
$$;

-- 4 · the reader: same signature and shape as before; live quota and clock
--     overlaid on the cached record; computes live on a cache miss.
CREATE OR REPLACE FUNCTION public.blackmarble_claim_plan(
  p_horizon_days integer DEFAULT 7,
  p_daily_cap    integer DEFAULT 100,
  p_shrink       numeric DEFAULT 8,
  p_min_n        integer DEFAULT 80,
  p_band_lo      numeric DEFAULT 0.20,
  p_band_hi      numeric DEFAULT 0.80
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_key    text := format('%s:%s:%s:%s:%s:%s', p_horizon_days, p_daily_cap, p_shrink, p_min_n, p_band_lo, p_band_hi);
  v_row    record;
  v_issued jsonb;
  v_fams   jsonb;
  v_clock  date;
BEGIN
  SELECT plan, computed_at, duration_ms INTO v_row
    FROM public.blackmarble_claim_plan_cache WHERE params_key = v_key;
  IF NOT FOUND THEN
    RETURN public.blackmarble_claim_plan_compute(p_horizon_days, p_daily_cap, p_shrink, p_min_n, p_band_lo, p_band_hi)
        || jsonb_build_object('computed_at', NULL, 'cache', 'miss', 'stale', true, 'compute_ms', NULL);
  END IF;
  SELECT max(period) INTO v_clock FROM public.blackmarble_facility_radiance;
  SELECT COALESCE(jsonb_object_agg(x.event_type, x.issued), '{}'::jsonb) INTO v_issued
    FROM (SELECT r.context->>'nl_event_type' AS event_type, count(*) AS issued
            FROM public.predictions_register r
           WHERE r.source = 'blackmarble' AND r.issued_at >= date_trunc('day', now())
           GROUP BY 1) x;
  SELECT jsonb_object_agg(f.k, f.v || jsonb_build_object(
           'issued_today', COALESCE((v_issued->>f.k)::int, 0),
           'remaining',    greatest(0, p_daily_cap - COALESCE((v_issued->>f.k)::int, 0))))
    INTO v_fams
    FROM jsonb_each(v_row.plan->'families') AS f(k, v);
  RETURN v_row.plan || jsonb_build_object(
    'families',      COALESCE(v_fams, '{}'::jsonb),
    'data_clock',    v_clock,
    'computed_on',   v_row.plan->'data_clock',
    'computed_at',   v_row.computed_at,
    'compute_ms',    v_row.duration_ms,
    'cache',         'hit',
    'cache_age_s',   round(extract(epoch from now() - v_row.computed_at)),
    'stale',         now() - v_row.computed_at > interval '26 hours');
END;
$$;

-- 5 · the quota query the reader (and migs 125/127) run on every call
CREATE INDEX IF NOT EXISTS idx_predictions_source_issued ON public.predictions_register (source, issued_at DESC);

-- 6 · the job: hourly at :12 — after the 10:05 detection and before the
--     ~10:24 issuer tick on the day that matters
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'refresh-blackmarble-plan';
SELECT cron.schedule('refresh-blackmarble-plan', '12 * * * *', $job$ SELECT public.blackmarble_claim_plan_refresh() $job$);

-- 7 · grants (mig 139's rule): the computation and the refresh are not for
--     the anon key; the reader keeps the grants it had (CREATE OR REPLACE
--     preserves them).
REVOKE EXECUTE ON FUNCTION public.blackmarble_claim_plan_compute(integer, integer, numeric, integer, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.blackmarble_claim_plan_refresh(integer, integer, numeric, integer, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.blackmarble_claim_plan_compute(integer, integer, numeric, integer, numeric, numeric) TO service_role;
GRANT  EXECUTE ON FUNCTION public.blackmarble_claim_plan_refresh(integer, integer, numeric, integer, numeric, numeric) TO service_role;

COMMENT ON FUNCTION public.blackmarble_claim_plan(integer, integer, numeric, integer, numeric, numeric) IS
  'Reader (mig 142): cached base rates/cells from blackmarble_claim_plan_cache (refreshed hourly at :12 by pg_cron) with issued_today/remaining and data_clock live. Adds computed_at, cache, stale. Computes live on a cache miss.';

COMMIT;

-- The first fill — applying this migration IS the first refresh.
SELECT public.blackmarble_claim_plan_refresh();

-- ─────────────────────────────────────────────────────────────────────
-- STEP 3 — VERIFY. Expect the reader in well under 100 ms with cache = 'hit',
-- families n unchanged from STEP 1, computed_at just now, job present,
-- anon_can_refresh false.
-- ─────────────────────────────────────────────────────────────────────
SELECT clock_timestamp() AS t0,
       (SELECT jsonb_build_object('cache', p->'cache', 'computed_at', p->'computed_at', 'compute_ms', p->'compute_ms',
                                  'first_light_n', p->'families'->'first_light'->'n',
                                  'first_light_issued_today', p->'families'->'first_light'->'issued_today',
                                  'went_dark_n', p->'families'->'went_dark_lights'->'n', 'stale', p->'stale')
          FROM public.blackmarble_claim_plan() AS p) AS reader,
       clock_timestamp() AS t1,
       (SELECT count(*) FROM cron.job WHERE jobname = 'refresh-blackmarble-plan' AND active) AS job_present,
       has_function_privilege('anon', 'public.blackmarble_claim_plan_refresh(integer, integer, numeric, integer, numeric, numeric)', 'EXECUTE') AS anon_can_refresh;
