-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 043 · AIS chokepoint observations + 'ais' source
--
-- Stores a daily snapshot of distinct-vessel counts per chokepoint
-- (vessel_positions rows whose geom intersects the chokepoint
-- polygon, with updated_at in the last window_hours). Powers
-- source='ais' weekly predictions issued by
--   /api/cron/issue-chokepoint-weekly
-- and resolved by the score-predictions cron's `ais` resolver case
-- (lib/predictions/resolvers/ais-chokepoint.ts).
--
-- The Hormuz polygon is already seeded in migration 042
-- (geo_regions WHERE slug='hormuz'); this migration adds only the
-- observation table, the count RPC the snapshot cron calls, and the
-- whitelist extension on predictions_register.source.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. Observation snapshot table ────────────────────────────
CREATE TABLE IF NOT EXISTS ais_chokepoint_observations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chokepoint    TEXT NOT NULL,            -- matches geo_regions.slug
  period        DATE NOT NULL,            -- UTC day of snapshot
  vessel_count  INTEGER NOT NULL,         -- distinct mmsi in window
  window_hours  INTEGER NOT NULL DEFAULT 24,
  snapshot_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chokepoint, period)
);

CREATE INDEX IF NOT EXISTS idx_ais_chokepoint_obs_period
  ON ais_chokepoint_observations (chokepoint, period DESC);

ALTER TABLE ais_chokepoint_observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ais_chokepoint_observations_public_read
  ON ais_chokepoint_observations;
CREATE POLICY ais_chokepoint_observations_public_read
  ON ais_chokepoint_observations
  FOR SELECT USING (true);

-- ─── 2. Count RPC — called by /api/cron/snapshot-chokepoints ──
-- Returns the count of distinct mmsi whose latest vessel_positions
-- row intersects the named chokepoint polygon and was updated in
-- the last `p_window_hours`. Stable + parallel-safe so PostgREST
-- can serve it via .rpc(); SECURITY INVOKER (default) so the
-- caller's RLS applies — vessel_positions is already public-read.
CREATE OR REPLACE FUNCTION count_chokepoint_vessels(
  p_slug          text,
  p_window_hours  int DEFAULT 24
)
RETURNS integer
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT COUNT(DISTINCT vp.mmsi)::integer
  FROM vessel_positions vp
  JOIN geo_regions gr ON gr.slug = p_slug
  WHERE ST_Intersects(gr.geom, vp.geom)
    AND vp.updated_at > NOW() - make_interval(hours => GREATEST(1, p_window_hours));
$$;

-- ─── 3. Extend predictions_register source whitelist ──────────
-- Adds 'ais' to the existing CHECK from migration 036. Drop-and-
-- re-add is idempotent and preserves the constraint name so
-- diagnostic queries against information_schema keep working.
ALTER TABLE predictions_register
  DROP CONSTRAINT IF EXISTS predictions_register_source_check;
ALTER TABLE predictions_register
  ADD  CONSTRAINT predictions_register_source_check
       CHECK (source IN ('manual','polymarket','eia','ofac','kalshi','ai','ais'));
