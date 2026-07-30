-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 092 · Night-lights significance (VIIRS Black Marble)
--
-- Turns nightly radiance (091) into the only thing worth a reader's
-- attention: DEPARTURE FROM A FACILITY'S OWN CLEAR-NIGHT BASELINE.
-- The sibling of 085 (FIRMS significance), deliberately built the same
-- way so one mental model covers both sensors.
--
--   went_dark_lights — a habitually-lit facility goes dark across
--                      several CONSECUTIVE CLEAR nights. THE OUTAGE
--                      SIGNAL, and the one that corroborates a FIRMS
--                      went_dark from independent physics.
--   surge           — a lit facility burns materially brighter than
--                      its own clear-night norm (flare-up, new load).
--   first_light     — a reliably-dark facility lights up.
--
-- ─── THE CLEAR-NIGHT GATE (measured, not assumed) ──────────────────
-- On the first production night, readings that survived on
-- confident_cloudy pixels averaged 3,010 nW·cm⁻²·sr⁻¹ against 29.6 on
-- confident_clear — two orders of magnitude, because cloud SCATTERS
-- city light back to the sensor. A cloudy night can therefore fake a
-- surge, and a cloud edge can fake a collapse. So every judgement
-- here — baseline AND event night — uses `confident_clear` rows only.
-- Non-null radiance is NOT sufficient. This is the single most
-- load-bearing predicate in the file.
--
-- ─── HONESTY INVARIANTS (mirror 085 — do not soften) ───────────────
-- • Radiance is not power state. A dark pixel is not a confirmed
--   outage: cloud, snow, moon geometry and the ~500 m footprint all
--   hide light. went_dark_lights therefore requires SUSTAINED absence
--   across multiple CLEAR nights and remains an inference.
-- • Absence of a row is absence of a LOOK, never a zero (091).
-- • Every event stores the baseline it departed from (n nights, mean,
--   stddev) so a reader can judge the claim instead of trusting it.
-- • A facility with too few clear nights is NOT judged. No baseline,
--   no claim — reported as ineligible rather than silently skipped.
--
-- Additive. RLS ON, service-role only. Apply MANUALLY in the Supabase
-- SQL Editor BEFORE merge (Railway auto-deploys main).
-- ═══════════════════════════════════════════════════════════════

-- ─── 1 · Significant events ────────────────────────────────────
CREATE TABLE IF NOT EXISTS nightlights_significant_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_type   text NOT NULL,
  facility_id     text NOT NULL,
  facility_name   text,
  country         text,
  period          date NOT NULL,
  event_type      text NOT NULL
    CHECK (event_type IN ('went_dark_lights', 'surge', 'first_light')),

  -- What was observed, and what it departed from. Both stored so the
  -- claim is auditable without re-deriving anything.
  observed_radiance   numeric,
  baseline_nights     int     NOT NULL,   -- CLEAR nights behind the baseline
  baseline_mean       numeric,
  baseline_stddev     numeric,
  -- Signed departure in standard deviations (negative = darker than
  -- norm). Null when the baseline had no spread to divide by.
  deviation_sigma     numeric,
  -- Consecutive clear nights at/below the dark threshold
  -- (went_dark_lights only).
  dark_nights         int,

  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (facility_type, facility_id, period, event_type)
);

CREATE INDEX IF NOT EXISTS idx_nl_sig_period
  ON nightlights_significant_events (period DESC);
CREATE INDEX IF NOT EXISTS idx_nl_sig_facility
  ON nightlights_significant_events (facility_type, facility_id, period DESC);

COMMENT ON TABLE nightlights_significant_events IS
  'Departures from a facility''s own CLEAR-NIGHT night-lights baseline. Judged on confident_clear rows only (cloud scatters light and would fake both surges and collapses). went_dark_lights is the outage signal that corroborates a FIRMS went_dark. See migration 092.';

