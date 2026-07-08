-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 080 · Sentinel-2 imagery + mineral shipments (P2c)
--
-- Grounds the Critical Minerals "05 Sentinel-2 Stockpile Imagery"
-- panel (currently decorative mock tiles) and gives the shipment-
-- derivation sibling its data layer. Four pieces:
--
--   mines_curated lat/lon  — SEEDED · verified coordinates for the
--     32 curated mines (sources per row below); the Sentinel cron
--     images every mine that has a coordinate. 3 rows stay NULL
--     where no defensible site coordinate is published.
--   sentinel_tiles         — FILLED by cron · one row per AOI per
--     acquisition; monthly ingest-sentinel-tiles cron (CDSE
--     Sentinel Hub Process + Statistical APIs).
--   mineral_shipments      — EMPTY · CONTRACT for the sibling
--     shipment-derivation cron (AIS destination matching).
--   mineral_route_map      — SEEDED · ~10 verified mineral trade
--     routes; keywords are UPPERCASE because they match raw AIS
--     destination strings, which are uppercase and messy. Live AIS
--     data skews to UN/LOCODE forms ("CNTAO", "AU PHE"), so every
--     port carries BOTH its name and LOCODE (spaced + unspaced).
--
-- Storage: a public 'sentinel' bucket for the PNG chips. If the
-- INSERT into storage.buckets is not permitted in the SQL editor,
-- fallback: create a PUBLIC bucket named 'sentinel' in the Supabase
-- dashboard (Storage → New bucket) — same result.
--
-- Additive. RLS ON, NO permissive policy — tables are reachable ONLY
-- via the service-role API (createServerSupabase), like the 079
-- minerals tables. Apply MANUALLY in the Supabase SQL Editor BEFORE
-- merge.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1 · Mine coordinates (Sentinel-2 AOIs) ─────────────────────
ALTER TABLE mines_curated
  ADD COLUMN IF NOT EXISTS latitude  double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision;

