-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 095 · Site-level FIRMS events (the same over-count)
--
-- The sibling of 094. When night-lights reported "43 facilities went
-- dark" and it was ten, the cause was the facility registry storing one
-- row per GENERATING UNIT at byte-identical coordinates. That registry
-- is shared, so thermal has always had the same inflation — it simply
-- was never checked:
--
--     firms_significant_events   1,266 rows
--                          →     1,035 facility ids
--                          →       654 site-nights
--
-- Roughly 1.9x. Every thermal count quoted so far — including the
-- "1,131 significance events" in the 2026-07-31 brief — is a ROW count
-- being read as a facility count.
--
-- The same key for the same reason: exact coordinates (4 dp ≈ 11 m).
-- VIIRS resolves ~375 m, so units at one plant fall in one pixel and
-- return one detection; five rows are five copies of a single fact.
-- Proximity clustering was rejected in 094 because Az Zour North and
-- South sit 1.2 km apart and darkened independently — real duplicates
-- are at the SAME POINT, so exact matching collapses them all and can
-- never merge two genuinely distinct plants.
--
-- Verified: 0 unsited rows. 15 site keys merge differently-NAMED
-- facilities and each was inspected — Talatan solar 1/3/5, Mesquite
-- generating station blocks 1 and 2, Dnipro-1 and Dnipro-2 (two stages
-- of one dam), Jubail SWCC + MARAFIQ (co-located at one industrial
-- complex), and Chinese stations carrying two operator names at one
-- point. All correctly one site.
--
-- ─── ONE THING THIS SURFACED, NOT FIXED ───────────────────────────
-- Three event rows sit on PLACEHOLDER coordinates — 7.0000, 81.0000
-- and 42.1000, 19.1000. Round numbers to 1 dp are not locations, they
-- are a geocoder giving up. Grouping them by site is still correct
-- (they claim the same point), but a facility whose coordinates are
-- invented cannot support a real thermal attribution. Three rows out of
-- 1,266 is a footnote, not a P0 — recorded here so it is not
-- rediscovered as a mystery later.
--
-- Additive, views only. Per-unit rows are kept: each unit really was
-- observed, and dropping them would sever the registry link.
-- Apply MANUALLY in the Supabase SQL Editor BEFORE merge.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1 · Events with coordinates + site key ────────────────────
-- site_key mirrors migration 094 and the siteKey() helpers in both
-- significance crons. All four must agree on what a site is.
CREATE OR REPLACE VIEW firms_significant_events_sited AS
  SELECT e.id,
         e.facility_type,
         e.facility_id,
         e.facility_name,
         e.country,
         e.period,
         e.event_type,
         e.observed_count,
         e.observed_max_frp,
         e.baseline_days,
         e.baseline_rate,
         e.baseline_mean_frp,
         e.deviation,
         e.dark_days,
         e.created_at,
         m.latitude,
         m.longitude,
         CASE WHEN m.latitude IS NOT NULL AND m.longitude IS NOT NULL
              THEN round(m.latitude::numeric, 4) || ':' || round(m.longitude::numeric, 4)
         END AS site_key
    FROM firms_significant_events e
    LEFT JOIN firms_monitored_facilities m
      ON m.facility_type = e.facility_type
     AND m.facility_id   = e.facility_id;

COMMENT ON VIEW firms_significant_events_sited IS
  'Per-unit thermal significance events with coordinates and a site_key (exact coords, 4dp). The registry stores one row per generating unit at identical coordinates, so COUNT these by site_key, not by row. Sibling of 094. See migration 095.';

-- ─── 2 · One row per physical site per day per event type ──────
-- The view any count, brief, alert or UI should read.
-- Detection values are identical across units of a site (one pixel),
-- so max() is a representative pick, not an aggregation that hides
-- disagreement.
CREATE OR REPLACE VIEW firms_significant_sites AS
  SELECT site_key,
         period,
         event_type,
         -- Shortest name reads as the plant rather than "… Unit 4".
         (array_agg(facility_name ORDER BY length(facility_name), facility_name))[1] AS site_name,
         (array_agg(country ORDER BY (country IS NULL), country))[1]                  AS country,
         count(*)                        AS unit_rows,
         max(latitude)                   AS latitude,
         max(longitude)                  AS longitude,
         max(observed_count)             AS observed_count,
         max(observed_max_frp)           AS observed_max_frp,
         max(baseline_days)              AS baseline_days,
         max(baseline_rate)              AS baseline_rate,
         max(deviation)                  AS deviation,
         max(dark_days)                  AS dark_days,
         min(created_at)                 AS first_seen_at
    FROM firms_significant_events_sited
   WHERE site_key IS NOT NULL
   GROUP BY site_key, period, event_type;

COMMENT ON VIEW firms_significant_sites IS
  'One row per PHYSICAL SITE per day per event type — the honest unit for any thermal count. unit_rows records how many registry rows collapsed into it. Reading firms_significant_events directly over-counts ~1.9x. See migration 095.';
