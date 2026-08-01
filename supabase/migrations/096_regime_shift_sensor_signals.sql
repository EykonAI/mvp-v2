-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 096 · Sensor signals for the regime-shift detector
--
-- Phase 3a. compute-regime-shifts runs a 90d-vs-30d test per signal
-- per theatre and currently watches three: vessel_count, flight_count,
-- acled_events. All three are COUNTS of things arriving in a feed.
--
-- The night-lights signal deliberately is NOT a count. Counting our own
-- detector's events would be circular — the output depends on baselines
-- we chose. MEAN CLEAR-NIGHT RADIANCE is a raw physical measurement:
-- "this region got dimmer" is a regime shift in electrification,
-- independent of any threshold we set. Same reasoning keeps the thermal
-- signal on raw firms_thermal_anomalies rather than significance events.
--
-- ─── WHY AN RPC AND NOT A VIEW ────────────────────────────────────
-- blackmarble_facility_radiance carries no coordinates by design (091),
-- so a bbox query must join to the facility registry. The obvious
-- lat/lon BETWEEN filter cannot use an index and measured 695 ms per
-- window on prod — a seq scan over power_plants discarding 90,391 rows,
-- and the cron issues one per theatre per window.
--
-- Both registries already carry geography GiST indexes
-- (refineries_geog_idx, power_plants_geog_idx). Switching to
-- ST_Intersects against a geography envelope uses them, and aggregating
-- per-night IN the database returns ~30 rows instead of thousands:
--
--     lat/lon BETWEEN, rows to JS   695 ms
--     ST_Intersects + DB aggregate   77 ms      (9x, measured)
--
-- That is the #326 lesson applied before shipping rather than after a
-- production timeout.
--
-- ─── HONESTY ──────────────────────────────────────────────────────
-- confident_clear only, matching every other night-lights judgement:
-- cloud scatters city light back at the sensor and would show up here
-- as a spurious brightening. nights_observed is returned alongside the
-- mean so a caller can tell a real dim from a thin sample, and a night
-- with no clear observations simply has no row — absence of a look,
-- never darkness.
--
-- Additive, function only. Apply MANUALLY in the SQL Editor BEFORE merge.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION nightlights_bbox_nightly_radiance(
  p_lat_min double precision,
  p_lat_max double precision,
  p_lon_min double precision,
  p_lon_max double precision,
  p_from    date,
  p_to      date
) RETURNS TABLE (
  period          date,
  mean_radiance   numeric,
  facilities      int
) AS $$
  WITH env AS (
    SELECT ST_MakeEnvelope(p_lon_min, p_lat_min, p_lon_max, p_lat_max, 4326)::geography AS g
  ),
  fac AS (
    SELECT 'refinery'::text AS facility_type, r.id::text AS facility_id
      FROM refineries r, env
     WHERE r.geom IS NOT NULL AND ST_Intersects(r.geom, env.g)
    UNION ALL
    SELECT 'power_plant'::text, p.id::text
      FROM power_plants p, env
     WHERE p.geom IS NOT NULL AND ST_Intersects(p.geom, env.g)
  )
  SELECT b.period,
         AVG(b.radiance)::numeric      AS mean_radiance,
         COUNT(*)::int                 AS facilities
    FROM blackmarble_facility_radiance b
    JOIN fac ON fac.facility_type = b.facility_type
            AND fac.facility_id   = b.facility_id
   WHERE b.radiance IS NOT NULL
     -- THE GATE. Cloudy readings run ~100x brighter (cloud scatters
     -- city light back at the sensor) and would register here as a
     -- regional brightening that never happened.
     AND b.cloud_confidence = 'confident_clear'
     AND b.snow IS NOT TRUE
     AND b.period >= p_from
     AND b.period <= p_to
   GROUP BY b.period
   ORDER BY b.period;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION nightlights_bbox_nightly_radiance IS
  'Per-night MEAN clear-night radiance across FIRMS-watched facilities inside a bbox. Feeds the regime-shift detector. Raw physical measurement, not detector output — counting significance events would be circular. confident_clear only; a night with no clear observation has no row (absence of a look, never darkness). Uses the geography GiST indexes: 77 ms vs 695 ms for a lat/lon BETWEEN scan. See migration 096.';
