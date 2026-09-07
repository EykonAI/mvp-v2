-- 128 · The two Black Marble claim families — measured first, both admitted.
--
-- P1.4. §6.3 built night-lights as a physically INDEPENDENT sensor from FIRMS
-- (light, not heat) and it had never issued a claim either.
--
-- TWO CONSTRAINTS THIS SENSOR HAS AND FIRMS DOES NOT:
--   * ~13-day publication lag, measured 2026-09-07 (newest period 2026-08-25,
--     against a documented ~9). Every window must anchor on max(period) in the
--     radiance table, NEVER on the wall clock.
--   * Only 43.0% of readings are confident_clear. Cloud scatters city light
--     back at the sensor — cloudy pixels averaged 3,010 nW against 29.6 on
--     clear ones (§6.3) — so a cloudy night is not evidence of anything. Only
--     confident_clear rows count, and a window with none resolves VOID.
--
-- FAMILY A · first_light PERSISTENCE
--   "<site>, first lit on <period>, will still be emitting in 7 days."
--     horizon  7d  n=372  still-lit 0.6307  IN BAND
--     horizon 14d  n=274  still-lit 0.6715  IN BAND
--     horizon 21d  n=165  still-lit 0.8061  outside
--   7 days is both the best-centred and the largest cohort.
--
--   IT DISCRIMINATES HARD, and the direction is worth stating: a BIGGER first
--   light is LESS likely to persist.
--     deviation_sigma  0.1-2.2 -> 0.798   2.3-3.4 -> 0.742   3.4+ -> 0.350
--     observed_radiance  <1.5 -> ~0.72     >=1.5 -> 0.344
--   A large spike is a transient — a flare, a fire, a one-off. A modest
--   sustained brightening is a real commissioning. Leave-one-out over 372
--   settled events:
--     global rate        skill -0.0054
--     sigma only         skill +0.1540
--     sigma x radiance   skill +0.1630
--
-- FAMILY B · went_dark_lights RECOVERY
--   "<site>, dark since <period>, will emit again within 7 days."
--     n=94  base 0.7128  void 4.1%
--     dark_nights 3 -> 0.863   4+ -> 0.535   (a 33-point spread on one feature)
--     LOO: global -0.0216 -> dark_nights +0.0910
--
-- Both beat the FIRMS family (+0.0557) and everything else in the register is
-- negative. Skill is discrimination, and these sensors have features that vary.
--
-- ON THE MIN-N GATE. This uses 80 where mig 127 used 100. The gate exists to
-- stop a family issuing against an UNMEASURED base rate; it is not a magic
-- number. 94 settled events with a stable positive held-out estimate is
-- measured. 127 used 100 only because it had 442 and the choice never bound.
--
-- THE RESOLUTION THRESHOLD IS STORED ON THE CLAIM, not recomputed at
-- resolution. A claim whose pass mark can move after issue is not a claim.

BEGIN;

CREATE OR REPLACE FUNCTION public.blackmarble_claim_plan(
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

COMMENT ON FUNCTION public.blackmarble_claim_plan(integer, integer, numeric, integer, numeric, numeric) IS
  'Base rates, per-cell forecasts and quotas for the two Black Marble families (mig 128). Measured first: first_light persistence LOO skill +0.163, went_dark_lights recovery +0.091. confident_clear only; windows anchored on the data clock, which runs ~13 days behind.';

GRANT EXECUTE ON FUNCTION public.blackmarble_claim_plan(integer, integer, numeric, integer, numeric, numeric) TO service_role;

COMMIT;

-- VERIFY:
--   SELECT jsonb_pretty(blackmarble_claim_plan());
--   -- first_light n~372 base ~0.63 eligible true, 6 cells
--   -- went_dark_lights n~94 base ~0.71 eligible true, 2 cells
