-- 104: Commodities grounding pass (Grounding Brief 2026-08-09 rev. B, PR 2)
--
-- Four parts, all additive:
--   1. commodity_shipments — vessel table at PAID-AIS-TIER shape (D4).
--      The free tier populates the chokepoint-visible subset; nullable-
--      by-design columns (cargo_class, laden, eta) are how the free
--      tier coexists with the paid schema. No UI/schema rework at the
--      provider upgrade — data density simply rises.
--   2. oil_port_call_candidates() — PostGIS helper the shipment
--      derivation cron calls: recent port calls at ports within an
--      EXPLICIT radius of a registry refinery (checkable mapping —
--      never a name join).
--   3. commodity_export_shares — seeded primary-source export shares
--      for wheat / oil / gas (D2: the seed path ships unconditionally;
--      the Comtrade layer overrides when COMTRADE_API_KEY lands).
--      Cited per row, vintage stated, idempotent upserts.
--   4. Copper rows for mineral_production + mineral_refining_share —
--      the picker offers copper but the USGS/IEA seed (mig 079) never
--      included it.
--
-- Run read-only first: execute the SELECT at the bottom of this file;
-- it must return the seeded row counts (wheat 7, oil 7, gas 5,
-- copper production 6, copper refining 4) and 0 for commodity_shipments.

-- ─── 1 · commodity_shipments (paid-tier shape) ───────────────────
CREATE TABLE IF NOT EXISTS commodity_shipments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity        text NOT NULL,            -- family key: 'oil' (brent+wti); 'gas'/'wheat' arrive with paid AIS
  mmsi             text NOT NULL,
  imo              text,
  vessel_name      text,
  flag             text,
  cargo_class      text,                     -- VLCC/Suezmax/Aframax/product/LNG/bulk — paid-tier static data; NULL on free
  laden            text CHECK (laden IN ('laden','ballast')),
  laden_method     text,                     -- e.g. 'draught_delta' — stated wherever laden is set
  origin_port      text,
  origin_country   text,
  destination      text,
  destination_kind text NOT NULL DEFAULT 'unknown'
                     CHECK (destination_kind IN ('declared','inferred','unknown')),
  eta              timestamptz,
  eta_kind         text CHECK (eta_kind IN ('declared','estimated')),
  confidence       text NOT NULL CHECK (confidence IN ('high','medium','low')),
  method           text NOT NULL,            -- e.g. 'tanker_class+oil_port_call'
  dark_gap_hours   numeric,                  -- reuses shadow-fleet gap semantics; NULL = no gap flagged
  coverage_scope   text NOT NULL DEFAULT 'chokepoint'
                     CHECK (coverage_scope IN ('global','chokepoint')),
  first_seen       timestamptz NOT NULL DEFAULT now(),
  last_seen        timestamptz NOT NULL DEFAULT now(),
  status           text NOT NULL DEFAULT 'underway'
                     CHECK (status IN ('underway','arrived','stale')),
  UNIQUE (mmsi, commodity)
);

CREATE INDEX IF NOT EXISTS idx_commodity_shipments_read
  ON commodity_shipments (commodity, status, last_seen DESC);

ALTER TABLE commodity_shipments ENABLE ROW LEVEL SECURITY;
-- No permissive policy: service-role reads only, like mineral_shipments.

-- ─── 2 · oil_port_call_candidates(lookback_days, radius_m) ───────
-- Port calls in the lookback window at ports within radius_m of a
-- registry refinery. Both geom columns are GiST-indexed (migs 013/060);
-- ST_DWithin(geography) uses the index. EXPLAIN of the body on prod
-- 2026-08-09 is quoted in the PR.
CREATE OR REPLACE FUNCTION oil_port_call_candidates(
  p_lookback_days int DEFAULT 21,
  p_radius_m      numeric DEFAULT 5000
)
RETURNS TABLE (
  mmsi        text,
  port_id     text,
  port_name   text,
  country_code text,
  arrived_at  timestamptz,
  departed_at timestamptz
)
LANGUAGE sql STABLE AS $$
  SELECT DISTINCT ON (pc.mmsi)
         pc.mmsi, pc.port_id, pc.port_name, p.country_code,
         pc.arrived_at, pc.departed_at
  FROM port_calls pc
  JOIN ports p ON p.id = pc.port_id
  WHERE pc.arrived_at > now() - make_interval(days => p_lookback_days)
    AND EXISTS (
      SELECT 1 FROM refineries r
      WHERE ST_DWithin(r.geom, p.geom, p_radius_m)
    )
  ORDER BY pc.mmsi, pc.arrived_at DESC;
