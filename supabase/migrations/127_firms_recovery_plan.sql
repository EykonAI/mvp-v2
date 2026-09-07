-- 127 · The FIRMS went_dark recovery family — the first claim family measured
--       BEFORE it was built, and the first with positive out-of-sample skill.
--
-- THE OBSERVABLE
--   "Site X, dark since <period>, will be re-detected by FIRMS within 3 days."
--   Self-resolving from our own ingest, no market and no counterparty.
--
-- WHY 3 DAYS AND NOT 7. Measured 2026-09-07 before any code was written:
--     horizon  3d   n=442   recovery 0.767   IN BAND
--     horizon  7d   n=375   recovery 0.912   outside
--     horizon 14d   n=273   recovery 0.982   outside
--   Almost everything that goes dark comes back within a week — most went_dark
--   is a short gap, not an outage. A 7-day claim would have scored a lovely
--   Brier and tested nothing, which is §17.2's formality exactly. Only the
--   3-day horizon is admissible, and it is marginal at 0.767.
--
-- WHY SITES AND NOT ROWS (§6.6). went_dark holds 906 unit rows over 460
--   site-events over 190 distinct sites — an inflation factor of 1.97. Issuing
--   per row would nearly double n with claims that are PERFECTLY CORRELATED,
--   because every unit at a plant samples the same pixel. That is not more
--   evidence, it is the same evidence counted twice with the uncertainty
--   understated. Claims are issued per SITE.
--
-- THE FORECAST DISCRIMINATES, and that is the point. Both available features
--   carry real signal in physically sensible directions:
--     dark_days      3 -> 0.821    4 -> 0.755    5+ -> 0.587
--     baseline_rate  .50-.63 0.592   .63-.75 0.781   .75-.88 0.867
--   The longer a site has been dark the less likely it recovers; the more
--   habitually it burns the likelier a gap is a blip.
--
--   Leave-one-out over 442 events, cell rates fitted EXCLUDING the row and
--   shrunk toward the global rate:
--     global-rate forecast    Brier 0.1795   skill -0.0045
--     dark_days x baseline    Brier 0.1688   skill +0.0557
--
--   That is the first positive out-of-sample skill in the register. Every
--   other family is negative: chokepoint -0.042, EIA -0.184, dark-contact
--   -0.199. Skill is DISCRIMINATION, and this is what having a feature that
--   actually varies with the outcome buys.
--
-- COVERAGE. firms_facility_observations exists iff we looked (mig 085). A
--   window with no rows resolves VOID, never "still dark". Absence of an
--   observation is not a result.

BEGIN;

CREATE OR REPLACE FUNCTION public.firms_recovery_plan(
  p_horizon_days integer DEFAULT 3,
  p_daily_cap    integer DEFAULT 100,
  p_shrink       numeric DEFAULT 8,
  p_band_lo      numeric DEFAULT 0.20,
  p_band_hi      numeric DEFAULT 0.80
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
WITH fac AS (
  SELECT facility_id,
         round(latitude::numeric, 4)::text || ':' || round(longitude::numeric, 4)::text AS site_key
  FROM firms_monitored_facilities
),
-- COMPLETED COHORTS ONLY: the window must have fully elapsed, or "has not had
-- time to recover" is scored as "did not recover" — the censoring bug that put
-- 0.979 on the dark-contact family's first tick and 0.000 on EIA's base rate.
settled AS (
  SELECT e.site_key, e.period,
         least(e.dark_days, 5)                        AS dd,
         width_bucket(e.baseline_rate, 0.5, 1.0, 3)   AS br,
         count(o.id)                                                    AS obs_rows,
         (count(*) FILTER (WHERE o.detection_count >= 1) > 0)::int       AS y
  FROM firms_significant_sites e
  LEFT JOIN fac f ON f.site_key = e.site_key
  LEFT JOIN firms_facility_observations o
         ON o.facility_id = f.facility_id
        AND o.period >  e.period
        AND o.period <= e.period + p_horizon_days
  WHERE e.event_type = 'went_dark'
    AND e.period + p_horizon_days <= (SELECT max(period) FROM firms_facility_observations)
  GROUP BY 1, 2, 3, 4
),
scored AS (SELECT * FROM settled WHERE obs_rows > 0),   -- uncovered rows would VOID; they inform nothing
glob AS (SELECT count(*) AS n, avg(y) AS rate FROM scored),
cells AS (
  SELECT dd, br, count(*) AS n, sum(y) AS k,
         (sum(y) + p_shrink * (SELECT rate FROM glob)) / (count(*) + p_shrink) AS rate
  FROM scored GROUP BY dd, br
),
issued_today AS (
  SELECT count(*) AS issued FROM predictions_register
  WHERE source = 'firms-recovery' AND issued_at >= date_trunc('day', now())
)
SELECT jsonb_build_object(
  'horizon_days', p_horizon_days,
  'family', jsonb_build_object(
    'n', (SELECT n FROM glob),
    'base_rate', round((SELECT rate FROM glob)::numeric, 4),
    -- The band gate, applied to the family as a whole exactly as mig 125 does
    -- per box. A family outside it is a formality and must not issue.
    'eligible', (SELECT rate FROM glob) BETWEEN p_band_lo AND p_band_hi
                AND (SELECT n FROM glob) >= 100,
    'band_lo', p_band_lo, 'band_hi', p_band_hi
  ),
  'daily_cap', p_daily_cap,
  'issued_today', (SELECT issued FROM issued_today),
  'remaining', greatest(0, p_daily_cap - (SELECT issued FROM issued_today)::int),
  'rule', 'v1 · site-level · 3d horizon · forecast = (dark_days x baseline_rate) cell rate shrunk toward family rate · <=' || p_daily_cap || '/day · VOID when uncovered',
  'cells', COALESCE((
     SELECT jsonb_object_agg(c.dd || ':' || c.br,
       jsonb_build_object('n', c.n, 'k', c.k, 'rate', round(c.rate::numeric, 4)))
     FROM cells c), '{}'::jsonb)
);
$function$;

COMMENT ON FUNCTION public.firms_recovery_plan(integer, integer, numeric, numeric, numeric) IS
  'Base rate, per-cell forecast and daily quota for the FIRMS went_dark recovery family (mig 127). Measured before it was built: 3d horizon 0.767 in band, 7d 0.912 and 14d 0.982 are formalities. LOO skill +0.0557 vs -0.0045 for a global-rate forecast.';

GRANT EXECUTE ON FUNCTION public.firms_recovery_plan(integer, integer, numeric, numeric, numeric) TO service_role;

COMMIT;

-- VERIFY:
--   SELECT jsonb_pretty(firms_recovery_plan());
--   -- family.base_rate ~0.767, family.eligible true, 9 cells, rates 0.59-0.87
