-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 037 · Polymarket markets snapshot
--
-- Stores periodic snapshots of the most-active and recently-closed
-- Polymarket markets. Powers two marketing-leverage flows:
--
--   1. At issuance time: an eYKON analyst looks up the matching
--      Polymarket market and notes the consensus probability in the
--      prediction's context. This anchors "eYKON said 64%, Polymarket
--      said 32%" comparisons in the social-card and public page.
--
--   2. At resolution time (PR-CAL-5): predictions tagged
--      source='polymarket' read the final outcome from this table.
--
-- Refreshed every 30 minutes by /api/cron/ingest-polymarket.
-- Public-read RLS — the data is already public on Polymarket.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS polymarket_markets (
  market_id       TEXT PRIMARY KEY,
  question        TEXT NOT NULL,
  outcomes        JSONB NOT NULL,            -- ["Yes","No"] (preserves source ordering)
  outcome_prices  JSONB NOT NULL,            -- {"Yes": 0.32, "No": 0.68}
  volume          NUMERIC,                   -- 24h volume, used for ranking
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  closed          BOOLEAN NOT NULL DEFAULT FALSE,
  closed_at       TIMESTAMPTZ,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_polymarket_markets_volume
  ON polymarket_markets (volume DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_polymarket_markets_closed_at
  ON polymarket_markets (closed_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_polymarket_markets_last_seen
  ON polymarket_markets (last_seen_at DESC);

ALTER TABLE polymarket_markets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS polymarket_markets_public_read ON polymarket_markets;
CREATE POLICY polymarket_markets_public_read ON polymarket_markets
  FOR SELECT USING (true);
