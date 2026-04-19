-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 005 · Baseline distributions + Regime shifts
-- baseline_distributions (per entity-class statistical baseline)
-- regime_shifts (nightly KS / Mann-Whitney)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS baseline_distributions (
  id BIGSERIAL PRIMARY KEY,
  entity_class TEXT NOT NULL,                -- 'vessel','aircraft','conflict','energy','theatre'
  entity_key TEXT NOT NULL,                  -- region slug or MMSI/ICAO24/country
  metric TEXT NOT NULL,                      -- 'vessel_count','flight_count','acled_events','gen_mw'
  distribution JSONB NOT NULL,               -- {mean,std,p5,p50,p95,seasonal_coef:[...]}
  sample_size INT,
  learned_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (entity_class, entity_key, metric)
);
CREATE INDEX IF NOT EXISTS idx_baseline_lookup
  ON baseline_distributions (entity_class, entity_key, metric);

ALTER TABLE baseline_distributions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS baseline_public_read ON baseline_distributions;
CREATE POLICY baseline_public_read ON baseline_distributions
  FOR SELECT USING (true);

-- ─── Regime shifts ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS regime_shifts (
  id BIGSERIAL PRIMARY KEY,
  region TEXT NOT NULL,
  signal TEXT NOT NULL,                      -- 'vessel_count','flight_count','acled_events','gen_mw'
  test_statistic NUMERIC,
  p_value NUMERIC(10,8),
  effect_size NUMERIC,
  old_window JSONB,                          -- {start,end,mean,std}
  new_window JSONB,
  detected_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_regime_region_time
  ON regime_shifts (region, detected_at DESC);

ALTER TABLE regime_shifts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS regime_public_read ON regime_shifts;
CREATE POLICY regime_public_read ON regime_shifts
  FOR SELECT USING (true);
