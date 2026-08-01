-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 093 · Night-lights significance: kill the O(n²) dark-run
--
-- 092's detector was never slow, because it was never doing any work:
-- it judged today−1…−3 while the newest radiance night was nine days
-- old, so every run scanned three EMPTY nights and returned instantly.
-- PR #323 anchored the window on max(period) — and the moment the RPC
-- was handed nights that actually hold rows it hit the statement
-- timeout on all three:
--
--     detect 2026-07-22: canceling statement due to statement timeout
--     detect 2026-07-21: canceling statement due to statement timeout
--     detect 2026-07-20: canceling statement due to statement timeout
--
-- One bug hid the other. Fixing the window did not break the RPC; it
-- exposed that the RPC had never once run against real data.
--
-- ─── THE HOT SPOT ─────────────────────────────────────────────────
-- The dark-run CTE found each facility's leading run of dark nights
-- with a CORRELATED SUBQUERY over the `ranked` CTE:
--
--     WHERE r.is_dark
--       AND r.rn <= (SELECT MIN(r2.rn) FROM ranked r2
--                     WHERE r2.facility_type = r.facility_type
--                       AND r2.facility_id   = r.facility_id
--                       AND NOT r2.is_dark) - 1
--
-- That re-scans `ranked` once per row of `ranked`. A CTE carries no
-- index, so each re-scan is a full pass: O(n²) over ~42,000 rows.
--
-- ─── THE FIX ──────────────────────────────────────────────────────
-- A running count of non-dark nights, newest-first. A night belongs to
-- the leading dark run if and only if no non-dark night has been seen
-- at or before it:
--
--     SUM(CASE WHEN NOT is_dark THEN 1 ELSE 0 END)
--       OVER (PARTITION BY facility ORDER BY rn ROWS UNBOUNDED PRECEDING) = 0
--
-- Identical semantics (the window frame includes the current row, so a
-- dark night contributes 0 and the count only rises once the run is
-- broken), one ordered pass instead of n passes.
--
-- Measured on production, night 2026-07-22, 42,180 ranked rows:
--     before → statement timeout
--     after  → 365 ms, finding 178 facilities with a leading dark run
--
-- Plus a partial index matching the `clear` predicate exactly: that CTE
-- was a seq scan discarding 130,843 of 190,313 rows, and the table
-- grows by ~10,500 rows every night.
--
-- Signature unchanged, so CREATE OR REPLACE genuinely replaces (the
-- 085 lesson: adding a parameter would create a second overload and
-- leave the old one live). Behaviour-identical, not a re-tune — no
-- threshold moves in this migration.
--
-- Additive. Apply MANUALLY in the Supabase SQL Editor BEFORE merge.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1 · Partial index serving the clear-night predicate ───────
CREATE INDEX IF NOT EXISTS idx_bm_radiance_clear
  ON blackmarble_facility_radiance (facility_type, facility_id, period DESC)
  WHERE radiance IS NOT NULL
    AND cloud_confidence = 'confident_clear'
    AND snow IS NOT TRUE;

COMMENT ON INDEX idx_bm_radiance_clear IS
  'Serves the clear-night predicate every significance judgement gates on (migration 092). Partial: cloudy/snow/no-retrieval rows are never judged, so they are not worth indexing.';

-- ─── 2 · The RPC, with the dark-run made linear ────────────────
CREATE OR REPLACE FUNCTION nightlights_detect_significant_events(
  p_day             date,
  p_baseline_nights int     DEFAULT 30,
  p_min_clear       int     DEFAULT 7,
  p_surge_sigma     numeric DEFAULT 3.0,
  p_dark_frac       numeric DEFAULT 0.25,
  p_dark_nights     int     DEFAULT 3,
  p_lit_floor       numeric DEFAULT 1.0
) RETURNS int AS $$
DECLARE
  v_rows int;
