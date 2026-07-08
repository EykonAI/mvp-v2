-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 079 · Critical Minerals + Commodities grounding (P2b)
--
-- The Critical Minerals workspace has been 100% fixture-backed
-- (lib/fixtures/mineral_supply.json). This migration creates the
-- five tables of the minerals/commodities data layer and seeds the
-- three annual-cadence ones from cited public sources:
--
--   mineral_production     — SEEDED · USGS Mineral Commodity
--     Summaries 2026 (Feb 2026), 2025 mine production + reserves.
--   mineral_refining_share — SEEDED · IEA Global Critical Minerals
--     Outlook 2025 (May 2025), 2024 refining/processing shares.
--   mines_curated          — SEEDED · curated top mines per mineral
--     (operator reports / USGS), approximate share of world output.
--
--   mineral_trade_flows    — EMPTY · UN Comtrade ingest lands in a
--     sibling P2b PR; schema here is the CONTRACT.
--   commodity_prices       — EMPTY · price ingest lands in a
--     sibling P2b PR; schema here is the CONTRACT.
--
-- share_pct / tonnage_pct are stored as PERCENT values (74 = 74%),
-- not fractions. Seed figures are rounded — mine-level tonnage_pct
-- is approximate and every row carries its source; rows where a
-- defensible number could not be verified carry NULL, not a guess.
--
-- Additive. RLS ON, NO permissive policy — tables are reachable ONLY
-- via the service-role API (createServerSupabase), like the COMM and
-- newsjack tables. Apply MANUALLY in the Supabase SQL Editor BEFORE
-- merge.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1 · Annual mine production + reserves (USGS MCS) ───────────
CREATE TABLE IF NOT EXISTS mineral_production (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mineral           text NOT NULL,          -- slug: cobalt | lithium | nickel | graphite | ree
  country           text NOT NULL,
  year              int NOT NULL,
  production_tonnes numeric,                -- metric tons, contained metal (REE: REO equivalent)
  share_pct         numeric,                -- percent of world total (74 = 74%)
  reserves_tonnes   numeric,
  source            text NOT NULL,
  as_of             date,
  created_at        timestamptz DEFAULT now(),
  UNIQUE (mineral, country, year)
);
ALTER TABLE mineral_production ENABLE ROW LEVEL SECURITY;

-- ─── 2 · Refining / processing share (IEA GCMO) ─────────────────
CREATE TABLE IF NOT EXISTS mineral_refining_share (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mineral    text NOT NULL,                 -- slug: cobalt | lithium | nickel | graphite | ree
  country    text NOT NULL,
  year       int NOT NULL,
  share_pct  numeric NOT NULL,              -- percent of world refined output (78 = 78%)
  source     text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (mineral, country, year)
);
ALTER TABLE mineral_refining_share ENABLE ROW LEVEL SECURITY;

-- ─── 3 · Curated top mines per mineral ──────────────────────────
CREATE TABLE IF NOT EXISTS mines_curated (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mineral     text NOT NULL,                -- workspace slug (cobalt … terbium)
  name        text NOT NULL,
  country     text NOT NULL,                -- ISO2
  owner       text,
  tonnage_pct numeric,                      -- approx percent of world output (17 = 17%); NULL = not published
  status      text CHECK (status IN ('running','permit-review','suspended','expansion')),
  source_url  text,
  as_of       date,
  notes       text,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (mineral, name)
);
ALTER TABLE mines_curated ENABLE ROW LEVEL SECURITY;

-- ─── 4 · UN Comtrade trade flows (CONTRACT — ingest in sibling PR) ─
CREATE TABLE IF NOT EXISTS mineral_trade_flows (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hs_code      text NOT NULL,
  mineral      text,
  reporter     text NOT NULL,
  partner      text NOT NULL,
  flow         text NOT NULL CHECK (flow IN ('export','import')),
  period       text NOT NULL,               -- e.g. '2025' or '202512'
  value_usd    numeric,
  netweight_kg numeric,
  source       text NOT NULL DEFAULT 'un_comtrade',
  fetched_at   timestamptz DEFAULT now(),
  UNIQUE (hs_code, reporter, partner, flow, period)
);
ALTER TABLE mineral_trade_flows ENABLE ROW LEVEL SECURITY;

