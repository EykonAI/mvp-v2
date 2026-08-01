-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 094 · Site-level night-lights events (stop over-counting)
--
-- The first real detection run produced 43 went_dark_lights rows. That
-- reads as 43 facilities going dark. It was TEN.
--
-- The facility registry stores one row per GENERATING UNIT: Az Zour
-- South power plant is five rows, Az Zour North four, all sharing
-- byte-identical coordinates (measured spread: 0.00 km). Black Marble
-- samples a ~500 m pixel, so every unit at a plant returns THE SAME
-- RADIANCE NUMBER. Five rows, one observation, one physical event.
--
-- This is not a night-lights bug — firms_significant_events has the
-- same shape (1,266 rows across 547 distinct names). It is a property
-- of the registry, and it inflates any user-facing count ~4x.
--
-- ─── WHY EXACT COORDINATES, NOT PROXIMITY ─────────────────────────
-- Tempting to cluster "nearby" facilities. Measured, that is wrong:
--   Az Zour South  28.7055, 48.3701
--   Az Zour North  28.7135, 48.3806   ← ~1.2 km away, a DIFFERENT plant
-- Rounding to ~1 km would merge two genuinely distinct stations that
-- darkened independently. Meanwhile the true duplicates are not merely
-- near each other, they are at the SAME POINT. So the key is exact
-- coordinates (4 dp ≈ 11 m): it cannot over-merge distinct plants, and
-- it collapses every duplicate that exists.
--
-- Verified on the 360-row first run:
--   360 event rows → 327 facility ids → 217 site-nights → 200 sites
-- Five site keys merge differently-NAMED facilities. Each was checked
-- and each is correct: Talatan solar 1/3/5 (phases of one complex),
-- He Er North/South floating wind (one project), and three co-located
-- wind+solar hybrids. Same pixel, same reading, one observation.
--
-- ─── WHAT THIS DOES NOT DO ────────────────────────────────────────
-- The per-unit rows stay. They are honest — each unit really was
-- observed — and dropping them would lose the link back to the
-- registry. This adds the grouping consumers should COUNT by; it does
-- not delete anything.
--
-- Additive, views only. Apply MANUALLY in the Supabase SQL Editor
-- BEFORE merge.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1 · Events with coordinates + site key ────────────────────
-- The site_key definition here is mirrored in
-- app/api/cron/detect-nightlights-significance/route.ts (siteKey()).
-- If one changes the other must change with it, or the cron's flag
-- dedupe and this view will disagree about what a site is.
CREATE OR REPLACE VIEW nightlights_significant_events_sited AS
  SELECT e.id,
         e.facility_type,
         e.facility_id,
         e.facility_name,
         e.country,
         e.period,
         e.event_type,
         e.observed_radiance,
         e.baseline_nights,
         e.baseline_mean,
         e.baseline_stddev,
         e.deviation_sigma,
         e.dark_nights,
         e.created_at,
         m.latitude,
         m.longitude,
         -- NULL coords cannot be keyed to a site; such a row is left
         -- unsited rather than lumped into a bogus shared bucket.
         CASE WHEN m.latitude IS NOT NULL AND m.longitude IS NOT NULL
              THEN round(m.latitude::numeric, 4) || ':' || round(m.longitude::numeric, 4)
         END AS site_key
    FROM nightlights_significant_events e
    LEFT JOIN firms_monitored_facilities m
      ON m.facility_type = e.facility_type
     AND m.facility_id   = e.facility_id;

COMMENT ON VIEW nightlights_significant_events_sited IS
  'Per-unit significance events with coordinates and a site_key (exact coords, 4dp). The registry stores one row per generating unit at identical coordinates, so COUNT these by site_key, not by row. See migration 094.';

-- ─── 2 · One row per physical site per night per event type ────
-- This is the view any count, brief, alert or UI should read.
-- Radiance and baseline are identical across units of a site (same
-- pixel), so max() is a representative pick, not an aggregation
-- choice that hides disagreement.
CREATE OR REPLACE VIEW nightlights_significant_sites AS
  SELECT site_key,
         period,
         event_type,
         -- Shortest name is the least unit-suffixed, so it reads as the
         -- plant rather than "… Unit 4".
         (array_agg(facility_name ORDER BY length(facility_name), facility_name))[1] AS site_name,
         (array_agg(country ORDER BY (country IS NULL), country))[1]                  AS country,
         count(*)                        AS unit_rows,
         max(latitude)                   AS latitude,
         max(longitude)                  AS longitude,
         max(observed_radiance)          AS observed_radiance,
         max(baseline_mean)              AS baseline_mean,
         max(baseline_nights)            AS baseline_nights,
         max(deviation_sigma)            AS deviation_sigma,
         max(dark_nights)                AS dark_nights,
         min(created_at)                 AS first_seen_at
    FROM nightlights_significant_events_sited
   WHERE site_key IS NOT NULL
   GROUP BY site_key, period, event_type;

COMMENT ON VIEW nightlights_significant_sites IS
  'One row per PHYSICAL SITE per night per event type — the honest unit for any count. unit_rows records how many registry rows collapsed into it. Reading nightlights_significant_events directly over-counts ~4x. See migration 094.';