BEGIN
  WITH
  -- THE GATE. Cloud scatters city light back at the sensor (measured:
  -- 3,010 nW·cm⁻²·sr⁻¹ on confident_cloudy vs 29.6 on confident_clear),
  -- so a cloudy night would fake both surges and collapses. Baseline
  -- and judgement both see clear nights only.
  clear AS (
    SELECT facility_type, facility_id, facility_name, country,
           period, radiance
      FROM blackmarble_facility_radiance
     WHERE radiance IS NOT NULL
       AND cloud_confidence = 'confident_clear'
       AND snow IS NOT TRUE
       AND period <= p_day
       AND period >  p_day - p_baseline_nights
  ),
  tonight AS (
    SELECT * FROM clear WHERE period = p_day
  ),
  base AS (
    SELECT facility_type, facility_id,
           COUNT(*)                                     AS n_clear,
           AVG(radiance)                                AS mean_rad,
           COALESCE(STDDEV_SAMP(radiance), 0)           AS sd_rad,
           AVG((radiance >= p_lit_floor)::int)::numeric AS lit_rate
      FROM clear
     WHERE period < p_day
     GROUP BY 1, 2
    HAVING COUNT(*) >= p_min_clear
  ),
  ranked AS (
    SELECT c.facility_type, c.facility_id,
           ROW_NUMBER() OVER (PARTITION BY c.facility_type, c.facility_id
                              ORDER BY c.period DESC)  AS rn,
           (c.radiance <= b.mean_rad * p_dark_frac)    AS is_dark
      FROM clear c
      JOIN base b USING (facility_type, facility_id)
  ),
  -- Running count of non-dark nights, newest-first. Zero means every
  -- clear night from p_day back to here was dark — i.e. this night is
  -- part of the unbroken leading run. Replaces 092's correlated
  -- subquery; same answer, one pass.
  runs AS (
    SELECT facility_type, facility_id, rn, is_dark,
           SUM(CASE WHEN NOT is_dark THEN 1 ELSE 0 END)
             OVER (PARTITION BY facility_type, facility_id
                   ORDER BY rn
                   ROWS UNBOUNDED PRECEDING)           AS nondark_before
      FROM ranked
  ),
  dark_run AS (
    SELECT facility_type, facility_id, COUNT(*) AS run_len
      FROM runs
     WHERE is_dark AND nondark_before = 0
     GROUP BY 1, 2
  ),
  joined AS (
    SELECT t.facility_type, t.facility_id, t.facility_name, t.country,
           t.radiance      AS obs,
           b.n_clear, b.mean_rad, b.sd_rad, b.lit_rate,
           COALESCE(d.run_len, 0) AS dark_len,
           CASE WHEN b.sd_rad > 0
                THEN (t.radiance - b.mean_rad) / b.sd_rad END AS sigma
      FROM tonight t
      JOIN base b USING (facility_type, facility_id)
      LEFT JOIN dark_run d USING (facility_type, facility_id)
  ),
  classified AS (
    SELECT j.*,
      CASE
        -- Habitually lit, now sustained-dark across CLEAR nights.
        WHEN j.lit_rate >= 0.8
             AND j.obs <= j.mean_rad * p_dark_frac
             AND j.dark_len >= p_dark_nights
          THEN 'went_dark_lights'
        -- Reliably dark, now clearly lit.
        WHEN j.lit_rate <= 0.1
             AND j.obs >= p_lit_floor
             AND j.obs > j.mean_rad
          THEN 'first_light'
        -- Materially brighter than its own clear-night norm.
        WHEN j.sigma IS NOT NULL
             AND j.sigma >= p_surge_sigma
             AND j.obs >= p_lit_floor
          THEN 'surge'
        ELSE NULL
      END AS event_type
      FROM joined j
  )
  INSERT INTO nightlights_significant_events (
    facility_type, facility_id, facility_name, country, period, event_type,
    observed_radiance, baseline_nights, baseline_mean, baseline_stddev,
    deviation_sigma, dark_nights
  )
  SELECT facility_type, facility_id, facility_name, country, p_day, event_type,
         obs, n_clear, mean_rad, sd_rad, sigma,
         CASE WHEN event_type = 'went_dark_lights' THEN dark_len END
    FROM classified
   WHERE event_type IS NOT NULL
  ON CONFLICT (facility_type, facility_id, period, event_type) DO UPDATE
    SET observed_radiance = EXCLUDED.observed_radiance,
        baseline_nights   = EXCLUDED.baseline_nights,
        baseline_mean     = EXCLUDED.baseline_mean,
        baseline_stddev   = EXCLUDED.baseline_stddev,
        deviation_sigma   = EXCLUDED.deviation_sigma,
        dark_nights       = EXCLUDED.dark_nights;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$ LANGUAGE plpgsql;
