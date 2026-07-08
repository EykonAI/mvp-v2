-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 078 · AIS position history + derived port calls (P2a)
--
-- vessel_positions is a one-row-per-vessel CURRENT snapshot — every
-- hourly ingest overwrites the previous fix, so vessel history is
-- thrown away. This migration starts retaining it for the ~2,048
-- shadow-fleet-profiled vessels (vessel_profiles) and deriving port
-- calls from it:
--
--   ais_position_history — hourly samples of the profiled fleet's
--     snapshot rows, written by /api/cron/sample-ais-history and
--     pruned to a 90-day window by /api/cron/derive-port-calls
--     (~2,048 vessels x 24 samples/day x 90d ≈ 4.4M rows ≈ ~2 GB).
--
--   port_calls — (vessel, port, arrival, departure) episodes derived
--     from the history by derive_port_calls(), called daily.
--
-- Unlocks (P2 brief §3.5): shadow-fleet vessel tracks, port-call
-- ledgers, kinship co-movement, minerals shipment inference.
--
-- Additive. RLS ON, NO permissive policy — both tables are reachable
-- ONLY via the service-role API (createServerSupabase), like the COMM
-- and newsjack tables. Apply MANUALLY in the Supabase SQL Editor
-- BEFORE merge.
-- ═══════════════════════════════════════════════════════════════

-- ─── AIS position history (profiled fleet only) ────────────────
CREATE TABLE IF NOT EXISTS ais_position_history (
  id          BIGSERIAL PRIMARY KEY,
  mmsi        TEXT NOT NULL,
  latitude    DOUBLE PRECISION,
  longitude   DOUBLE PRECISION,
  speed       DOUBLE PRECISION,               -- knots, from the AIS feed
  heading     DOUBLE PRECISION,
  nav_status  INTEGER,
  destination TEXT,
  recorded_at TIMESTAMPTZ NOT NULL,           -- vessel's own position timestamp (updated_at ?? ingested_at)
  sampled_at  TIMESTAMPTZ NOT NULL DEFAULT now(), -- when the cron copied the row
  UNIQUE (mmsi, recorded_at)                  -- unchanged snapshot between runs = no new row
);

