-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 081 · NASA FIRMS thermal anomalies + facility observables
--
-- Adds the FIRMS (Fire Information for Resource Management System)
-- active-fire layer and the derived per-facility rollup that backs a
-- NEW prediction observable family:
--
--   firms:thermal:<facility_type>:<facility_id>:<YYYY-MM-DD>
--
-- Why this exists (Decision Brief 2026-07-18): the platform's entire
-- resolvable vocabulary was two observable families (ais:chokepoint,
-- eia:<series>). Founding Partners on conflict / energy-infrastructure
-- beats had NO observable that fits their beat, so they could not
-- reach a shown Reputation Note (10 resolved calls) inside 6 months.
-- FIRMS is objectively self-resolving and joins to infrastructure the
-- database already holds (refineries, power_plants).
--
-- HONESTY INVARIANT — a thermal anomaly is a DETECTION, not a strike.
-- Attribution is inference. Cloud cover and satellite overpass timing
-- mean absence of detection != absence of fire. Every claim built on
-- this layer must be phrased "will a thermal anomaly be DETECTED at X",
-- never "will X be hit" / "will X go offline". The resolver defers
-- (returns null) rather than scoring a window with thin coverage.
--
--   firms_thermal_anomalies    — raw NRT detections (VIIRS + MODIS)
--   firms_facility_observations— derived daily rollup per facility
--   firms_ingest_runs          — per-run coverage ledger, so the
--                                resolver can tell "no fire" apart
--                                from "no data" (the failure mode that
--                                would silently score a wrong answer).
--
-- Additive. RLS ON, NO permissive policy — service-role only via
-- createServerSupabase. Apply MANUALLY in the Supabase SQL Editor
-- BEFORE merge (Railway auto-deploys main).
-- ═══════════════════════════════════════════════════════════════

-- ─── 1 · Raw detections ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS firms_thermal_anomalies (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  satellite    text NOT NULL,             -- VIIRS_SNPP_NRT | VIIRS_NOAA20_NRT | MODIS_NRT
  acq_date     date NOT NULL,
  acq_time     text NOT NULL,             -- HHMM UTC as published by FIRMS
  latitude     double precision NOT NULL,
  longitude    double precision NOT NULL,
  brightness   numeric,                   -- K, band-4/I-4 brightness temperature
  bright_ti5   numeric,                   -- K, VIIRS I-5 (null for MODIS)
  frp          numeric,                   -- MW, fire radiative power
  confidence   text,                      -- VIIRS: l|n|h · MODIS: 0-100
  daynight     text,                      -- D | N
  scan         numeric,
  track        numeric,
  geom         geometry(Point, 4326),
  ingested_at  timestamptz NOT NULL DEFAULT now(),
  -- FIRMS re-publishes the same detection across overlapping windows;
  -- this key makes re-ingest idempotent.
  UNIQUE (satellite, acq_date, acq_time, latitude, longitude)
);

CREATE INDEX IF NOT EXISTS firms_anom_date_idx  ON firms_thermal_anomalies (acq_date DESC);
CREATE INDEX IF NOT EXISTS firms_anom_geom_idx  ON firms_thermal_anomalies USING GIST (geom);

-- Populate geom from lat/lon on write (mirrors the existing
-- geospatial tables' auto-geom trigger convention).
CREATE OR REPLACE FUNCTION firms_set_geom() RETURNS trigger AS $$
BEGIN
  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    NEW.geom := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS firms_set_geom_trg ON firms_thermal_anomalies;
CREATE TRIGGER firms_set_geom_trg
  BEFORE INSERT OR UPDATE ON firms_thermal_anomalies
  FOR EACH ROW EXECUTE FUNCTION firms_set_geom();

-- ─── 2 · Derived per-facility daily rollup ─────────────────────
-- One row per (facility_type, facility_id, period) — the table the
-- resolver reads. detection_count = 0 rows ARE written for monitored
-- facilities on covered days, so "observed nothing" is a fact on
-- record rather than an absent row indistinguishable from a cron miss.
CREATE TABLE IF NOT EXISTS firms_facility_observations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_type   text NOT NULL,          -- refinery | power_plant
  facility_id     text NOT NULL,
  facility_name   text,
  country         text,
  period          date NOT NULL,
  detection_count int  NOT NULL DEFAULT 0,
  max_frp         numeric,
  nearest_km      numeric,
  radius_km       numeric NOT NULL,
  computed_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (facility_type, facility_id, period)
);