-- ─── 5 · Commodity price series (CONTRACT — ingest in sibling PR) ─
CREATE TABLE IF NOT EXISTS commodity_prices (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity  text NOT NULL,
  period     date NOT NULL,
  price      numeric NOT NULL,
  unit       text,
  source     text NOT NULL,
  fetched_at timestamptz DEFAULT now(),
  UNIQUE (commodity, period, source)
);
ALTER TABLE commodity_prices ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════
-- SEED · mineral_production — USGS Mineral Commodity Summaries 2026
-- (published February 2026; 2025 estimated mine production).
-- https://pubs.usgs.gov/periodicals/mcs2026/mcs2026.pdf
-- Neodymium/dysprosium/terbium are grouped as 'ree' (USGS reports
-- rare earths as REO-equivalent, not per element). Reserves are
-- included only where the printed figure is unambiguous.
-- ═══════════════════════════════════════════════════════════════
INSERT INTO mineral_production (mineral, country, year, production_tonnes, share_pct, reserves_tonnes, source, as_of) VALUES
  -- Cobalt (world total 2025 ≈ 310,000 t contained Co)
  ('cobalt',  'Congo (Kinshasa)', 2025, 230000,  74, 6000000,  'USGS Mineral Commodity Summaries 2026', '2026-02-01'),
  ('cobalt',  'Indonesia',        2025, 44000,   14, 760000,   'USGS Mineral Commodity Summaries 2026', '2026-02-01'),
  ('cobalt',  'Russia',           2025, 7700,    2,  NULL,     'USGS Mineral Commodity Summaries 2026', '2026-02-01'),
  ('cobalt',  'Madagascar',       2025, 3900,    1,  NULL,     'USGS Mineral Commodity Summaries 2026', '2026-02-01'),
  ('cobalt',  'Philippines',      2025, 3700,    1,  260000,   'USGS Mineral Commodity Summaries 2026', '2026-02-01'),
  ('cobalt',  'Australia',        2025, 3700,    1,  NULL,     'USGS Mineral Commodity Summaries 2026', '2026-02-01'),
  -- Lithium (world total 2025 ≈ 290,000 t Li, excl. US withheld)
  ('lithium', 'Australia',        2025, 92000,   32, NULL,     'USGS Mineral Commodity Summaries 2026', '2026-02-01'),
  ('lithium', 'China',            2025, 62000,   21, 4600000,  'USGS Mineral Commodity Summaries 2026', '2026-02-01'),
  ('lithium', 'Chile',            2025, 56000,   19, 9200000,  'USGS Mineral Commodity Summaries 2026', '2026-02-01'),
  ('lithium', 'Zimbabwe',         2025, 28000,   10, 500000,   'USGS Mineral Commodity Summaries 2026', '2026-02-01'),
  ('lithium', 'Argentina',        2025, 23000,   8,  4400000,  'USGS Mineral Commodity Summaries 2026', '2026-02-01'),
  ('lithium', 'Brazil',           2025, 12000,   4,  540000,   'USGS Mineral Commodity Summaries 2026', '2026-02-01'),
  -- Nickel (world total 2025 ≈ 3,900,000 t)
  ('nickel',  'Indonesia',        2025, 2600000, 67, 62000000, 'USGS Mineral Commodity Summaries 2026', '2026-02-01'),
  ('nickel',  'Philippines',      2025, 270000,  7,  4800000,  'USGS Mineral Commodity Summaries 2026', '2026-02-01'),
  ('nickel',  'Russia',           2025, 200000,  5,  8300000,  'USGS Mineral Commodity Summaries 2026', '2026-02-01'),
  ('nickel',  'Canada',           2025, 140000,  4,  2200000,  'USGS Mineral Commodity Summaries 2026', '2026-02-01'),
  ('nickel',  'New Caledonia',    2025, 140000,  4,  7100000,  'USGS Mineral Commodity Summaries 2026', '2026-02-01'),
  ('nickel',  'China',            2025, 120000,  3,  4400000,  'USGS Mineral Commodity Summaries 2026', '2026-02-01'),
  -- Natural graphite (world total 2025 ≈ 1,800,000 t)
  ('graphite','China',            2025, 1400000, 78, 100000000,'USGS Mineral Commodity Summaries 2026', '2026-02-01'),
  ('graphite','Madagascar',       2025, 80000,   4,  27000000, 'USGS Mineral Commodity Summaries 2026', '2026-02-01'),
  ('graphite','Tanzania',         2025, 75000,   4,  18000000, 'USGS Mineral Commodity Summaries 2026', '2026-02-01'),
  ('graphite','Brazil',           2025, 65000,   4,  74000000, 'USGS Mineral Commodity Summaries 2026', '2026-02-01'),
  ('graphite','Mozambique',       2025, 60000,   3,  25000000, 'USGS Mineral Commodity Summaries 2026', '2026-02-01'),
  ('graphite','Russia',           2025, 25000,   1,  14000000, 'USGS Mineral Commodity Summaries 2026', '2026-02-01'),
  -- Rare earths, REO equivalent (world total 2025 ≈ 390,000 t)
  ('ree',     'China',            2025, 270000,  69, 44000000, 'USGS Mineral Commodity Summaries 2026', '2026-02-01'),
  ('ree',     'United States',    2025, 51000,   13, 1900000,  'USGS Mineral Commodity Summaries 2026', '2026-02-01'),
  ('ree',     'Australia',        2025, 29000,   7,  NULL,     'USGS Mineral Commodity Summaries 2026', '2026-02-01'),
  ('ree',     'Burma',            2025, 22000,   6,  NULL,     'USGS Mineral Commodity Summaries 2026', '2026-02-01'),
  ('ree',     'Thailand',         2025, 4800,    1,  NULL,     'USGS Mineral Commodity Summaries 2026', '2026-02-01'),
  ('ree',     'India',            2025, 2900,    1,  NULL,     'USGS Mineral Commodity Summaries 2026', '2026-02-01')
