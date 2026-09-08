-- 144 · Two Polymarket house claims, due since June: restore the instrument's
--       rows from the public resolution so the resolver can judge them.
--
-- The claims (both track house, persona analyst, context.kind = user_call):
--   14fed31e…  polymarket:906975:Yes   p = 0.50  issued 2026-06-15 18:17 UTC
--   b6dea57c…  polymarket:1962237:No   p = 0.80  issued 2026-06-20 17:09 UTC
-- Both have sat "due" with no outcome since the day they were issued. The
-- resolver (lib/predictions/resolvers/polymarket.ts) reads OUR copy of the
-- market, polymarket_markets, and defers until closed = true. Our copies
-- froze open: the ingest keeps only the 50 highest-volume active and the 50
-- highest-volume recently-closed markets, and both markets dropped out of
-- both lists before they closed (last_seen_at 2026-05-18 and 2026-06-06;
-- closed on Polymarket 2026-06-17 and 2026-06-18). Nothing was unresolvable;
-- the instrument's data was stale. Read on 2026-09-08 16:40 UTC from the
-- public API — evidence, not judgement:
--   https://gamma-api.polymarket.com/markets/906975
--     "Will the Fed increase interest rates by 25 bps after the June 2026 meeting?"
--     closed true · umaResolutionStatus resolved · outcomePrices ["0","1"]
--     → Yes = 0 · closedTime 2026-06-17 21:20:40+00
--   https://gamma-api.polymarket.com/markets/1962237
--     "US x Iran permanent peace deal by June 30, 2026?"
--     closed true · umaResolutionStatus resolved · outcomePrices ["1","0"]
--     → Yes = 1 · closedTime 2026-06-18 00:33:07+00
--
-- This file writes NO outcome. It restores the two market rows to what the
-- instrument published, and the scorer's next :07 tick resolves the claims
-- through the same resolver as every other Polymarket claim:
--   906975 claimed Yes at 0.50 → observed 0 → Brier 0.25
--   1962237 claimed No at 0.80 → observed 0 (Yes resolved) → Brier 0.64
-- Both land in the house record (n 45 → 47). The alternative — VOID as
-- "unresolvable" — would discard two outcomes that are public and visible,
-- which is not what VOID means (types.ts: nothing was seen). A ledger that
-- voids observable losses is not a ledger.
--
-- FOLLOW-UP (not here): the ingest should refresh every market that has an
-- open claim regardless of volume rank, so a claimed market can never strand.

-- STEP 1 — READ ONLY. Expect closed = false on both, stale prices
-- (Yes 0.0035 / 0.275), last_seen_at in May/June.
SELECT market_id, closed, closed_at, active, outcome_prices, last_seen_at, left(question, 60) AS question
  FROM public.polymarket_markets WHERE market_id IN ('906975', '1962237') ORDER BY market_id;

-- STEP 2 — THE CHANGE (two rows; the scorer does the rest at :07).
BEGIN;
UPDATE public.polymarket_markets
   SET closed = true, active = false, closed_at = '2026-06-17 21:20:40+00',
       outcome_prices = '{"Yes": 0, "No": 1}'::jsonb, last_seen_at = now()
 WHERE market_id = '906975';
UPDATE public.polymarket_markets
   SET closed = true, active = false, closed_at = '2026-06-18 00:33:07+00',
       outcome_prices = '{"Yes": 1, "No": 0}'::jsonb, last_seen_at = now()
 WHERE market_id = '1962237';
COMMIT;

-- STEP 3 — VERIFY. Expect closed = true on both with the prices above; after
-- the next :07 tick the two claims carry outcomes (Brier 0.25 and 0.64) and
-- due_unscored_predictions_count() has fallen by 2.
SELECT market_id, closed, closed_at, outcome_prices FROM public.polymarket_markets WHERE market_id IN ('906975', '1962237') ORDER BY market_id;
SELECT r.target_observable, (r.predicted_distribution->>'mean')::numeric AS p, o.observed_value, o.brier, o.observed_at
  FROM public.predictions_register r LEFT JOIN public.prediction_outcomes o ON o.prediction_id = r.id
 WHERE r.source = 'polymarket' AND r.id IN ('14fed31e-5952-4b95-9567-a13e0bdfd8f9', 'b6dea57c-da34-42ee-af70-237182eca7a4');