CREATE INDEX IF NOT EXISTS idx_ais_history_mmsi_time ON ais_position_history (mmsi, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_ais_history_recorded  ON ais_position_history (recorded_at); -- 90-day pruning

ALTER TABLE ais_position_history ENABLE ROW LEVEL SECURITY;

-- ─── Derived port calls ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS port_calls (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mmsi         TEXT NOT NULL,
  port_id      TEXT NOT NULL,                 -- ports.id (WPI INDEX_NO, TEXT pk — mig 013)
  port_name    TEXT,
  arrived_at   TIMESTAMPTZ NOT NULL,          -- first slow sample seen near the port
  departed_at  TIMESTAMPTZ,                   -- last slow sample seen near the port; NULL = single sample so far
  sample_count INTEGER NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (mmsi, port_id, arrived_at)
);

CREATE INDEX IF NOT EXISTS idx_port_calls_mmsi_time ON port_calls (mmsi, arrived_at DESC);

ALTER TABLE port_calls ENABLE ROW LEVEL SECURITY;

-- ─── derive_port_calls(p_since) ────────────────────────────────
-- Deliberately simple v1, run daily over a 25h window:
--   1. Take history samples since p_since where speed < 0.5 kn.
--   2. Match each to ports within 3 km (geography ST_DWithin on the
--      GIST-indexed ports.geom).
--   3. Group consecutive (mmsi, port) samples into episodes — a gap
--      of more than 6 h near the same port starts a NEW call.
--   4. Episodes that continue a stored call (first sample within 6 h
--      of the call's last known timestamp) EXTEND departed_at and
--      sample_count; the rest are inserted (idempotent on the
--      (mmsi, port_id, arrived_at) unique key).
--
-- Known v1 limitations (accepted, documented for v2):
--   * speed < 0.5 misses drifting/anchored-with-current vessels and
--     vessels whose feed omits speed (speed IS NULL is skipped).
--   * 3 km is generous for mega-ports and tight for anchorages —
--     no per-port radius yet.
--   * A vessel idling near two ports within 3 km logs a call at both.
--   * Overlapping daily windows (25h vs 24h cadence) can double-count
--     a handful of samples into sample_count on extended calls —
--     arrival/departure timestamps stay correct, so treat
--     sample_count as an approximate dwell signal only.
--   * departed_at means "last time we saw it near the port", not a
--     confirmed departure — open calls simply stop extending.
CREATE OR REPLACE FUNCTION derive_port_calls(p_since TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_episodes INTEGER := 0;
  v_extended INTEGER := 0;
  v_inserted INTEGER := 0;
BEGIN
  -- Episodes of "slow near a port" for the window, one row per
  -- (mmsi, port, visit).
  DROP TABLE IF EXISTS tmp_port_call_episodes;
  CREATE TEMP TABLE tmp_port_call_episodes ON COMMIT DROP AS
  WITH slow AS (
    SELECT h.mmsi, h.recorded_at, h.longitude, h.latitude
    FROM ais_position_history h
    WHERE h.recorded_at >= p_since
      AND h.speed IS NOT NULL AND h.speed < 0.5
      AND h.longitude IS NOT NULL AND h.latitude IS NOT NULL
  ),
  near AS (
    SELECT s.mmsi, p.id AS port_id, p.port_name, s.recorded_at
    FROM slow s
    JOIN ports p
      ON ST_DWithin(
           p.geom,
           ST_SetSRID(ST_MakePoint(s.longitude, s.latitude), 4326)::geography,
           3000)
  ),
  flagged AS (
    SELECT near.*,
           CASE WHEN lag(recorded_at) OVER w IS NULL
                  OR recorded_at - lag(recorded_at) OVER w > interval '6 hours'
                THEN 1 ELSE 0 END AS new_call
    FROM near
    WINDOW w AS (PARTITION BY mmsi, port_id ORDER BY recorded_at)
  ),
  grouped AS (
    SELECT flagged.*,
           sum(new_call) OVER (PARTITION BY mmsi, port_id ORDER BY recorded_at) AS grp
    FROM flagged
  )
  SELECT mmsi, port_id, port_name,
         min(recorded_at) AS first_at,
         max(recorded_at) AS last_at,
         count(*)::int    AS samples
  FROM grouped
  GROUP BY mmsi, port_id, port_name, grp;

  SELECT count(*) INTO v_episodes FROM tmp_port_call_episodes;

  -- Extend calls that continue across the window boundary: the
  -- episode's first sample falls within 6 h of the stored call's
  -- last known timestamp (strictly later than its arrival, so a
  -- re-run of the exact same window is a no-op).
  UPDATE port_calls pc
  SET departed_at  = GREATEST(COALESCE(pc.departed_at, pc.arrived_at), e.last_at),
      sample_count = pc.sample_count + e.samples
  FROM tmp_port_call_episodes e
  WHERE pc.mmsi = e.mmsi
    AND pc.port_id = e.port_id
    AND e.first_at > pc.arrived_at
    AND e.first_at <= COALESCE(pc.departed_at, pc.arrived_at) + interval '6 hours';
  GET DIAGNOSTICS v_extended = ROW_COUNT;

  -- Insert genuinely new calls (episodes not attached to any stored
  -- call). ON CONFLICT keeps a same-window re-run idempotent.
  INSERT INTO port_calls (mmsi, port_id, port_name, arrived_at, departed_at, sample_count)
  SELECT e.mmsi, e.port_id, e.port_name, e.first_at,
         CASE WHEN e.last_at > e.first_at THEN e.last_at END,
         e.samples
  FROM tmp_port_call_episodes e
  WHERE NOT EXISTS (
    SELECT 1 FROM port_calls pc
    WHERE pc.mmsi = e.mmsi
      AND pc.port_id = e.port_id
      AND e.first_at >= pc.arrived_at
      AND e.first_at <= COALESCE(pc.departed_at, pc.arrived_at) + interval '6 hours'
  )
  ON CONFLICT (mmsi, port_id, arrived_at) DO UPDATE
    SET departed_at  = GREATEST(COALESCE(port_calls.departed_at, port_calls.arrived_at), EXCLUDED.departed_at),
        sample_count = GREATEST(port_calls.sample_count, EXCLUDED.sample_count);
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object(
    'episodes', v_episodes,
    'extended', v_extended,
    'inserted', v_inserted
  );
END;
$$;
