-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 003 · Predictions Register + Calibration
-- predictions_register, prediction_outcomes, calibration_summary view
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS predictions_register (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature TEXT NOT NULL,
  context JSONB NOT NULL,
  predicted_distribution JSONB NOT NULL,
  target_observable TEXT NOT NULL,
  target_window_hours INT NOT NULL,
  issued_at TIMESTAMPTZ DEFAULT NOW(),
  resolves_at TIMESTAMPTZ NOT NULL,
  persona TEXT                              -- 'analyst','day-trader','commodities',...
);
CREATE INDEX IF NOT EXISTS idx_predictions_feature_time
  ON predictions_register (feature, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_resolves_at
  ON predictions_register (resolves_at);

ALTER TABLE predictions_register ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS predictions_public_read ON predictions_register;
CREATE POLICY predictions_public_read ON predictions_register
  FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS prediction_outcomes (
  prediction_id UUID PRIMARY KEY REFERENCES predictions_register(id) ON DELETE CASCADE,
  observed_value NUMERIC,
  observed_at TIMESTAMPTZ,
  brier NUMERIC,
  log_loss NUMERIC,
  calibration_bin INT
);

ALTER TABLE prediction_outcomes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prediction_outcomes_public_read ON prediction_outcomes;
CREATE POLICY prediction_outcomes_public_read ON prediction_outcomes
  FOR SELECT USING (true);

-- ─── Materialised summary view ──────────────────────────────
-- The scoring cron writes to this table; the top-strip and the
-- Calibration Ledger page both read from it. Implemented as a
-- table (not a view) so the nightly job can precompute the
-- spark polylines.
CREATE TABLE IF NOT EXISTS calibration_summary (
  id INT PRIMARY KEY DEFAULT 1,              -- single-row table
  metrics JSONB NOT NULL,                    -- [{key,label,value,trend,spark[]}]
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  degraded BOOLEAN DEFAULT TRUE,             -- true until >= 30 days of resolved predictions
  CONSTRAINT calibration_summary_singleton CHECK (id = 1)
);

ALTER TABLE calibration_summary ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS calibration_summary_public_read ON calibration_summary;
CREATE POLICY calibration_summary_public_read ON calibration_summary
  FOR SELECT USING (true);
