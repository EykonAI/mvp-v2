-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 040 · prediction_outcomes.resolution_source_url
--
-- Tiny schema addition the PR-CAL-1 brief implied but didn't ship:
-- when a prediction resolves, store the URL the public Calibration
-- Ledger page (and the social card) can deep-link to as evidence.
-- Examples by source:
--   polymarket → https://polymarket.com/markets/<market_id>
--   eia        → https://www.eia.gov/petroleum/supply/weekly/
--   ofac       → https://sanctionssearch.ofac.treas.gov/Details.aspx?id=<ent_num>
--   manual     → operator-supplied (a tweet, press release, dashboard…)
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE prediction_outcomes
  ADD COLUMN IF NOT EXISTS resolution_source_url TEXT;