-- ─── 2 · Detection RPC ─────────────────────────────────────────
-- p_day               the night to judge
-- p_baseline_nights   trailing window to build the baseline from
-- p_min_clear         minimum CLEAR nights required to judge at all
-- p_surge_sigma       sigma above baseline mean to call a surge
-- p_dark_frac         fraction of baseline mean at/below which a night
--                     counts as "dark" for this facility
-- p_dark_nights       consecutive clear dark nights before we call it
-- p_lit_floor         radiance above which a facility counts as "lit"
--                     (nW·cm⁻²·sr⁻¹; below this is noise, not light)
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
  -- Every usable CLEAR reading in the window. THE gate: cloudy rows
  -- never enter a baseline or a judgement (see header).
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
  -- The night under judgement.
  tonight AS (
    SELECT * FROM clear WHERE period = p_day
  ),
  -- Baseline from the facility's OWN prior clear nights.
  base AS (
    SELECT facility_type, facility_id,
           COUNT(*)                       AS n_clear,
           AVG(radiance)                  AS mean_rad,
           COALESCE(STDDEV_SAMP(radiance), 0) AS sd_rad,
           AVG((radiance >= p_lit_floor)::int)::numeric AS lit_rate
      FROM clear
     WHERE period < p_day
     GROUP BY 1, 2
    HAVING COUNT(*) >= p_min_clear
  ),
  -- Consecutive clear nights at/below this facility's dark threshold,
  -- counting back from p_day. Uses only CLEAR nights, so a run is
  -- never broken (or faked) by a cloudy gap.
  ranked AS (
    SELECT c.facility_type, c.facility_id, c.period, c.radiance,
           b.mean_rad,
           ROW_NUMBER() OVER (PARTITION BY c.facility_type, c.facility_id
                              ORDER BY c.period DESC) AS rn,
           (c.radiance <= b.mean_rad * p_dark_frac)   AS is_dark
      FROM clear c
      JOIN base b USING (facility_type, facility_id)
  ),
  -- A night is in the dark-run only if every clear night from p_day
  -- back to it was also dark.
  dark_run AS (
    SELECT facility_type, facility_id, COUNT(*) AS run_len
      FROM ranked r
     WHERE r.is_dark
       AND r.rn <= (
             SELECT COALESCE(MIN(r2.rn), 1000000000::bigint)
               FROM ranked r2
              WHERE r2.facility_type = r.facility_type
                AND r2.facility_id   = r.facility_id
                AND NOT r2.is_dark
           ) - 1
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
        -- The outage signal. Requires the facility to have been
        -- reliably lit (lit_rate) so a normally-dark site cannot
        -- trigger it, and a run length so one dim night cannot.
        WHEN j.lit_rate >= 0.8
             AND j.obs <= j.mean_rad * p_dark_frac
             AND j.dark_len >= p_dark_nights
          THEN 'went_dark_lights'
        -- Reliably dark, now clearly lit.
        WHEN j.lit_rate <= 0.1
             AND j.obs >= p_lit_floor
             AND j.obs > j.mean_rad
          THEN 'first_light'
        -- Materially brighter than its own clear-night norm. Guarded
        -- on an absolute floor too, so a facility whose baseline is
        -- near-zero noise cannot surge on a rounding artefact.
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

-- ─── 3 · Located events (coords for the convergence engine) ─────
-- Mirrors firms_significant_events_located (088): attaches facility
-- coordinates so the cron can emit a geolocated anomaly_flag.
CREATE OR REPLACE FUNCTION nightlights_significant_events_located(p_periods date[])
RETURNS TABLE (
  facility_type     text,
  facility_id       text,
  facility_name     text,
  country           text,
  period            date,
  event_type        text,
  observed_radiance numeric,
  baseline_nights   int,
  baseline_mean     numeric,
  deviation_sigma   numeric,
  dark_nights       int,
  latitude          double precision,
  longitude         double precision
) AS $$
  SELECT e.facility_type, e.facility_id, e.facility_name, e.country,
         e.period, e.event_type, e.observed_radiance, e.baseline_nights,
         e.baseline_mean, e.deviation_sigma, e.dark_nights,
         m.latitude, m.longitude
    FROM nightlights_significant_events e
    LEFT JOIN firms_monitored_facilities m
      ON m.facility_type = e.facility_type
     AND m.facility_id   = e.facility_id
   WHERE e.period = ANY (p_periods);
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ─── 4 · Eligibility probe ─────────────────────────────────────
-- How many facilities have enough CLEAR history to be judged at all.
-- This is what separates "we looked and nothing was significant" from
-- "we cannot yet form a baseline" — the distinction that keeps a zero
-- honest (the same reason 085's cron reports eligible_facilities).
CREATE OR REPLACE FUNCTION nightlights_eligible_facilities(
  p_day             date,
  p_baseline_nights int DEFAULT 30,
  p_min_clear       int DEFAULT 7
) RETURNS int AS $$
  SELECT COUNT(*)::int FROM (
    SELECT facility_type, facility_id
      FROM blackmarble_facility_radiance
     WHERE radiance IS NOT NULL
       AND cloud_confidence = 'confident_clear'
       AND snow IS NOT TRUE
       AND period <  p_day
       AND period >= p_day - p_baseline_nights
     GROUP BY 1, 2
    HAVING COUNT(*) >= p_min_clear
  ) s;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

ALTER TABLE nightlights_significant_events ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only, matching the rest of the
-- operational surface.