-- Verified coordinates, ~3-decimal precision (≈100 m — well inside
-- the cron's ~2 km imaging bbox). Source noted per statement.
-- 29 of 32 rows seeded; NULL rows listed at the bottom.

-- Cobalt (DRC/Indonesia)
UPDATE mines_curated SET latitude = -10.776, longitude = 25.975
  WHERE mineral = 'cobalt' AND name = 'Kisanfu (KFM)';          -- China-Africa mining registry: -10.7756, 25.9753
UPDATE mines_curated SET latitude = -10.580, longitude = 26.190
  WHERE mineral = 'cobalt' AND name = 'Tenke Fungurume (TFM)';  -- Kwatebala pit (mindat): -10.5795, 26.1901
UPDATE mines_curated SET latitude = -10.715, longitude = 25.386
  WHERE mineral = 'cobalt' AND name = 'Kamoto (KCC)';           -- Wikipedia: 10°42'53"S 25°23'08"E
UPDATE mines_curated SET latitude = -10.712, longitude = 25.397
  WHERE mineral = 'cobalt' AND name = 'Metalkol RTR';           -- Wikipedia (Kolwezi tailings): -10.7116, 25.3966
UPDATE mines_curated SET latitude = -10.786, longitude = 25.808
  WHERE mineral = 'cobalt' AND name = 'Mutanda';                -- latitude.to/mindat: -10.7858, 25.8082
UPDATE mines_curated SET latitude = -2.826, longitude = 122.155
  WHERE mineral = 'cobalt' AND name = 'Huayue Nickel Cobalt (HPAL)'; -- IMIP, Bahodopi (mapcarta): -2.8256, 122.1554

-- Lithium (AU/CL/ZW/US)
UPDATE mines_curated SET latitude = -33.863, longitude = 116.056
  WHERE mineral = 'lithium' AND name = 'Greenbushes';           -- mine centre (mindat/Wikipedia): -33.86286, 116.05580
UPDATE mines_curated SET latitude = -23.500, longitude = -68.350
  WHERE mineral = 'lithium' AND name = 'Salar de Atacama — SQM'; -- centre of SQM evaporation-pond complex (documented satellite refs -23.47..-23.55, -68.31..-68.41)
UPDATE mines_curated SET latitude = -21.056, longitude = 118.905
  WHERE mineral = 'lithium' AND name = 'Pilgangoora';           -- -21.05588, 118.905
UPDATE mines_curated SET latitude = -21.181, longitude = 118.675
  WHERE mineral = 'lithium' AND name = 'Wodgina';               -- Mount Cassiterite: -21.1811, 118.6752
UPDATE mines_curated SET latitude = -23.640, longitude = -68.330
  WHERE mineral = 'lithium' AND name = 'Salar de Atacama — Albemarle'; -- southern (Albemarle) pond complex, documented satellite ref -23.64, -68.33
UPDATE mines_curated SET latitude = -31.056, longitude = 121.440
  WHERE mineral = 'lithium' AND name = 'Mount Marion';          -- Mount Marion pegmatites (mindat): -31.05639, 121.43974
UPDATE mines_curated SET latitude = -19.963, longitude = 31.428
  WHERE mineral = 'lithium' AND name = 'Bikita';                -- Bikita pegmatite (mindat): -19.96318, 31.42776
-- Arcadia: NULL — "38 km east of Harare, Goromonzi" is documented,
-- but no public site coordinate could be verified; left unseeded.
UPDATE mines_curated SET latitude = 41.708, longitude = -118.055
  WHERE mineral = 'lithium' AND name = 'Thacker Pass';          -- Wikipedia: 41.7084, -118.0548

-- Nickel (ID/RU/CA/NC)
UPDATE mines_curated SET latitude = 0.472, longitude = 127.948
  WHERE mineral = 'nickel' AND name = 'Weda Bay';               -- mindat: 0.47158, 127.94775 (Lelilef, Halmahera)
UPDATE mines_curated SET latitude = 69.487, longitude = 88.397
  WHERE mineral = 'nickel' AND name = 'Norilsk (Polar Division)'; -- Talnakh (69.4865, 88.3972) — the mining centre of the Polar Division; mines ring the town
UPDATE mines_curated SET latitude = -2.520, longitude = 121.358
  WHERE mineral = 'nickel' AND name = 'Sorowako';               -- 2°31'13"S 121°21'27"E
UPDATE mines_curated SET latitude = -1.546, longitude = 127.412
  WHERE mineral = 'nickel' AND name = 'Obi Island HPAL';        -- Kawasi, Obi west coast (mindat): -1.54580, 127.41227
UPDATE mines_curated SET latitude = 46.456, longitude = -81.174
  WHERE mineral = 'nickel' AND name = 'Sudbury operations';     -- Creighton mine (deepest of the Vale Sudbury complex): 46.4558, -81.1738
UPDATE mines_curated SET latitude = -22.336, longitude = 166.912
  WHERE mineral = 'nickel' AND name = 'Goro';                   -- Wikipedia: 22°20'10"S 166°54'43"E

-- Graphite (CN/MZ/MG/TZ)
-- Heilongjiang cluster (Luobei/Hegang): NULL — cluster row; only a
-- county-level coordinate is published, too coarse for a 2 km chip.
UPDATE mines_curated SET latitude = -13.306, longitude = 38.658
  WHERE mineral = 'graphite' AND name = 'Balama';               -- DFC ESIA: -13.3056, 38.65797
UPDATE mines_curated SET latitude = -23.998, longitude = 44.149
  WHERE mineral = 'graphite' AND name = 'Molo';                 -- feasibility study UTM 38S 413390E 7345713N → WGS84
-- Lindi Jumbo: NULL — "Ruangwa District, ~200 km from Mtwara" is
-- documented, but no public site coordinate could be verified.

-- REE (CN/US/AU/MM)
UPDATE mines_curated SET latitude = 41.783, longitude = 110.000
  WHERE mineral = 'neodymium' AND name = 'Bayan Obo';           -- Bayan Obo mining district: 41.7833, 110.0000
UPDATE mines_curated SET latitude = 35.481, longitude = -115.528
  WHERE mineral = 'neodymium' AND name = 'Mountain Pass';       -- 35.4810, -115.5280
UPDATE mines_curated SET latitude = -28.856, longitude = 122.542
  WHERE mineral = 'neodymium' AND name = 'Mount Weld';          -- -28.8560, 122.5420
UPDATE mines_curated SET latitude = 24.750, longitude = 114.867
  WHERE name = 'Southern China ion-adsorption clays';           -- representative site: Zudong mine, Longnan Co. (USGS MRDS rec 323: 24.75, 114.86667); dysprosium + terbium rows
UPDATE mines_curated SET latitude = 25.833, longitude = 98.417
  WHERE name = 'Kachin ion-adsorption mines';                   -- Chipwi township centroid (25.8333, 98.4167) — sites are diffuse across Chipwi/Pangwa; chips indicative only; dysprosium + terbium rows

-- ─── 2 · Sentinel-2 chips per AOI per acquisition ───────────────
-- Written by the monthly ingest-sentinel-tiles cron. index_name /
-- index_mean is a bare-soil proxy (v1: NDVI mean over the bbox —
-- LOWER vegetation ≈ MORE disturbed/stockpile ground); change_pct
-- compares against the previous stored tile for the same aoi_ref.
CREATE TABLE IF NOT EXISTS sentinel_tiles (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aoi_kind         text CHECK (aoi_kind IN ('mine','port')),
  aoi_ref          text NOT NULL,           -- mine slug (or port ref)
  mineral          text,                    -- workspace slug, when the AOI is a mine
  latitude         double precision NOT NULL,
  longitude        double precision NOT NULL,
  acquisition_date date NOT NULL,           -- Sentinel-2 sensing date
  image_url        text,                    -- public URL of the PNG chip
  storage_path     text,                    -- path inside the 'sentinel' bucket
  index_name       text,                    -- e.g. 'ndvi_mean_v1'
  index_mean       numeric,
  prev_mean        numeric,
  change_pct       numeric,
  captured_at      timestamptz DEFAULT now(),
  UNIQUE (aoi_ref, acquisition_date)
);
ALTER TABLE sentinel_tiles ENABLE ROW LEVEL SECURITY;

-- ─── 3 · Derived mineral shipments (CONTRACT — sibling PR) ──────
-- Filled by the shipment-derivation cron: AIS positions/destinations
-- matched against mineral_route_map keywords.
CREATE TABLE IF NOT EXISTS mineral_shipments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mmsi           text NOT NULL,
  vessel_name    text,
  flag           text,
  mineral        text NOT NULL,             -- workspace slug
  origin_port    text,
  origin_country text,
  dest_hint      text,                      -- raw AIS destination that matched
  dwt            numeric,
  inferred_from  text NOT NULL,             -- e.g. 'ais_destination'
  first_seen     timestamptz NOT NULL DEFAULT now(),
  last_seen      timestamptz NOT NULL DEFAULT now(),
  status         text NOT NULL DEFAULT 'underway'
                   CHECK (status IN ('underway','arrived','stale')),
  UNIQUE (mmsi, mineral, dest_hint)
);
ALTER TABLE mineral_shipments ENABLE ROW LEVEL SECURITY;

