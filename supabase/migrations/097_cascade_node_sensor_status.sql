-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 097 · Observed sensor status for cascade nodes
--
-- Phase 3b. The Cascade workspace is honestly badged ILLUSTRATIVE
-- MODEL and reads no table at all: its topology is infra_edges.json,
-- and every node carries a HARDCODED status of ok / warn / crit. Nine
-- of fifteen say "ok" — including hubs no sensor has ever looked at.
--
-- This does not make the model real. The propagation stays a
-- deterministic scenario and stays badged. What it makes real is the
-- NODE STATE: whether anything is actually being watched near that hub,
-- and what the satellites saw there.
--
-- ─── WHY PROXIMITY AND NOT NAME MATCHING ──────────────────────────
-- The tempting join is on facility name, and it is wrong. Measured:
-- "Rotterdam" matches 17 facilities in the registry, mostly unrelated
-- power plants; "Yokohama" matches 28. A cascade node is an ABSTRACT
-- HUB — a port, a refining complex, a strait — while the sensors watch
-- SPECIFIC facilities. Attributing a random Rotterdam-area plant's
-- flare to "the Rotterdam delivery hub" would manufacture a claim
-- nobody could verify.
--
-- Proximity with an EXPLICIT RADIUS is verifiable: "thermal activity
-- within 25 km of the Ras Tanura complex" is a statement a reader can
-- check. Measured on prod at 25 km, it is also a better signal than the
-- name join in every case (Yokohama: 0 watched by name, 14 by
-- proximity).
--
-- ─── THE STATE THAT MATTERS MOST IS "NOT OBSERVED" ────────────────
-- Primorsk has ZERO facilities in the registry within 25 km and zero
-- thermal coverage. The fixture calls it "ok". Those are opposite
-- claims: "ok" asserts health, "not observed" admits ignorance. Most of
-- this migration's value is being able to tell them apart.
--
-- Note also that thermal detections do NOT require the registry — they
-- are raw hot pixels keyed by coordinate. Novorossiysk has 0 registry
-- facilities but 23 detections in 7 days, so a hub can be thermally
-- observed while having no watched facility.
--
-- ─── ROUTINE FLARING IS NOT AN ALARM ──────────────────────────────
-- detections_7d is returned as CONTEXT, never as a severity. Basra
-- logged 185 in 7 days and Port Arthur 122 — that is what a working
-- oil field and a working refinery complex look like from orbit.
-- Only significance events (departures from a facility's OWN baseline)
-- are counted as significant, which is why they are a separate column.
--
-- ─── A PERFORMANCE TRAP, CAUGHT BEFORE SHIPPING ───────────────────
-- The first cut resolved facilities through firms_monitored_facilities,
-- which exposes latitude/longitude but NOT geom. That forces
-- ST_DWithin(ST_MakePoint(lon, lat)::geography, ...) — a CONSTRUCTED
-- point, which no index can serve. Measured: a seq scan discarding
-- 182,383 power_plants rows, once per node.
--
--     via the view, constructed points   10,380 ms
--     via base tables, indexed geom         149 ms   (70x)
--
-- So the spatial join runs against refineries/power_plants directly,
-- where geography GiST indexes already exist, and is computed ONCE per
-- node in the `near` CTE rather than re-derived per aggregate. The
-- thermal subquery was always fast for the same reason — it filters on
-- firms_thermal_anomalies.geom, a real indexed column.
--
-- Additive, function only. Apply MANUALLY in the SQL Editor BEFORE merge.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION cascade_node_sensor_status(
  p_nodes     jsonb,              -- [{"node_id":"...","lat":1.2,"lon":3.4}, ...]
  p_radius_km numeric DEFAULT 25,
  p_days      int     DEFAULT 7
) RETURNS TABLE (
  node_id             text,
  facilities_nearby   int,   -- in the registry within the radius
  facilities_watched  int,   -- of those, actually observed by FIRMS recently
  detections          int,   -- RAW hot pixels — context, mostly routine flaring
  thermal_events      int,   -- departures from a facility's own baseline
  nightlights_events  int,
  latest_event_type   text,
  latest_event_at     date
) AS $$
  WITH n AS (
    SELECT e->>'node_id'          AS node_id,
           (e->>'lat')::float8    AS lat,
           (e->>'lon')::float8    AS lon
      FROM jsonb_array_elements(p_nodes) e
     WHERE e->>'lat' IS NOT NULL AND e->>'lon' IS NOT NULL
  ),
  pt AS (
    SELECT node_id, ST_MakePoint(lon, lat)::geography AS g FROM n
  ),
  -- Spatial join computed ONCE per node, against the base tables so the
  -- geography GiST indexes apply. Going through
  -- firms_monitored_facilities instead costs 70x (see header).
  near AS (
    SELECT pt.node_id, 'refinery'::text AS ft, r.id::text AS fid
      FROM pt JOIN refineries r
        ON r.geom IS NOT NULL AND ST_DWithin(r.geom, pt.g, p_radius_km * 1000)
    UNION ALL
    SELECT pt.node_id, 'power_plant'::text, p.id::text
      FROM pt JOIN power_plants p
        ON p.geom IS NOT NULL AND ST_DWithin(p.geom, pt.g, p_radius_km * 1000)
  ),
  -- Significance events near each node, both sensors, one pass.
  ev AS (
    SELECT pt.node_id, 'thermal'::text AS sensor, s.event_type, s.period
      FROM pt JOIN firms_significant_sites s
        ON s.latitude IS NOT NULL AND s.period >= CURRENT_DATE - p_days
       AND ST_DWithin(ST_MakePoint(s.longitude, s.latitude)::geography, pt.g, p_radius_km * 1000)
    UNION ALL
    SELECT pt.node_id, 'nightlights', s.event_type, s.period
      FROM pt JOIN nightlights_significant_sites s
        ON s.latitude IS NOT NULL AND s.period >= CURRENT_DATE - p_days
       AND ST_DWithin(ST_MakePoint(s.longitude, s.latitude)::geography, pt.g, p_radius_km * 1000)
  )
  SELECT
    pt.node_id,
    (SELECT COUNT(*)::int FROM near WHERE near.node_id = pt.node_id),
    (SELECT COUNT(DISTINCT (o.facility_type || o.facility_id))::int
       FROM firms_facility_observations o
       JOIN near ON near.node_id = pt.node_id
                AND near.ft = o.facility_type
                AND near.fid = o.facility_id
      WHERE o.period >= CURRENT_DATE - p_days),
    -- Raw hot pixels. Needs no registry entry — keyed by coordinate,
    -- and filtered on an indexed geom column.
    (SELECT COUNT(*)::int FROM firms_thermal_anomalies f
      WHERE f.acq_date >= CURRENT_DATE - p_days
        AND f.geom IS NOT NULL
        AND ST_DWithin(f.geom, pt.g, p_radius_km * 1000)),
    (SELECT COUNT(*)::int FROM ev WHERE ev.node_id = pt.node_id AND ev.sensor = 'thermal'),
    (SELECT COUNT(*)::int FROM ev WHERE ev.node_id = pt.node_id AND ev.sensor = 'nightlights'),
    (SELECT ev.event_type FROM ev WHERE ev.node_id = pt.node_id
      ORDER BY ev.period DESC LIMIT 1),
    (SELECT MAX(ev.period) FROM ev WHERE ev.node_id = pt.node_id)
  FROM pt;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION cascade_node_sensor_status IS
  'Observed sensor state near each cascade node, by explicit radius (never by facility name — "Rotterdam" name-matches 17 unrelated facilities). facilities_nearby vs facilities_watched is the coverage story; detections is raw hot pixels and is CONTEXT, not severity, since a working refinery flares daily. Only thermal_events / nightlights_events represent departures from a facility own baseline. See migration 097.';
