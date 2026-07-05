-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 077 · polymarket_markets.end_date
--
-- The Gamma API returns endDate on every market; the client already
-- parses it but only used it to derive closed_at. Persisting it lets
-- "The First Ten" (Founding Partner build-prompt §7) rank OPEN markets
-- by soonest scheduled close — the honest basis for "fast-resolving"
-- calls, since user predictions are Polymarket-resolved and settle
-- only when the market closes. Backfills on the next 30-minute
-- ingest-polymarket run; no data migration needed.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE polymarket_markets
  ADD COLUMN IF NOT EXISTS end_date TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_polymarket_markets_end_date
  ON polymarket_markets (end_date ASC NULLS LAST)
  WHERE closed = FALSE;