-- ─── 4 · Mineral trade-route keyword map ────────────────────────
-- Keywords match raw AIS destination strings: UPPERCASE, messy, and
-- skewed toward UN/LOCODE forms — every port carries name + LOCODE
-- (spaced and unspaced variants for the common ones).
CREATE TABLE IF NOT EXISTS mineral_route_map (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mineral         text NOT NULL,            -- workspace slug
  origin_country  text,                     -- ISO2
  origin_keywords text[] NOT NULL,
  dest_keywords   text[] NOT NULL,
  notes           text
);
ALTER TABLE mineral_route_map ENABLE ROW LEVEL SECURITY;

INSERT INTO mineral_route_map (mineral, origin_country, origin_keywords, dest_keywords, notes) VALUES
  -- DRC cobalt hydroxide is trucked to Durban / Dar es Salaam / Beira
  -- and ships to Chinese refiners (CMOC, Huayou et al.).
  ('cobalt', 'CD',
    '{DURBAN,ZADUR,"ZA DUR","DAR ES SALAAM",TZDAR,"TZ DAR",BEIRA,MZBEW}',
    '{SHANGHAI,CNSHA,TIANJIN,CNTXG,CNTSN,NINGBO,CNNGB,QINGDAO,CNTAO,"CN TAO"}',
    'DRC cobalt hydroxide exits via ZA/TZ/MZ ports → China refining (~all DRC output refined in CN).'),
  -- WA spodumene concentrate → Chinese/Korean converters.
  ('lithium', 'AU',
    '{"PORT HEDLAND",AUPHE,"AU PHE",KWINANA,AUKWI,"AU KWI",BUNBURY,AUBUY,FREMANTLE,AUFRE}',
    '{SHANGHAI,CNSHA,NINGBO,CNNGB,QINGDAO,CNTAO,LIANYUNGANG,CNLYG,BUSAN,KRPUS,"KR PUS",GWANGYANG}',
    'WA spodumene (Greenbushes via Bunbury; Pilgangoora/Wodgina via Port Hedland) → CN/KR converters.'),
  -- Chilean brine chemicals ship from Antofagasta/Mejillones.
  ('lithium', 'CL',
    '{ANTOFAGASTA,CLANF,MEJILLONES,CLMJS}',
    '{SHANGHAI,CNSHA,NINGBO,CNNGB,BUSAN,KRPUS,YOKOHAMA,JPYOK}',
    'SQM/Albemarle lithium carbonate/hydroxide ex Antofagasta bay ports → CN/KR/JP cathode makers.'),
  -- Zimbabwe spodumene/petalite is trucked to Mozambican + SA ports.
  ('lithium', 'ZW',
    '{BEIRA,MZBEW,MAPUTO,MZMPM,DURBAN,ZADUR,"ZA DUR"}',
    '{SHANGHAI,CNSHA,NINGBO,CNNGB,QINGDAO,CNTAO,LIANYUNGANG,CNLYG}',
    'Bikita/Arcadia concentrates exit via Beira/Maputo/Durban → China (Sinomine, Huayou).'),
  -- Indonesian nickel intermediates (matte/MHP) → China.
  ('nickel', 'ID',
    '{MOROWALI,BAHODOPI,LABOTA,IMIP,"WEDA",LELILEF,OBI,KAWASI}',
    '{SHEKOU,CNSHK,"CN SHK",LIANYUNGANG,CNLYG,FANGCHENG,CNFAN,SHANGHAI,CNSHA,TIANJIN,CNTXG}',
    'Morowali/IMIP + Weda Bay + Obi HPAL matte & MHP → Chinese ports; NPI increasingly consumed onshore.'),
  -- New Caledonian ore/NHC ships out of Prony Bay / Noumea.
  ('nickel', 'NC',
    '{NOUMEA,NCNOU,PRONY,"PRONY BAY"}',
    '{SHANGHAI,CNSHA,LIANYUNGANG,CNLYG,BUSAN,KRPUS,GWANGYANG}',
    'Goro NHC/ore ex Prony Bay → CN/KR refiners.'),
  -- Mozambican graphite (Balama bags via Nacala/Pemba).
  ('graphite', 'MZ',
    '{NACALA,MZMNC,PEMBA,MZPOL}',
    '{QINGDAO,CNTAO,"CN TAO",SHANGHAI,CNSHA,LIANYUNGANG,CNLYG,"LOS ANGELES",USLAX}',
    'Syrah Balama flake ex Nacala/Pemba → China anode plants + US (Vidalia feedstock).'),
  -- Tanzanian graphite ships via Mtwara / Dar es Salaam.
  ('graphite', 'TZ',
    '{MTWARA,TZMYW,"DAR ES SALAAM",TZDAR,"TZ DAR"}',
    '{QINGDAO,CNTAO,SHANGHAI,CNSHA,NINGBO,CNNGB}',
    'Lindi Jumbo et al. flake ex Mtwara/Dar → China.'),
  -- Mountain Pass REE concentrate ships ex San Pedro Bay → China.
  ('ree', 'US',
    '{"LOS ANGELES",USLAX,"US LAX","LONG BEACH",USLGB}',
    '{SHANGHAI,CNSHA,TIANJIN,CNTXG,NINGBO,CNNGB}',
    'MP Materials concentrate ex LA/Long Beach → CN separation (declining as US refining onshores).'),
  -- Lynas Mount Weld concentrate → Kuantan (Lynas Malaysia).
  ('ree', 'AU',
    '{FREMANTLE,AUFRE,"AU FRE",GERALDTON,AUGET}',
    '{KUANTAN,MYKUA,"MY KUA"}',
    'Mount Weld concentrate ex Fremantle/Geraldton → Lynas Malaysia (Kuantan).')
;

-- ─── 5 · Public storage bucket for Sentinel-2 chips ─────────────
-- If this INSERT is not permitted in the SQL editor (storage schema
-- ownership varies by project), create a PUBLIC bucket named
-- 'sentinel' in the Supabase dashboard instead — equivalent.
INSERT INTO storage.buckets (id, name, public)
VALUES ('sentinel', 'sentinel', true)
ON CONFLICT (id) DO NOTHING;