ON CONFLICT (mineral, country, year) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- SEED · mineral_refining_share — IEA Global Critical Minerals
-- Outlook 2025 (May 2025; 2024 refined-output shares by geography).
-- https://iea.blob.core.windows.net/assets/ef5e9b70-3374-4caa-ba9d-19c72253bfc4/GlobalCriticalMineralsOutlook2025.pdf
--   cobalt  "China remains the leading cobalt refiner … 78% of the market in 2024"
--   lithium "China … producing 70% of global lithium chemicals"
--   nickel  "Indonesia is the top nickel refining location by geography with
--            almost 45% of global production" (China ≈ 30% by geography)
--   graphite "China produces over 95% of battery-grade graphite" (95 = floor)
--   ree     "China's share in refined output falls from 91% today …"
-- ═══════════════════════════════════════════════════════════════
INSERT INTO mineral_refining_share (mineral, country, year, share_pct, source) VALUES
  ('cobalt',   'China',     2024, 78, 'IEA Global Critical Minerals Outlook 2025'),
  ('lithium',  'China',     2024, 70, 'IEA Global Critical Minerals Outlook 2025'),
  ('nickel',   'Indonesia', 2024, 45, 'IEA Global Critical Minerals Outlook 2025'),
  ('nickel',   'China',     2024, 30, 'IEA Global Critical Minerals Outlook 2025'),
  ('graphite', 'China',     2024, 95, 'IEA Global Critical Minerals Outlook 2025'),
  ('ree',      'China',     2024, 91, 'IEA Global Critical Minerals Outlook 2025')
