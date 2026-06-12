-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 053 · Extend the Malacca polygon to include Singapore Strait
--
-- Migration 042 seeded geo_regions.malacca as ST_MakeEnvelope(98.0,
-- 1.5, 104.0, 6.0) — the Malacca Strait proper. Live AIS verification
-- (2026-06-12) showed the feed's traffic in this system sits almost
-- entirely in the SINGAPORE STRAIT band, just OUTSIDE that ring:
--
--   fresh vessels / 24h, old ring (lat ≥ 1.5°N) ........ 0
--   fresh vessels / 24h at lat 1.07–1.34°N, lon
--     103.44–104.14°E (Singapore Strait) ............ 1,245
--     · of which 141 east of lon 104.0 — so the ring
--       must extend EAST as well as SOUTH.
--
-- Shipping-wise Singapore Strait is the southern gate of the Malacca
-- chokepoint system, so the region polygon should cover it. This
-- updates the envelope to (98.0, 0.9) → (104.6, 6.0):
--   · south to 0.9°N  — Singapore Strait with margin
--   · east  to 104.6°E — eastern anchorages/approaches with margin,
--     stopping short of the South China Sea proper
-- Trade-off (accepted): the box gains a slice of east-Johor / Riau
-- nearshore water at its NE corner; an L-shaped ring would avoid it
-- at the cost of leaving house style (all 042 regions are envelopes).
--
-- Pre-verified against production before authoring: the new ring
-- intersects 1,245 fresh-24h / 6,655 total vessel rows (read-only
-- probe, 2026-06-12).
--
-- Everything reading geo_regions picks this up immediately — the
-- region-scoped rule evaluator (recent_vessels_in_region, 042), the
-- chokepoint snapshot RPC (count_chokepoint_vessels, 043), and the
-- region-aware suggestion gate (PR #176).
--
-- Idempotent. Apply MANUALLY in the Supabase Dashboard → SQL Editor.
-- ═══════════════════════════════════════════════════════════════

UPDATE geo_regions
SET geom = ST_Multi(ST_MakeEnvelope(98.0, 0.9, 104.6, 6.0, 4326))::geography
WHERE slug = 'malacca';
