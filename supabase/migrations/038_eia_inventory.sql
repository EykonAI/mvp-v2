-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 038 · EIA weekly inventory observations
--
-- Stores weekly U.S. petroleum inventory observations from the EIA
-- v2 API. Powers two flows:
--
--   1. Weekly issuance: every Monday 09:00 UTC, issue-eia-weekly
--      reads the latest stored Cushing print and inserts a fresh
--      predictions_register row resolving against the upcoming
--      Wednesday's publication.
--
--   2. Resolution: the existing score-predictions cron (extended in
--      PR-CAL-5) reads the latest observation for the prediction's
--      target_observable and resolves automatically.
--
-- Refreshed daily by /api/cron/ingest-eia-inventory. Public-read RLS
-- — EIA series are already a public good.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS eia_inventory_observations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id   TEXT NOT NULL,                  -- e.g. 'W_EPC0_SAX_YCUOK_MBBL'
  period      DATE NOT NULL,                  -- report week-ending date
  value       NUMERIC NOT NULL,               -- thousand barrels (typical unit)
  unit        TEXT NOT NULL DEFAULT 'MBBL',
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (series_id, period)
);

CREATE INDEX IF NOT EXISTS idx_eia_inventory_obs_series_period
  ON eia_inventory_observations (series_id, period DESC);

ALTER TABLE eia_inventory_observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS eia_inventory_observations_public_read ON eia_inventory_observations;
CREATE POLICY eia_inventory_observations_public_read ON eia_inventory_observations
  FOR SELECT USING (true);