$$;

-- ─── 3 · commodity_export_shares (seed, D2 both-paths) ───────────
CREATE TABLE IF NOT EXISTS commodity_export_shares (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity  text NOT NULL,                  -- 'wheat' | 'oil' | 'gas' (family keys; route maps slugs)
  country    text NOT NULL,
  year       int NOT NULL,                   -- data year / marketing-year start
  value      numeric,                        -- in `unit`
  unit       text,
  share_pct  numeric NOT NULL,               -- percent of world (20.1 = 20.1%)
  source     text NOT NULL,                  -- citation, vintage included
  as_of      date,
  notes      text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (commodity, country, year)
);
ALTER TABLE commodity_export_shares ENABLE ROW LEVEL SECURITY;

-- Wheat — USDA WASDE-666 (Dec 2025), 2025/26 projection, exports,
-- world total 218.71 MMT. share_pct = country / world.
INSERT INTO commodity_export_shares (commodity, country, year, value, unit, share_pct, source, as_of) VALUES
  ('wheat', 'Russia',         2025, 44.00, 'MMT', 20.1, 'USDA WASDE-666 Dec 2025, TY2025/26 proj.', '2025-12-09'),
  ('wheat', 'European Union', 2025, 33.00, 'MMT', 15.1, 'USDA WASDE-666 Dec 2025, TY2025/26 proj.', '2025-12-09'),
  ('wheat', 'Canada',         2025, 28.00, 'MMT', 12.8, 'USDA WASDE-666 Dec 2025, TY2025/26 proj.', '2025-12-09'),
  ('wheat', 'Australia',      2025, 27.00, 'MMT', 12.3, 'USDA WASDE-666 Dec 2025, TY2025/26 proj.', '2025-12-09'),
  ('wheat', 'United States',  2025, 24.49, 'MMT', 11.2, 'USDA WASDE-666 Dec 2025, TY2025/26 proj.', '2025-12-09'),
  ('wheat', 'Argentina',      2025, 14.50, 'MMT',  6.6, 'USDA WASDE-666 Dec 2025, TY2025/26 proj.', '2025-12-09'),
  ('wheat', 'Ukraine',        2025, 14.50, 'MMT',  6.6, 'USDA WASDE-666 Dec 2025, TY2025/26 proj.', '2025-12-09')
ON CONFLICT (commodity, country, year) DO UPDATE
  SET value = EXCLUDED.value, share_pct = EXCLUDED.share_pct,
      source = EXCLUDED.source, as_of = EXCLUDED.as_of;

-- Crude oil — ITC Trade Map via WTEx, 2024, export value basis, world
-- US$1.259tn. Sanctioned exporters (Iran, Venezuela) underreport in
-- official trade statistics — stated, not smoothed.
INSERT INTO commodity_export_shares (commodity, country, year, value, unit, share_pct, source, as_of, notes) VALUES
  ('oil', 'Saudi Arabia',         2024, 191.1, 'USD bn', 15.2, 'ITC Trade Map (via WTEx), 2024, export value', '2025-10-25', NULL),
  ('oil', 'Russia',               2024, 122.5, 'USD bn',  9.7, 'ITC Trade Map (via WTEx), 2024, export value', '2025-10-25', 'sanctioned flows underreported'),
  ('oil', 'United States',        2024, 118.5, 'USD bn',  9.4, 'ITC Trade Map (via WTEx), 2024, export value', '2025-10-25', NULL),
  ('oil', 'United Arab Emirates', 2024, 114.9, 'USD bn',  9.1, 'ITC Trade Map (via WTEx), 2024, export value', '2025-10-25', NULL),
  ('oil', 'Canada',               2024, 107.5, 'USD bn',  8.5, 'ITC Trade Map (via WTEx), 2024, export value', '2025-10-25', NULL),
  ('oil', 'Iraq',                 2024,  98.4, 'USD bn',  7.8, 'ITC Trade Map (via WTEx), 2024, export value', '2025-10-25', NULL),
  ('oil', 'Norway',               2024,  49.7, 'USD bn',  4.0, 'ITC Trade Map (via WTEx), 2024, export value', '2025-10-25', NULL)
ON CONFLICT (commodity, country, year) DO UPDATE
  SET value = EXCLUDED.value, share_pct = EXCLUDED.share_pct,
      source = EXCLUDED.source, as_of = EXCLUDED.as_of, notes = EXCLUDED.notes;