CREATE INDEX IF NOT EXISTS firms_facobs_lookup_idx
  ON firms_facility_observations (facility_type, facility_id, period DESC);
CREATE INDEX IF NOT EXISTS firms_facobs_period_idx
  ON firms_facility_observations (period DESC);

-- ─── 3 · Ingest coverage ledger ────────────────────────────────
-- Without this the resolver cannot distinguish "no thermal anomaly
-- occurred" from "the ingest never ran" — the exact "code shipped,
-- data never arrived" failure mode. A day is only resolvable if it
-- has a successful run covering it.
CREATE TABLE IF NOT EXISTS firms_ingest_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  region        text NOT NULL,
  satellite     text NOT NULL,
  day_covered   date NOT NULL,
  rows_fetched  int  NOT NULL DEFAULT 0,
  rows_upserted int  NOT NULL DEFAULT 0,
  ok            boolean NOT NULL DEFAULT true,
  error         text,
  ran_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (region, satellite, day_covered)
);

CREATE INDEX IF NOT EXISTS firms_runs_day_idx ON firms_ingest_runs (day_covered DESC);

-- ─── 4 · Facility rollup RPC ───────────────────────────────────
-- Runs the spatial join in PostGIS rather than pulling detections
-- into the app. Writes a row for EVERY monitored facility on the
-- given day — including detection_count = 0 — so a covered day with
-- no fire is recorded as an observation, not as a missing row.
--
-- Monitored set = refineries with a known capacity (the facilities an
-- analyst would actually make a call about) plus power plants above
-- the capacity floor. Both are already populated in this database.
CREATE OR REPLACE FUNCTION firms_derive_facility_observations(
  p_day       date,
  p_radius_km numeric DEFAULT 5,
  p_min_mw    numeric DEFAULT 500
) RETURNS int AS $$
DECLARE
  v_rows int;
BEGIN
  WITH monitored AS (
    SELECT 'refinery'::text AS facility_type,
           r.id::text       AS facility_id,
           r.refinery_name  AS facility_name,
           r.country,
           r.geom
      FROM refineries r
     WHERE r.geom IS NOT NULL
       AND r.capacity_bpd IS NOT NULL
    UNION ALL
    SELECT 'power_plant'::text,
           p.id::text,
           p.plant_name,
           p.country,
           p.geom
      FROM power_plants p
     WHERE p.geom IS NOT NULL
       AND p.capacity_mw >= p_min_mw
  ),
  hits AS (
    SELECT m.facility_type,
           m.facility_id,
           m.facility_name,
           m.country,
           COUNT(f.id)                                        AS detection_count,
           MAX(f.frp)                                         AS max_frp,
           MIN(ST_Distance(m.geom::geography, f.geom::geography)) / 1000.0 AS nearest_km
      FROM monitored m
      LEFT JOIN firms_thermal_anomalies f
        ON f.acq_date = p_day
       AND f.geom IS NOT NULL
       AND ST_DWithin(m.geom::geography, f.geom::geography, p_radius_km * 1000)
     GROUP BY 1, 2, 3, 4
  )
  INSERT INTO firms_facility_observations (
    facility_type, facility_id, facility_name, country,
    period, detection_count, max_frp, nearest_km, radius_km, computed_at
  )
  SELECT facility_type, facility_id, facility_name, country,
         p_day, detection_count, max_frp, nearest_km, p_radius_km, now()
    FROM hits
  ON CONFLICT (facility_type, facility_id, period) DO UPDATE
    SET detection_count = EXCLUDED.detection_count,
        max_frp         = EXCLUDED.max_frp,
        nearest_km      = EXCLUDED.nearest_km,
        radius_km       = EXCLUDED.radius_km,
        computed_at     = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$ LANGUAGE plpgsql;

-- ─── 5 · RLS — service-role only, no permissive policy ─────────
ALTER TABLE firms_thermal_anomalies     ENABLE ROW LEVEL SECURITY;
ALTER TABLE firms_facility_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE firms_ingest_runs           ENABLE ROW LEVEL SECURITY;