ON CONFLICT (mineral, country, year) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- SEED · mines_curated — top mines per workspace mineral.
-- tonnage_pct = approximate percent of world output (rounded, from
-- operator production reports vs USGS MCS 2026 world totals); NULL
-- where no defensible mine-level figure is published. Heavy-REE rows
-- are duplicated under dysprosium and terbium so the workspace
-- selector finds them.
-- ═══════════════════════════════════════════════════════════════
INSERT INTO mines_curated (mineral, name, country, owner, tonnage_pct, status, source_url, as_of, notes) VALUES
  -- Cobalt
  ('cobalt', 'Kisanfu (KFM)',          'CD', 'CMOC (71.25%)',              20,   'running', 'https://en.cmoc.com/html/Business/Congo-Cu-Co/', '2026-02-01', 'CMOC FY2025 combined TFM+KFM cobalt 117.5 kt (~38% of world); TFM/KFM split approximate.'),
  ('cobalt', 'Tenke Fungurume (TFM)',  'CD', 'CMOC (80%)',                 17,   'running', 'https://en.cmoc.com/html/Business/Congo-Cu-Co/', '2026-02-01', 'CMOC FY2025 combined TFM+KFM cobalt 117.5 kt (~38% of world); TFM/KFM split approximate.'),
  ('cobalt', 'Kamoto (KCC)',           'CD', 'Glencore',                   6,    'running', 'https://www.glencore.com/investors/reports-results', '2026-02-01', 'Approximate; Glencore production reports.'),
  ('cobalt', 'Metalkol RTR',           'CD', 'Eurasian Resources Group',   6,    'running', 'https://pubs.usgs.gov/periodicals/mcs2026/mcs2026-cobalt.pdf', '2026-02-01', 'Tailings reprocessing; approximate.'),
  ('cobalt', 'Mutanda',                'CD', 'Glencore',                   5,    'running', 'https://www.glencore.com/investors/reports-results', '2026-02-01', 'Approximate; restarted 2022 after 2019-21 care & maintenance.'),
  ('cobalt', 'Huayue Nickel Cobalt (HPAL)', 'ID', 'Huayou / Tsingshan JV', 2,    'running', 'https://pubs.usgs.gov/periodicals/mcs2026/mcs2026-cobalt.pdf', '2026-02-01', 'Cobalt by-product of Indonesian nickel HPAL; Indonesia total 44 kt (14% of world).'),
  -- Lithium (shares of ~290 kt Li world total, 2025)
  ('lithium', 'Greenbushes',              'AU', 'Talison (Tianqi/IGO + Albemarle)', 13, 'running', 'https://pubs.usgs.gov/periodicals/mcs2026/mcs2026-lithium.pdf', '2026-02-01', '~1.4-1.5 Mt/y spodumene concentrate ≈ high-30s kt contained Li; share approximate.'),
  ('lithium', 'Salar de Atacama — SQM',   'CL', 'SQM',                      12,   'running', 'https://www.sqm.com/en/', '2026-02-01', '~180 kt/y LCE ≈ ~34 kt Li; share approximate.'),
  ('lithium', 'Pilgangoora',              'AU', 'Pilbara Minerals (PLS)',   6,    'running', 'https://pubs.usgs.gov/periodicals/mcs2026/mcs2026-lithium.pdf', '2026-02-01', 'Share approximate from operator spodumene shipments.'),
  ('lithium', 'Wodgina',                  'AU', 'Mineral Resources / Albemarle', 4, 'running', 'https://pubs.usgs.gov/periodicals/mcs2026/mcs2026-lithium.pdf', '2026-02-01', 'Share approximate.'),
  ('lithium', 'Salar de Atacama — Albemarle', 'CL', 'Albemarle',            3,    'running', 'https://www.albemarle.com/', '2026-02-01', '~50 kt/y LCE ≈ ~9 kt Li; share approximate.'),
  ('lithium', 'Mount Marion',             'AU', 'Mineral Resources / Ganfeng', 3, 'running', 'https://pubs.usgs.gov/periodicals/mcs2026/mcs2026-lithium.pdf', '2026-02-01', 'Share approximate.'),
  ('lithium', 'Bikita',                   'ZW', 'Sinomine',                 3,    'running', 'https://pubs.usgs.gov/periodicals/mcs2026/mcs2026-lithium.pdf', '2026-02-01', 'Zimbabwe total 28 kt Li (10% of world); per-mine split approximate.'),
  ('lithium', 'Arcadia',                  'ZW', 'Huayou Cobalt',            3,    'running', 'https://pubs.usgs.gov/periodicals/mcs2026/mcs2026-lithium.pdf', '2026-02-01', 'Zimbabwe total 28 kt Li (10% of world); per-mine split approximate.'),
  ('lithium', 'Thacker Pass',             'US', 'Lithium Americas / GM',    NULL, 'expansion', 'https://lithiumamericas.com/', '2026-02-01', 'Phase 1 under construction; no commercial production yet.'),
  -- Nickel (shares of ~3.9 Mt world total, 2025)
  ('nickel', 'Weda Bay',            'ID', 'Tsingshan / Eramet JV',     13,   'running', 'https://www.eramet.com/en/', '2026-02-01', 'Largest nickel mine globally; contained Ni in ore; share approximate.'),
  ('nickel', 'Norilsk (Polar Division)', 'RU', 'Nornickel',            5,    'running', 'https://pubs.usgs.gov/periodicals/mcs2026/mcs2026-nickel.pdf', '2026-02-01', 'Russia total 200 kt (5% of world); Norilsk is the bulk of it.'),
  ('nickel', 'Sorowako',            'ID', 'PT Vale Indonesia',         2,    'running', 'https://pubs.usgs.gov/periodicals/mcs2026/mcs2026-nickel.pdf', '2026-02-01', 'Share approximate.'),
  ('nickel', 'Obi Island HPAL',     'ID', 'Harita Nickel',             2,    'running', 'https://pubs.usgs.gov/periodicals/mcs2026/mcs2026-nickel.pdf', '2026-02-01', 'Share approximate.'),
  ('nickel', 'Sudbury operations',  'CA', 'Vale Base Metals',          2,    'running', 'https://pubs.usgs.gov/periodicals/mcs2026/mcs2026-nickel.pdf', '2026-02-01', 'Canada total 140 kt (4% of world); share approximate.'),
  ('nickel', 'Goro',                'NC', 'Prony Resources',           1,    'running', 'https://pubs.usgs.gov/periodicals/mcs2026/mcs2026-nickel.pdf', '2026-02-01', 'New Caledonia total 140 kt (4% of world).'),
  -- Natural graphite (shares of ~1.8 Mt world total, 2025)
  ('graphite', 'Heilongjiang cluster (Luobei/Hegang)', 'CN', 'China Minmetals / BTR et al.', NULL, 'running', 'https://pubs.usgs.gov/periodicals/mcs2026/mcs2026-graphite.pdf', '2026-02-01', 'China mined 1.4 Mt (78% of world natural graphite); reliable mine-level split not published.'),
  ('graphite', 'Balama',            'MZ', 'Syrah Resources',           3,    'running', 'https://www.syrahresources.com.au/', '2026-02-01', 'Force majeure Dec 2024 (civil unrest); restarted Jul 2025; nameplate 350 kt/y.'),
  ('graphite', 'Molo',              'MG', 'NextSource Materials',      NULL, 'running', 'https://pubs.usgs.gov/periodicals/mcs2026/mcs2026-graphite.pdf', '2026-02-01', 'Ramp-up; Madagascar total 80 kt (4% of world).'),
  ('graphite', 'Lindi Jumbo',       'TZ', 'Walkabout Resources',       NULL, 'running', 'https://pubs.usgs.gov/periodicals/mcs2026/mcs2026-graphite.pdf', '2026-02-01', 'Tanzania total 75 kt (4% of world).'),
  -- Neodymium (light REE; shares are of world REO output, 2025)
  ('neodymium', 'Bayan Obo',        'CN', 'China Northern Rare Earth (Baogang)', 45, 'running', 'https://pubs.usgs.gov/periodicals/mcs2026/mcs2026-rare-earths.pdf', '2026-02-01', 'Largest REE mine; light REE (Nd-Pr) dominant; share approximate of world REO.'),
  ('neodymium', 'Mountain Pass',    'US', 'MP Materials',              13,   'running', 'https://mpmaterials.com/', '2026-02-01', 'US produced 51 kt REO in 2025 (13% of world), effectively all from Mountain Pass.'),
  ('neodymium', 'Mount Weld',       'AU', 'Lynas Rare Earths',         7,    'running', 'https://lynasrareearths.com/', '2026-02-01', 'Australia 29 kt REO in 2025 (7% of world), predominantly Mount Weld.'),
  -- Dysprosium / Terbium (heavy REE — ion-adsorption clays)
  ('dysprosium', 'Southern China ion-adsorption clays', 'CN', 'China Rare Earth Group', NULL, 'running', 'https://pubs.usgs.gov/periodicals/mcs2026/mcs2026-rare-earths.pdf', '2026-02-01', 'Principal global source of heavy REE (Dy/Tb); quota-managed; mine-level data not published.'),
  ('dysprosium', 'Kachin ion-adsorption mines', 'MM', 'Various (feedstock to China)', NULL, 'running', 'https://pubs.usgs.gov/periodicals/mcs2026/mcs2026-rare-earths.pdf', '2026-02-01', 'Burma 22 kt REO (6% of world); major heavy-REE feedstock; supply conflict-disrupted.'),
  ('terbium', 'Southern China ion-adsorption clays', 'CN', 'China Rare Earth Group', NULL, 'running', 'https://pubs.usgs.gov/periodicals/mcs2026/mcs2026-rare-earths.pdf', '2026-02-01', 'Principal global source of heavy REE (Dy/Tb); quota-managed; mine-level data not published.'),
  ('terbium', 'Kachin ion-adsorption mines', 'MM', 'Various (feedstock to China)', NULL, 'running', 'https://pubs.usgs.gov/periodicals/mcs2026/mcs2026-rare-earths.pdf', '2026-02-01', 'Burma 22 kt REO (6% of world); major heavy-REE feedstock; supply conflict-disrupted.')
ON CONFLICT (mineral, name) DO NOTHING;
