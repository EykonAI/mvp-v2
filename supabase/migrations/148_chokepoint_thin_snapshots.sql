-- 148 · Thin chokepoint snapshots are not coverage.
--
-- ais_chokepoint_observations holds one row per strait per UTC day: distinct
-- MMSI seen in the box over the 24-hour window (mig 043). When the feed for
-- a box is intermittent, the snapshot still lands — with 2 vessels in the
-- Bosphorus against a median of 35, or 38 in Suez against 252. Those rows
-- are not traffic, they are partial coverage, and until now they entered
-- three things as if they were measurements: the weekly mean the house
-- chokepoint resolver judges, the 14-day baseline mean and stddev the
-- issuer forecasts from, and the "recent seven" it compares against.
--
-- Measured 2026-09-08 over 20 July → 8 September, ratio = vessel_count over
-- the trailing 14-day median for the same strait (baseline of at least five
-- rows): 10 rows fall under 0.35 —
--   bosphorus 07-24 (0.24) 07-25 (0.27) 07-26 (0.13) 07-31 (0.09) 08-01 (0.29) 08-30 (0.06) 09-08 (0.13)
--   suez      07-26 (0.13) 08-30 (0.15) 08-31 (0.21)
-- and none in Malacca. Two of those days (07-26, 08-30, both Sundays) are
-- thin in BOTH straits at once, which is what a coverage dip looks like and
-- what traffic does not. The next rows up (0.42–0.46) are plausible low
-- days and stay covered. The guard therefore marks a row THIN when it is
-- below 0.35 of the strait's trailing 14-day median with at least five
-- baseline rows; a row with no baseline cannot be judged and stays covered.
--
-- Nothing is deleted or rewritten: the rows stay on the record. The
-- resolver and the issuer read through chokepoint_covered_observations()
-- and use covered rows only — so a week with fewer than five covered days
-- is a coverage gap (#497), and a baseline is built from measurements.

-- STEP 1 — READ ONLY. Expect the ten rows above.
WITH w AS (
  SELECT a.chokepoint, a.period, a.vessel_count,
         (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY b.vessel_count)
            FROM public.ais_chokepoint_observations b
           WHERE b.chokepoint = a.chokepoint AND b.period < a.period AND b.period >= a.period - 14) AS med14,
         (SELECT count(*) FROM public.ais_chokepoint_observations b
           WHERE b.chokepoint = a.chokepoint AND b.period < a.period AND b.period >= a.period - 14) AS n14
    FROM public.ais_chokepoint_observations a WHERE a.period >= '2026-07-20')
SELECT chokepoint, period, vessel_count, round(med14::numeric, 1) AS med14, round((vessel_count / NULLIF(med14, 0))::numeric, 2) AS ratio
  FROM w WHERE n14 >= 5 AND vessel_count < 0.35 * med14 ORDER BY chokepoint, period;

-- STEP 2 — THE CHANGE.
BEGIN;

CREATE OR REPLACE FUNCTION public.chokepoint_covered_observations(
  p_slug          text,
  p_from          date,
  p_to            date,
  p_thin_ratio    numeric DEFAULT 0.35,
  p_baseline_days integer DEFAULT 14,
  p_min_baseline  integer DEFAULT 5
)
RETURNS TABLE (period date, vessel_count integer, covered boolean, baseline_median numeric, baseline_n integer, ratio numeric)
LANGUAGE sql
STABLE
AS $$
  SELECT a.period, a.vessel_count,
         NOT (b.n >= p_min_baseline AND a.vessel_count < p_thin_ratio * b.med)        AS covered,
         round(b.med::numeric, 1)                                                     AS baseline_median,
         b.n::integer                                                                 AS baseline_n,
         round((a.vessel_count / NULLIF(b.med, 0))::numeric, 2)                       AS ratio
    FROM public.ais_chokepoint_observations a
    CROSS JOIN LATERAL (
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY x.vessel_count) AS med, count(*) AS n
        FROM public.ais_chokepoint_observations x
       WHERE x.chokepoint = a.chokepoint AND x.period < a.period AND x.period >= a.period - p_baseline_days
    ) b
   WHERE a.chokepoint = p_slug AND a.period >= p_from AND a.period <= p_to
   ORDER BY a.period;
$$;

COMMENT ON FUNCTION public.chokepoint_covered_observations(text, date, date, numeric, integer, integer) IS
  'Daily chokepoint snapshots for a strait with a covered flag: THIN (not covered) when below p_thin_ratio of the trailing p_baseline_days median with at least p_min_baseline rows (mig 148). Read by the house chokepoint resolver and issuer; thin rows stay on the record.';

REVOKE EXECUTE ON FUNCTION public.chokepoint_covered_observations(text, date, date, numeric, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.chokepoint_covered_observations(text, date, date, numeric, integer, integer) TO service_role;

COMMIT;

-- STEP 3 — VERIFY. Bosphorus, the 08-17 week: four rows, 08-20 (2 vessels)
-- NOT covered, three covered. Suez the same week: 08-20 (3) not covered.
-- The 09-01 week in both straits: every row covered.
SELECT 'bosphorus' AS slug, * FROM public.chokepoint_covered_observations('bosphorus', '2026-08-16', '2026-08-23')
UNION ALL
SELECT 'suez', * FROM public.chokepoint_covered_observations('suez', '2026-08-16', '2026-08-23')
ORDER BY 1, 2;
SELECT count(*) AS rows_0901_week, count(*) FILTER (WHERE covered) AS covered
  FROM (SELECT * FROM public.chokepoint_covered_observations('bosphorus', '2026-08-31', '2026-09-06')
        UNION ALL SELECT * FROM public.chokepoint_covered_observations('suez', '2026-08-31', '2026-09-06')) q;
SELECT has_function_privilege('anon', 'public.chokepoint_covered_observations(text, date, date, numeric, integer, integer)', 'EXECUTE') AS anon_can_read;