-- Natural gas — EIA-derived compilation (energtx), 2024, volume basis,
-- world 1,240.6 bcm (pipeline + LNG).
INSERT INTO commodity_export_shares (commodity, country, year, value, unit, share_pct, source, as_of) VALUES
  ('gas', 'United States', 2024, 218.24, 'bcm', 17.6, 'EIA-derived (energtx), 2024, pipeline+LNG volume', '2026-08-09'),
  ('gas', 'Russia',        2024, 148.41, 'bcm', 12.0, 'EIA-derived (energtx), 2024, pipeline+LNG volume', '2026-08-09'),
  ('gas', 'Norway',        2024, 126.04, 'bcm', 10.2, 'EIA-derived (energtx), 2024, pipeline+LNG volume', '2026-08-09'),
  ('gas', 'Qatar',         2024, 125.69, 'bcm', 10.1, 'EIA-derived (energtx), 2024, pipeline+LNG volume', '2026-08-09'),
  ('gas', 'Australia',     2024, 105.90, 'bcm',  8.5, 'EIA-derived (energtx), 2024, pipeline+LNG volume', '2026-08-09')
ON CONFLICT (commodity, country, year) DO UPDATE
  SET value = EXCLUDED.value, share_pct = EXCLUDED.share_pct,
      source = EXCLUDED.source, as_of = EXCLUDED.as_of;

-- ─── 4 · Copper (USGS MCS 2026, Feb 2026; 2025 estimates) ────────
-- Mine production, thousand t → t; world total 23,000 kt.
INSERT INTO mineral_production (mineral, country, year, production_tonnes, share_pct, source, as_of) VALUES
  ('copper', 'Chile',            2025, 5300000, 23.0, 'USGS Mineral Commodity Summaries 2026 (2025 est.)', '2026-02-01'),
  ('copper', 'Congo (Kinshasa)', 2025, 3200000, 13.9, 'USGS Mineral Commodity Summaries 2026 (2025 est.)', '2026-02-01'),
  ('copper', 'Peru',             2025, 2700000, 11.7, 'USGS Mineral Commodity Summaries 2026 (2025 est.)', '2026-02-01'),
  ('copper', 'China',            2025, 1800000,  7.8, 'USGS Mineral Commodity Summaries 2026 (2025 est.)', '2026-02-01'),
  ('copper', 'Russia',           2025, 1300000,  5.7, 'USGS Mineral Commodity Summaries 2026 (2025 est.)', '2026-02-01'),
  ('copper', 'United States',    2025, 1000000,  4.3, 'USGS Mineral Commodity Summaries 2026 (2025 est.)', '2026-02-01')
ON CONFLICT (mineral, country, year) DO UPDATE
  SET production_tonnes = EXCLUDED.production_tonnes, share_pct = EXCLUDED.share_pct,
      source = EXCLUDED.source, as_of = EXCLUDED.as_of;

-- Refinery production share; world 29,000 kt (2025e).
INSERT INTO mineral_refining_share (mineral, country, year, share_pct, source) VALUES
  ('copper', 'China',            2025, 48.3, 'USGS MCS 2026 refinery production (2025 est.)'),
  ('copper', 'Congo (Kinshasa)', 2025,  9.7, 'USGS MCS 2026 refinery production (2025 est.)'),
  ('copper', 'Chile',            2025,  5.9, 'USGS MCS 2026 refinery production (2025 est.)'),
  ('copper', 'Japan',            2025,  4.8, 'USGS MCS 2026 refinery production (2025 est.)')
ON CONFLICT (mineral, country, year) DO UPDATE
  SET share_pct = EXCLUDED.share_pct, source = EXCLUDED.source;

-- ─── Verification (run after applying) ───────────────────────────
-- SELECT 'export_shares' t, commodity, count(*) FROM commodity_export_shares GROUP BY 1,2
-- UNION ALL SELECT 'copper_prod', mineral, count(*) FROM mineral_production WHERE mineral='copper' GROUP BY 1,2
-- UNION ALL SELECT 'copper_ref', mineral, count(*) FROM mineral_refining_share WHERE mineral='copper' GROUP BY 1,2
-- UNION ALL SELECT 'shipments', 'all', count(*) FROM commodity_shipments GROUP BY 1,2;
-- Expected: wheat 7 · oil 7 · gas 5 · copper_prod 6 · copper_ref 4 · shipments 0.
