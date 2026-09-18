-- 158 · refineries: country backfill (iso_country + English country name)
--       and a new us_state column, shipped as a static update
--
-- WHY. iso_country is NULL on all 634 refineries and the free-text country on
-- 631 (read 2026-09-18). Anything that filters refineries by country returns
-- zero rows forever — looks alive, isn't. The drafted Reality Check analyst
-- tool (PR-8) filters on upper(iso_country), and
-- firms_monitored_facilities.facility_country = COALESCE(country, iso_country)
-- is NULL for every refinery. The OSM tags the ingest read these from
-- (addr:country, ISO3166-1, addr:country_code) are almost never set.
--
-- WHY NOT geo_regions. Its rows are coarse, overlapping boxes: it places MOL
-- Tiszaújváros (Hungary) in Russia and Maysan in three countries at once.
-- Loading real countries into it is ruled out too: its UNIQUE(slug) collides
-- with the 15 country boxes notification geofencing uses. So the attribution
-- is computed offline against a real boundary set and shipped here as
-- reviewed literal values. Nothing is added to geo_regions.
--
-- SOURCES — Natural Earth 1:10m cultural vectors, GeoJSON distribution
-- (public domain; not committed to the repo):
--   ne_10m_admin_0_countries.geojson          13,287,234 bytes
--     SHA-256 239eec57ac17f100a11e2536cffc56752c318b50ae765b0918ff7aab4ce8f255
--   ne_10m_admin_1_states_provinces.geojson   40,726,851 bytes
--     SHA-256 22d0e3ad85eb3e27f17cabf8ba2d50e554fbc27a87796ff891d958185da62fb5
-- Generator: apps/web/scripts/data/refinery-countries.py (pure Python,
-- standard library only; refuses to run on any other SHA-256). Its inputs
-- were read from production on 2026-09-18 over the read-only connection, and
-- each was md5-matched against the database after transcription. They were
-- 634 refinery points (id, lat, lon at 6 dp, taken from geom, which equals
-- latitude/longitude on every row), the 634 refinery names (comments only)
-- and the 226 distinct power_plants.country spellings.
--
-- RULES
--   iso_country  Natural Earth ISO_A2_EH, never ISO_A2 (ISO_A2 is -99 for
--                France and Norway). Point-in-polygon (ray casting, holes
--                honoured): 596 rows. Points on piers, jetties and reclaimed
--                land that the 1:10m coastline misses take the nearest polygon
--                by great-circle distance to its edges: 38 rows, largest 4.549 km
--                (Pulau Bukom → SG). Maximum allowed 22.224 km (12 nautical
--                miles). Beyond it, or when a second country lies within 1 km of
--                the nearest, a row would stay NULL; none did. 634 of 634
--                resolved, 101 distinct codes, no row inside a Natural Earth
--                feature that carries no code (ISO_A2_EH = -99).
--   country      The English name per ISO code, spelled as power_plants.country
--                spells it, so one filter value matches both facility types in
--                firms_monitored_facilities; Natural Earth NAME only where
--                power_plants has no spelling. All 101 codes have one. Six
--                differ from Natural Earth NAME: BA 'Bosnia and Herzegovina'
--                (NE 'Bosnia and Herz.'), CG 'Republic of the Congo' ('Congo'),
--                CZ 'Czech Republic' ('Czechia'), TR 'Türkiye' ('Turkey'),
--                US 'United States' ('United States of America'),
--                VI 'Virgin Islands (U.S.)' ('U.S. Virgin Is.').
--                The 3 rows that already had a country held an ISO CODE, not a
--                name: way:9882741 Schwechat 'AT', relation:11232067 Burghausen
--                'DE', relation:8167008 Tulsa West 'US'. They are normalised to
--                'Austria' / 'Germany' / 'United States' like every other row.
--                facility_country reads country first, so a filter on 'Austria'
--                would otherwise miss Schwechat.
--   us_state     New column: the USPS two-letter postal code (Natural Earth
--                admin-1 `postal`, checked against iso_3166_2 'US-xx') from the
--                51 US features (50 states + DC), for iso_country = 'US' rows
--                only. NULL on every other row, including Limetree Bay (US
--                Virgin Islands, iso VI). Same point-in-polygon and fallback
--                rule: 116 point-in-polygon, 2 nearest (Marathon Anacortes WA
--                0.185 km, Trainer PA 0.412 km). 118 of 118 US rows, 30 distinct
--                states.
--   Martinique   Natural Earth admin-0 folds the French overseas departments
--                into France, so Raffinerie de la SARA (way:35389033) is
--                FR / 'France'. ISO 3166-1 also has MQ, and power_plants writes
--                'Martinique'. This is stated, not overridden.
--
-- INDEPENDENT CROSS-CHECK (read-only, before shipping). Each refinery was
-- compared with its nearest GEM power plant, an independent dataset. 513
-- refineries have one within 10 km, and 512 of those 513 have the same
-- country; the one difference is SARA (Martinique, above). For 93 US
-- refineries with a plant within 10 km, 91 match on state. The 2 that do not
-- are Newell WV (plant 5.0 km away in Ohio, across the Ohio River) and
-- American Refining Group, Bradford PA (plant 9.7 km away in New York). Both
-- refineries are where this file puts them.
--
-- WHAT THIS MIGRATION DOES
--   1. ADD COLUMN IF NOT EXISTS us_state text, plus two CHECKs, each added only
--      if absent: refineries_us_state_format_chk (^[A-Z]{2}$ or NULL) and
--      refineries_us_state_requires_us_chk (us_state set ⇒ iso_country = 'US').
--   2. One guarded UPDATE ... FROM (VALUES ...) over the 634 ids. A row is
--      written only when a value differs (IS DISTINCT FROM), so a re-run
--      changes nothing. No temp tables, no session state. The row trigger
--      refineries_set_geom_trg fires and rewrites geom from the unchanged
--      latitude/longitude, which leaves it the same.
--   3. VERIFY, below COMMIT: ONE SELECT, because the SQL Editor shows only the
--      last statement's rows. Every row must read ok = true.
--
-- WHAT KEEPS IT. The OSM ingest (app/api/cron/ingest-osm-refineries and
-- scripts/seed-osm-refineries.mjs) upserted country and iso_country from OSM
-- tags ON CONFLICT (id), NULL on almost every row, so a re-ingest would
-- have wiped this backfill. In the same PR both stop sending those columns,
-- and neither ever sends us_state. Rows a later ingest INSERTS arrive with NULL
-- country / iso_country / us_state: re-run the generator for them (PR-11
-- attributes its own sites).
--
-- Apply MANUALLY in the Supabase SQL Editor BEFORE merge. Apply the whole file,
-- not a highlighted selection, and paste back the VERIFY rows. It must land
-- before Wave 1's migrations 159–165.

BEGIN;

ALTER TABLE public.refineries ADD COLUMN IF NOT EXISTS us_state text;

COMMENT ON COLUMN public.refineries.us_state IS
  'USPS two-letter state code (e.g. TX) for iso_country = ''US'' rows, from Natural Earth 1:10m admin-1 (mig 158); NULL elsewhere. Never written by the OSM ingest.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.refineries'::regclass
                    AND conname  = 'refineries_us_state_format_chk') THEN
    ALTER TABLE public.refineries
      ADD CONSTRAINT refineries_us_state_format_chk
      CHECK (us_state ~ '^[A-Z]{2}$' OR us_state IS NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.refineries'::regclass
                    AND conname  = 'refineries_us_state_requires_us_chk') THEN
    ALTER TABLE public.refineries
      ADD CONSTRAINT refineries_us_state_requires_us_chk
      CHECK (us_state IS NULL OR iso_country = 'US');
  END IF;
END
$$;

-- Generated by apps/web/scripts/data/refinery-countries.py — do not hand-edit.
-- 634 rows · 101 distinct iso_country · 118 US rows with us_state · fallback limit 22.224 km, largest used 4.549 km (country) / 0.412 km (state)
UPDATE public.refineries AS r
   SET iso_country = v.iso_country,
       country     = v.country,
       us_state    = v.us_state
  FROM (VALUES
    ('way:352835608'::text, 'AO'::text, 'Angola'::text, NULL::text),  -- Malongo refinery · pip
    ('way:352836937', 'AO', 'Angola', NULL),  -- Refinaria do Lobito · pip
    ('way:50637638', 'AO', 'Angola', NULL),  -- Sonangola Refinaria de Luanda · pip
    ('way:854082406', 'AO', 'Angola', NULL),  -- Refinaria do Lobito · pip
    ('relation:16056724', 'AR', 'Argentina', NULL),  -- Complejo Industrial Plaza Huincul YPF · pip
    ('way:192837459', 'AR', 'Argentina', NULL),  -- YPF - Complejo Industrial Ensenada · pip
    ('way:257809339', 'AR', 'Argentina', NULL),  -- Axion Energy · pip
    ('way:314837488', 'AR', 'Argentina', NULL),  -- Complejo Gasopetrolífero Campo Duran · pip
    ('way:397015862', 'AR', 'Argentina', NULL),  -- Refinería · pip
    ('way:593541991', 'AR', 'Argentina', NULL),  -- PTC - PIAS  Medanito · pip
    ('way:696696585', 'AR', 'Argentina', NULL),  -- Pampa Bío S.A. · pip
    ('way:71780811', 'AR', 'Argentina', NULL),  -- Polo Petroquímico de Bahía Blanca · pip
    ('way:71782952', 'AR', 'Argentina', NULL),  -- Trafigura Argentina - Refinería Ricardo Elicabe · pip
    ('way:796281619', 'AR', 'Argentina', NULL),  -- Salto II power station · pip
    ('way:9882741', 'AT', 'Austria', NULL),  -- OMV Raffinerie Schwechat · pip
    ('way:1154448527', 'AU', 'Australia', NULL),  -- Kwinana Nickel Refinery · pip
    ('way:1227533392', 'AU', 'Australia', NULL),  -- Alpha High Purity Alumina · pip
    ('way:141719786', 'AU', 'Australia', NULL),  -- Viva Energy Geelong Refinery · pip
    ('way:471125393', 'AU', 'Australia', NULL),  -- Kwinana Alumina Refinery · pip
    ('way:555255739', 'AU', 'Australia', NULL),  -- Perth Mint Refinery · pip
    ('way:621312655', 'AU', 'Australia', NULL),  -- Sun Metals Zinc Refinery · pip
    ('way:628295896', 'AU', 'Australia', NULL),  -- Queensland Alumina Refinery · pip
    ('way:628295903', 'AU', 'Australia', NULL),  -- Yarwun Alumina Refinery · pip
    ('way:628727023', 'AU', 'Australia', NULL),  -- T/A Cooling Towers · pip
    ('way:794612750', 'AU', 'Australia', NULL),  -- Minerva Gas Plant · pip
    ('relation:5263426', 'AW', 'Aruba', NULL),  -- Citgo · pip
    ('way:189056000', 'BA', 'Bosnia and Herzegovina', NULL),  -- Rafinerija nafte Brod · pip
    ('way:353033114', 'BD', 'Bangladesh', NULL),  -- Eastern Refinery · pip
    ('way:161212773', 'BE', 'Belgium', NULL),  -- Evonik Degussa Antwerpen · pip
    ('way:25218100', 'BE', 'Belgium', NULL),  -- Esso Belgium · pip
    ('way:30188509', 'BE', 'Belgium', NULL),  -- TotalEnergies Raffinaderij Antwerpen · pip
    ('way:915462197', 'BE', 'Belgium', NULL),  -- (unnamed) · pip
    ('way:173780738', 'BG', 'Bulgaria', NULL),  -- LUKOIL Neftochim Burgas · pip
    ('way:289418291', 'BH', 'Bahrain', NULL),  -- Bahrain Oil Refinery · pip
    ('way:545667140', 'BN', 'Brunei', NULL),  -- (unnamed) · nearest 0.3 km
    ('way:314798954', 'BO', 'Bolivia', NULL),  -- Refinería Guillermo Elder Bell · pip
    ('way:458110500', 'BO', 'Bolivia', NULL),  -- Refinería Oro Negro · pip
    ('way:97087355', 'BO', 'Bolivia', NULL),  -- Refinería Gualberto Villarroel · pip
    ('relation:5624445', 'BR', 'Brazil', NULL),  -- Refinaria Duque de Caxias · pip
    ('way:169130046', 'BR', 'Brazil', NULL),  -- Refinaria Presidente Getúlio Vargas · pip
    ('way:181202702', 'BR', 'Brazil', NULL),  -- Refinaria de Mataripe - Acelen · nearest 0.2 km
    ('way:183990721', 'BR', 'Brazil', NULL),  -- Complexo Petroquímico do Rio de Janeiro · pip
    ('way:23710841', 'BR', 'Brazil', NULL),  -- Refinaria Gabriel Passos - Regap Petrobras · pip
    ('way:254288228', 'BR', 'Brazil', NULL),  -- Refinaria Alberto Pasqualini · pip
    ('way:305982903', 'BR', 'Brazil', NULL),  -- Refinaria Lubrificantes e Derivados do Nordeste · pip
    ('way:325333017', 'BR', 'Brazil', NULL),  -- Refinaria Henrique Lage · pip
    ('way:359216246', 'BR', 'Brazil', NULL),  -- Usina de Açúcar e Álcool Cofco International · pip
    ('way:370270101', 'BR', 'Brazil', NULL),  -- Refinaria Abreu e Lima · pip
    ('way:436601870', 'BR', 'Brazil', NULL),  -- Refinaria Isaac Sabbá · pip
    ('way:508680414', 'BR', 'Brazil', NULL),  -- Refinaria Potiguar Clara Camarão · pip
    ('way:508685777', 'BR', 'Brazil', NULL),  -- Refinaria Capuava · pip
    ('way:51382215', 'BR', 'Brazil', NULL),  -- Refinaria Presidente Bernardes Cubatão · pip
    ('way:659328696', 'BR', 'Brazil', NULL),  -- Alcana - Destilaria de Álcool de Nanuque S.A. · pip
    ('way:823025132', 'BR', 'Brazil', NULL),  -- refinaria grande · pip
    ('way:93907294', 'BR', 'Brazil', NULL),  -- Paraná Xisto S.A. · pip
    ('way:163923181', 'BY', 'Belarus', NULL),  -- Naftan · pip
    ('relation:12086099', 'CA', 'Canada', NULL),  -- (unnamed) · pip
    ('relation:14702996', 'CA', 'Canada', NULL),  -- Énergie Valero - Raffinerie Jean-Gaulin · pip
    ('relation:18204336', 'CA', 'Canada', NULL),  -- Suncor - Burrard Terminal · pip
    ('relation:9392332', 'CA', 'Canada', NULL),  -- (unnamed) · pip
    ('relation:9394011', 'CA', 'Canada', NULL),  -- Coop Refinery Complex · pip
    ('way:199754287', 'CA', 'Canada', NULL),  -- Horizon Oil Sands · pip
    ('way:443698404', 'CA', 'Canada', NULL),  -- Kaybob South 3 Gas Plant · pip
    ('way:453238234', 'CA', 'Canada', NULL),  -- North Vancouver Liquid Waste Facility · nearest 0.5 km
    ('way:601424479', 'CA', 'Canada', NULL),  -- Tidewater Midstream Ltd. · pip
    ('way:614086706', 'CA', 'Canada', NULL),  -- Suncor Sarnia Refinery · pip
    ('way:625851276', 'CA', 'Canada', NULL),  -- Kaybob South 2 · pip
    ('way:625851282', 'CA', 'Canada', NULL),  -- Kaybob South 1 · pip
    ('way:545680823', 'CG', 'Republic of the Congo', NULL),  -- CORAF · pip
    ('relation:4217587', 'CH', 'Switzerland', NULL),  -- Varo Refining (Cressier) SA · pip
    ('way:641979596', 'CH', 'Switzerland', NULL),  -- Raffinerie de Collombey · pip
    ('way:342814484', 'CI', 'Côte d''Ivoire', NULL),  -- (unnamed) · nearest 0.3 km
    ('way:342866582', 'CI', 'Côte d''Ivoire', NULL),  -- Raffinerie d'Abidjan · pip
    ('way:438384841', 'CM', 'Cameroon', NULL),  -- Limbé refinery · nearest 0.6 km
    ('way:438384842', 'CM', 'Cameroon', NULL),  -- Limbé refinery · nearest 0.5 km
    ('relation:18404392', 'CN', 'China', NULL),  -- Daqing petrochemical refinery · pip
    ('way:151483600', 'CN', 'China', NULL),  -- Sinopec Anqing Refinery · pip
    ('way:239586391', 'CN', 'China', NULL),  -- 中国石油哈尔滨石化公司 · pip
    ('way:255455741', 'CN', 'China', NULL),  -- Golmud Refinery · pip
    ('way:292039953', 'CN', 'China', NULL),  -- (unnamed) · pip
    ('way:292039956', 'CN', 'China', NULL),  -- 长庆石化 · pip
    ('way:292039957', 'CN', 'China', NULL),  -- (unnamed) · pip
    ('way:306074608', 'CN', 'China', NULL),  -- SINOPEC Guangzhou Company · pip
    ('way:31159741', 'CN', 'China', NULL),  -- (unnamed) · pip
    ('way:317747076', 'CN', 'China', NULL),  -- (unnamed) · pip
    ('way:330452352', 'CN', 'China', NULL),  -- SINOPEC Yanshan Refinery · pip
    ('way:365447982', 'CN', 'China', NULL),  -- 塔中第二联合站 · pip
    ('way:445024987', 'CN', 'China', NULL),  -- Lanzhou refinery · pip
    ('way:478885591', 'CN', 'China', NULL),  -- 中国石油大港石化分公司 · pip
    ('way:633076270', 'CN', 'China', NULL),  -- Beihai refinery · pip
    ('way:676332503', 'CN', 'China', NULL),  -- Jingmen oil refinery · pip
    ('way:944039666', 'CN', 'China', NULL),  -- (unnamed) · pip
    ('way:953199779', 'CN', 'China', NULL),  -- (unnamed) · pip
    ('way:122029537', 'CO', 'Colombia', NULL),  -- Cartagena Refinery · pip
    ('way:120580118', 'CU', 'Cuba', NULL),  -- Refinería Sergio Soto Alba · pip
    ('way:148255911', 'CU', 'Cuba', NULL),  -- Refinería de Petróleo Camilo Cienfuegos · pip
    ('way:203230406', 'CU', 'Cuba', NULL),  -- Refinería de Aceite · pip
    ('way:317319467', 'CU', 'Cuba', NULL),  -- Refinería Ñico López · pip
    ('way:48255433', 'CU', 'Cuba', NULL),  -- Refinería de Petróleo Hermanos Díaz · pip
    ('way:26958365', 'CW', 'Curaçao', NULL),  -- Isla Refinery · pip
    ('relation:10757338', 'CZ', 'Czech Republic', NULL),  -- Areál chemických výrob Kralupy · pip
    ('way:168041651', 'CZ', 'Czech Republic', NULL),  -- Litvinov Refinery · pip
    ('way:205114316', 'CZ', 'Czech Republic', NULL),  -- Purum s.r.o. · pip
    ('way:30723491', 'CZ', 'Czech Republic', NULL),  -- Paramo Koramo Kolín Refinery · pip
    ('way:48550864', 'CZ', 'Czech Republic', NULL),  -- Paramo, a. s. · pip
    ('relation:11232067', 'DE', 'Germany', NULL),  -- OMV Deutschland GmbH · pip
    ('relation:16339854', 'DE', 'Germany', NULL),  -- H&R Ölwerke Schindler Hamburg Refinery · pip
    ('relation:8738090', 'DE', 'Germany', NULL),  -- Nynas Harburg Refinery · pip
    ('relation:9807677', 'DE', 'Germany', NULL),  -- Tamoil Holborn Hamburg Refinery · pip
    ('relation:9807678', 'DE', 'Germany', NULL),  -- Nynas Raffinerie · pip
    ('way:11638316', 'DE', 'Germany', NULL),  -- HES Wilhelmshaven Tank Terminal · nearest 0.5 km
    ('way:141509431', 'DE', 'Germany', NULL),  -- Raffinerie Heide · pip
    ('way:147468367', 'DE', 'Germany', NULL),  -- BP Lingen · pip
    ('way:16895007', 'DE', 'Germany', NULL),  -- Rheinland Raffinerie: Werk Nord (Godorf) · pip
    ('way:22943681', 'DE', 'Germany', NULL),  -- Ruhr Oel Raffinerie Scholven · pip
    ('way:22954734', 'DE', 'Germany', NULL),  -- BP Ruhr Öl Gelsenkirchen Horst · pip
    ('way:28014333', 'DE', 'Germany', NULL),  -- GUNVOR Raffinerie Ingolstadt · pip
    ('way:28813313', 'DE', 'Germany', NULL),  -- Raffineriehafen der BP Gelsenkirchen GmbH · pip
    ('way:30768397', 'DE', 'Germany', NULL),  -- TotalEnergies Raffinerie Mitteldeutschland · pip
    ('way:33234037', 'DE', 'Germany', NULL),  -- Raffinerie Salzbergen · pip
    ('way:38321216', 'DE', 'Germany', NULL),  -- Shell Energy & Chemicals Park Rheinland Werk Wesseling · pip
    ('way:54858195', 'DE', 'Germany', NULL),  -- PCK Raffinerie · pip
    ('way:891696592', 'DE', 'Germany', NULL),  -- Cargill Hamburg-Harburg · pip
    ('way:186653667', 'DK', 'Denmark', NULL),  -- Crossbridge Energy Fredericia · pip
    ('way:233051351', 'DK', 'Denmark', NULL),  -- Kalundborg Raffinaderihavn · pip
    ('way:155513317', 'DZ', 'Algeria', NULL),  -- Raffinerie d'Arzew · pip
    ('way:207012038', 'DZ', 'Algeria', NULL),  -- Raffinerie de sucre · pip
    ('way:217930452', 'DZ', 'Algeria', NULL),  -- SONATRACH CI Nord · pip
    ('way:310862821', 'DZ', 'Algeria', NULL),  -- Adrar refinery · pip
    ('way:1295964546', 'EC', 'Ecuador', NULL),  -- Pacifpetrol · pip
    ('way:67620371', 'EC', 'Ecuador', NULL),  -- Petroecuador · pip
    ('way:114553427', 'EG', 'Egypt', NULL),  -- Wadi Feran refinery · pip
    ('way:179095437', 'EG', 'Egypt', NULL),  -- (unnamed) · pip
    ('way:28830035', 'EG', 'Egypt', NULL),  -- Mostorod · pip
    ('way:352862333', 'EG', 'Egypt', NULL),  -- Amerya refinery · pip
    ('way:352865112', 'EG', 'Egypt', NULL),  -- MIDOR · pip
    ('way:352868107', 'EG', 'Egypt', NULL),  -- El Nasr Refinery · pip
    ('way:654896968', 'EG', 'Egypt', NULL),  -- (unnamed) · pip
    ('way:654896972', 'EG', 'Egypt', NULL),  -- (unnamed) · pip
    ('way:92878376', 'EG', 'Egypt', NULL),  -- El Nasr Refinery · nearest 0.4 km
    ('way:94071581', 'EG', 'Egypt', NULL),  -- Tanta refinery · pip
    ('way:204177453', 'ER', 'Eritrea', NULL),  -- Assab refinery · pip
    ('way:1105018602', 'ES', 'Spain', NULL),  -- Refineria de Castelló · pip
    ('way:154987259', 'ES', 'Spain', NULL),  -- Refinaría Repsol - A Coruña · pip
    ('way:218584073', 'ES', 'Spain', NULL),  -- Repsol Tarragona Refinery · pip
    ('way:22476682', 'ES', 'Spain', NULL),  -- Refinería de Gibraltar-San Roque · pip
    ('way:27532632', 'ES', 'Spain', NULL),  -- Petronor birfindegia · pip
    ('way:32729570', 'ES', 'Spain', NULL),  -- Refineria Exolum de Puertollano · pip
    ('way:363351264', 'ES', 'Spain', NULL),  -- ATLAS-CEPSA · pip
    ('way:43025211', 'ES', 'Spain', NULL),  -- Refinería de La Rábida · pip
    ('way:661007793', 'ES', 'Spain', NULL),  -- Puerto de Refinería · pip
    ('way:335272021', 'FI', 'Finland', NULL),  -- Porvoo oil refinery · pip
    ('relation:10378272', 'FR', 'France', NULL),  -- Raffinerie de Donges · nearest 0.7 km
    ('relation:16304690', 'FR', 'France', NULL),  -- Raffinerie de Feyzin · pip
    ('relation:6185295', 'FR', 'France', NULL),  -- LyondellBasell Berre L’Etang Refinery · pip
    ('relation:6417288', 'FR', 'France', NULL),  -- Terminal Wagram · pip
    ('way:154044995', 'FR', 'France', NULL),  -- EXXON Fos-sur-Mer Refinery · pip
    ('way:171473518', 'FR', 'France', NULL),  -- Shell · pip
    ('way:174730743', 'FR', 'France', NULL),  -- Total Flandres Mardyck · pip
    ('way:217644816', 'FR', 'France', NULL),  -- Total Provence Refinery · pip
    ('way:25129619', 'FR', 'France', NULL),  -- Raffinerie de Port-Jérôme-Gravenchon · pip
    ('way:28451871', 'FR', 'France', NULL),  -- Plateforme chimique du Pont-de-Claix · pip
    ('way:31356020', 'FR', 'France', NULL),  -- TotalEnergies - Raffinerie de Normandie · pip
    ('way:35389033', 'FR', 'France', NULL),  -- Raffinerie de la SARA · pip
    ('way:42016332', 'FR', 'France', NULL),  -- Dépôt Rouen Petit-Couronne · pip
    ('way:55336680', 'FR', 'France', NULL),  -- Petroineos - Terminal Rail Route · pip
    ('way:64265381', 'FR', 'France', NULL),  -- Raffinerie de Grandpuits · pip
    ('way:738870542', 'FR', 'France', NULL),  -- Plateforme pétrochimique de Lavera - Naphtachimie · pip
    ('way:879825465', 'FR', 'France', NULL),  -- Pôle Industriel du Malambas · pip
    ('relation:15658951', 'GA', 'Gabon', NULL),  -- Terminal Pétrolier du Cap Lopez · pip
    ('relation:15792544', 'GB', 'United Kingdom', NULL),  -- Stanlow Refinery · pip
    ('relation:16012225', 'GB', 'United Kingdom', NULL),  -- Humber Refinery · pip
    ('way:1184542865', 'GB', 'United Kingdom', NULL),  -- (unnamed) · pip
    ('way:1392197064', 'GB', 'United Kingdom', NULL),  -- Nynas Refinery · pip
    ('way:174730731', 'GB', 'United Kingdom', NULL),  -- (unnamed) · pip
    ('way:174730738', 'GB', 'United Kingdom', NULL),  -- Nynas Refinery · pip
    ('way:174730744', 'GB', 'United Kingdom', NULL),  -- Lindsey Oil Refinery · pip
    ('way:174730747', 'GB', 'United Kingdom', NULL),  -- INEOS Nitriles · pip
    ('way:35948757', 'GB', 'United Kingdom', NULL),  -- Harwich Refinery · nearest 0.2 km
    ('way:35959773', 'GB', 'United Kingdom', NULL),  -- Grangemouth Oil Refinery · pip
    ('way:56220787', 'GB', 'United Kingdom', NULL),  -- Petroplus Coryton · nearest 0.3 km
    ('relation:4095369', 'GR', 'Greece', NULL),  -- Hellenic Petroleum Aspropyrgos Refinery · pip
    ('relation:9775365', 'GR', 'Greece', NULL),  -- Motor Oil (Hellas) Corinth Refinery S.A. · pip
    ('way:19869994', 'GR', 'Greece', NULL),  -- Hellenic Petroleum Thessaloniki Refinery · pip
    ('way:223324734', 'GR', 'Greece', NULL),  -- Hellenic Petroleum Elefsina Refinery · pip
    ('way:223324735', 'GR', 'Greece', NULL),  -- Hellenic Petroleum Elefsina Refinery · pip
    ('way:31955417', 'GR', 'Greece', NULL),  -- Hellenic Petroleum Elefsina Refinery · pip
    ('way:535627402', 'GR', 'Greece', NULL),  -- (unnamed) · pip
    ('way:562549896', 'GR', 'Greece', NULL),  -- (unnamed) · pip
    ('way:101117473', 'HR', 'Croatia', NULL),  -- INA Rafinerija Sisak · pip
    ('way:173780740', 'HR', 'Croatia', NULL),  -- Rijeka Oil Refinery · nearest 0.1 km
    ('relation:11323168', 'HU', 'Hungary', NULL),  -- MOL Zalai finomító · pip
    ('relation:18345432', 'HU', 'Hungary', NULL),  -- MOL Duna Refinery · pip
    ('relation:2756249', 'HU', 'Hungary', NULL),  -- MOL Almásfüzitői finomító · pip
    ('way:296896934', 'HU', 'Hungary', NULL),  -- MOL Tiszaújváros Refinery · pip
    ('way:1050701688', 'ID', 'Indonesia', NULL),  -- PKS PTPN IV Puluraja · pip
    ('way:109868095', 'ID', 'Indonesia', NULL),  -- PT Pertamina Oil Refinery Complex · pip
    ('way:1232684361', 'ID', 'Indonesia', NULL),  -- (unnamed) · nearest 0.1 km
    ('way:542511383', 'ID', 'Indonesia', NULL),  -- Pertamina Refinery Unit II Dumai · pip
    ('way:603569753', 'ID', 'Indonesia', NULL),  -- Sei Pakning Refinery · nearest 0.5 km
    ('way:614516782', 'ID', 'Indonesia', NULL),  -- (unnamed) · nearest 1.4 km
    ('way:614516783', 'ID', 'Indonesia', NULL),  -- (unnamed) · nearest 1.4 km
    ('way:614516785', 'ID', 'Indonesia', NULL),  -- (unnamed) · nearest 1.4 km
    ('relation:3544536', 'IE', 'Ireland', NULL),  -- Whitegate Oil Refinery · nearest 0.3 km
    ('relation:18432568', 'IL', 'Israel', NULL),  -- בתי הזיקוק אשדוד · pip
    ('way:102565505', 'IN', 'India', NULL),  -- CPCL Refinery · pip
    ('way:122009489', 'IN', 'India', NULL),  -- Guwahati Refinery · pip
    ('way:1332986148', 'IN', 'India', NULL),  -- Gas Processing Unit, Vaghodia · pip
    ('way:166334648', 'IN', 'India', NULL),  -- IOCL Paradip Refinery Tankfarm · pip
    ('way:197338461', 'IN', 'India', NULL),  -- Essar Refinery · pip
    ('way:206504600', 'IN', 'India', NULL),  -- ONGC Tatipaka Refinery · pip
    ('way:222011234', 'IN', 'India', NULL),  -- Digboi Refinery · pip
    ('way:259618943', 'IN', 'India', NULL),  -- Panipat Refinery · pip
    ('way:259651725', 'IN', 'India', NULL),  -- Panipat Refinery · pip
    ('way:259662844', 'IN', 'India', NULL),  -- Gasoline · pip
    ('way:280178624', 'IN', 'India', NULL),  -- Hindustan Petroleum Corporation Limited · pip
    ('way:29107962', 'IN', 'India', NULL),  -- Gujarat Refinery · pip
    ('way:335591575', 'IN', 'India', NULL),  -- Indian Oil Corporation Ltd IOCL Refinery · pip
    ('way:372699638', 'IN', 'India', NULL),  -- Bina Refinery · pip
    ('way:396383136', 'IN', 'India', NULL),  -- Cairn Refinery · pip
    ('way:397989480', 'IN', 'India', NULL),  -- Visakhapatnam Refinery · pip
    ('way:430012318', 'IN', 'India', NULL),  -- Mumbai Refinery Mahul · pip
    ('way:430012320', 'IN', 'India', NULL),  -- Mumbai Refinery · pip
    ('way:476855038', 'IN', 'India', NULL),  -- Hindustan Petroleum Corporation Limited · pip
    ('way:476855039', 'IN', 'India', NULL),  -- IOCL Terminal · pip
    ('way:546111308', 'IN', 'India', NULL),  -- Guru Gobind Singh Refinery, Raman, Bathinda · pip
    ('way:546118631', 'IN', 'India', NULL),  -- Mathura Refinery · pip
    ('way:59266108', 'IN', 'India', NULL),  -- BPCL Refinery · pip
    ('way:604176116', 'IN', 'India', NULL),  -- Narimanam Refinery · pip
    ('way:62004860', 'IN', 'India', NULL),  -- Mangalore Refinery and Petrochemicals Limited · pip
    ('way:66665052', 'IN', 'India', NULL),  -- Barauni Oil Refinery · pip
    ('way:69366299', 'IN', 'India', NULL),  -- Numaligarh Refinery · pip
    ('way:840880651', 'IN', 'India', NULL),  -- CPCL Refinery · pip
    ('way:840880654', 'IN', 'India', NULL),  -- (unnamed) · pip
    ('way:840880655', 'IN', 'India', NULL),  -- CPCL Refinery · pip
    ('way:873296746', 'IN', 'India', NULL),  -- (unnamed) · pip
    ('way:91585872', 'IN', 'India', NULL),  -- Reliance Refinery · pip
    ('way:97895213', 'IN', 'India', NULL),  -- Bongaigaon Refinery · pip
    ('relation:19755497', 'IQ', 'Iraq', NULL),  -- United Refinery · pip
    ('way:1084312088', 'IQ', 'Iraq', NULL),  -- Kirkuk II Refinery · pip
    ('way:1112234798', 'IQ', 'Iraq', NULL),  -- Al-Zawari Refinery · pip
    ('way:1159050225', 'IQ', 'Iraq', NULL),  -- Karbala Refinery · pip
    ('way:1377081226', 'IQ', 'Iraq', NULL),  -- Oil Company · pip
    ('way:1385819761', 'IQ', 'Iraq', NULL),  -- Samawa Refinery · pip
    ('way:1393666744', 'IQ', 'Iraq', NULL),  -- The New Shuaiba Refinery (Fluid Catalytic Cracking) · pip
    ('way:1393666767', 'IQ', 'Iraq', NULL),  -- مصفى الشعيبة الجديد · pip
    ('way:1396234178', 'IQ', 'Iraq', NULL),  -- Kalak Refinery · pip
    ('way:1396234716', 'IQ', 'Iraq', NULL),  -- Lanaz Refinery · pip
    ('way:1424094993', 'IQ', 'Iraq', NULL),  -- محطة عزل غاز الطوبة · pip
    ('way:1424218792', 'IQ', 'Iraq', NULL),  -- محطة عزل غاز حقل صبة · pip
    ('way:1449918496', 'IQ', 'Iraq', NULL),  -- Maysan Refinery · pip
    ('way:1449999447', 'IQ', 'Iraq', NULL),  -- Kirkuk Refinery · pip
    ('way:1450114966', 'IQ', 'Iraq', NULL),  -- Najaf Refinery · pip
    ('way:1450116091', 'IQ', 'Iraq', NULL),  -- Haditha Refinery · pip
    ('way:1467550038', 'IQ', 'Iraq', NULL),  -- North Oil Company · pip
    ('way:1504444361', 'IQ', 'Iraq', NULL),  -- Karband Refinery · pip
    ('way:203574525', 'IQ', 'Iraq', NULL),  -- Basra Refinery · pip
    ('way:203574530', 'IQ', 'Iraq', NULL),  -- المستودعات · pip
    ('way:238845270', 'IQ', 'Iraq', NULL),  -- Wailiya Oil Refinery · pip
    ('way:269474988', 'IQ', 'Iraq', NULL),  -- Erbil, Kalak Refinery · pip
    ('way:283071773', 'IQ', 'Iraq', NULL),  -- Diwaniyah Refinery · pip
    ('way:287909762', 'IQ', 'Iraq', NULL),  -- Al-Samoud Refinery · pip
    ('way:289507874', 'IQ', 'Iraq', NULL),  -- Al-Siniyah Refinery · pip
    ('way:308086388', 'IQ', 'Iraq', NULL),  -- Kasik Refinery · pip
    ('way:364638382', 'IQ', 'Iraq', NULL),  -- Bazian Refinery · pip
    ('way:4235761', 'IQ', 'Iraq', NULL),  -- Dora Refinery · pip
    ('way:426254670', 'IQ', 'Iraq', NULL),  -- Dhi Qar Refinery · pip
    ('way:436449668', 'IQ', 'Iraq', NULL),  -- Qayara Refinery · pip
    ('way:775721856', 'IQ', 'Iraq', NULL),  -- Dukan Refinery · pip
    ('way:100637462', 'IR', 'Iran', NULL),  -- تصفیه خانه آب اردبیل · pip
    ('way:119555738', 'IR', 'Iran', NULL),  -- Tabriz Oil Refining Company · pip
    ('way:146420619', 'IR', 'Iran', NULL),  -- Shiraz Oil Refinery · pip
    ('way:203470198', 'IR', 'Iran', NULL),  -- Abadan Oil Refinery · pip
    ('way:302704249', 'IR', 'Iran', NULL),  -- (unnamed) · pip
    ('way:304828196', 'IR', 'Iran', NULL),  -- Shazand Oil Refinery · pip
    ('way:313533653', 'IR', 'Iran', NULL),  -- Kermanshah Oil Refining Company · pip
    ('way:317494344', 'IR', 'Iran', NULL),  -- پالایشگاه چهارم پارس جنوبی فاز 6 و 7 و 8 · pip
    ('way:442917425', 'IR', 'Iran', NULL),  -- (unnamed) · pip
    ('way:442917462', 'IR', 'Iran', NULL),  -- (unnamed) · pip
    ('way:489941810', 'IR', 'Iran', NULL),  -- Bandar Abbas Oil Refinery · pip
    ('way:495378392', 'IR', 'Iran', NULL),  -- Parsian gas refinery · pip
    ('way:514616902', 'IR', 'Iran', NULL),  -- Tehran Oil Refinery · pip
    ('way:525709337', 'IR', 'Iran', NULL),  -- پالایشگاه ششم پارس جنوبی فاز ۱۵ و۱۶ · pip
    ('way:525709341', 'IR', 'Iran', NULL),  -- پالایشگاه هشتم پارس جنوبی فاز ۲۰ و۲۱ · pip
    ('way:525709349', 'IR', 'Iran', NULL),  -- پالایشگاه هفتم پارس جنوبی فاز ۱۷ و ۱۸ · pip
    ('way:525709350', 'IR', 'Iran', NULL),  -- پالایشگاه پنجم پارس جنوبی فاز ۹ و ۱۰ · pip
    ('way:525717121', 'IR', 'Iran', NULL),  -- پالایشگاه دوم پارس جنوبی فاز ۲ و ۳ · pip
    ('way:525717890', 'IR', 'Iran', NULL),  -- پالایشگاه سوم پارس جنوبی فاز ۴ و ۵ · pip
    ('way:537468947', 'IR', 'Iran', NULL),  -- Esfahan Oil Refinery · pip
    ('way:537642276', 'IR', 'Iran', NULL),  -- Lavan Oil Refinery · nearest 0.2 km
    ('way:582553999', 'IR', 'Iran', NULL),  -- (unnamed) · pip
    ('relation:12885677', 'IT', 'Italy', NULL),  -- Raffineria ISAB sito nord · pip
    ('relation:17970783', 'IT', 'Italy', NULL),  -- Raffineria API · pip
    ('relation:18023874', 'IT', 'Italy', NULL),  -- Comparto delle Raffinerie Petrolifere · pip
    ('relation:18737323', 'IT', 'Italy', NULL),  -- Raffineria di Sannazzaro · pip
    ('relation:18902180', 'IT', 'Italy', NULL),  -- Taranto Refinery · pip
    ('relation:3437793', 'IT', 'Italy', NULL),  -- Raffineria di Milazzo · pip
    ('relation:8271170', 'IT', 'Italy', NULL),  -- Sonatrach Raffineria Italiana · pip
    ('way:1344928822', 'IT', 'Italy', NULL),  -- IPLOM Raffineria Multedo · pip
    ('way:173780737', 'IT', 'Italy', NULL),  -- Eni Versalis · pip
    ('way:24388724', 'IT', 'Italy', NULL),  -- Raffineria Petrolifera · pip
    ('way:27771208', 'IT', 'Italy', NULL),  -- Sarlux · pip
    ('way:293107696', 'IT', 'Italy', NULL),  -- Raffineria ISAB sito sud · pip
    ('way:293123123', 'IT', 'Italy', NULL),  -- Raffineria ISAB sito sud - Pontile · pip
    ('way:29343421', 'IT', 'Italy', NULL),  -- Stanic · pip
    ('way:295375063', 'IT', 'Italy', NULL),  -- Bunge · pip
    ('way:45011418', 'IT', 'Italy', NULL),  -- Raffineria di Livorno · pip
    ('way:560123075', 'IT', 'Italy', NULL),  -- Agip · pip
    ('way:59167755', 'IT', 'Italy', NULL),  -- Raffineria Sarpom S.r.l. · pip
    ('way:59221422', 'IT', 'Italy', NULL),  -- IPLOM Raffineria Busalla · pip
    ('way:59221426', 'IT', 'Italy', NULL),  -- IPLOM Raffineria Busalla · pip
    ('way:681248983', 'IT', 'Italy', NULL),  -- Alma Petroli · pip
    ('way:71888511', 'IT', 'Italy', NULL),  -- Tamoil · pip
    ('way:773097705', 'IT', 'Italy', NULL),  -- Versalis · pip
    ('way:80395526', 'IT', 'Italy', NULL),  -- Bio-raffineria Eni di Crescentino · pip
    ('way:199601812', 'JM', 'Jamaica', NULL),  -- ALPART Alumina Refinery · pip
    ('way:62325452', 'JO', 'Jordan', NULL),  -- Arab Potash Refinery · pip
    ('relation:8534238', 'JP', 'Japan', NULL),  -- Wakayama Refinery · nearest 0.3 km
    ('way:103881232', 'JP', 'Japan', NULL),  -- Sendai refinery · pip
    ('way:614730310', 'JP', 'Japan', NULL),  -- JXTG Nippon Oil & Energy · nearest 1.3 km
    ('way:619218217', 'JP', 'Japan', NULL),  -- Ichihara refinery · nearest 0.3 km
    ('way:619489687', 'JP', 'Japan', NULL),  -- Marifu Refinery · nearest 0.1 km
    ('way:620989294', 'JP', 'Japan', NULL),  -- Shikoku refinery · pip
    ('way:621496214', 'JP', 'Japan', NULL),  -- Aichi Minamihama refinery · pip
    ('way:634083202', 'JP', 'Japan', NULL),  -- Sakai refinery · pip
    ('way:676665818', 'JP', 'Japan', NULL),  -- Idemitsu Kosan Hokkaido Refinery · pip
    ('way:951261406', 'JP', 'Japan', NULL),  -- Muroran refinery · pip
    ('way:220791937', 'KP', 'North Korea', NULL),  -- Jeongju Refinery · pip
    ('way:352872197', 'KR', 'South Korea', NULL),  -- S-oil · pip
    ('relation:6485329', 'KW', 'Kuwait', NULL),  -- Mina Al Ahmadi Refinery · pip
    ('way:516440723', 'KW', 'Kuwait', NULL),  -- Al Zour Refinery · pip
    ('way:332522697', 'KZ', 'Kazakhstan', NULL),  -- Атырау мұнай өңдеу зауыты · pip
    ('way:432300177', 'KZ', 'Kazakhstan', NULL),  -- ЗИиОФ · pip
    ('way:886309429', 'LA', 'Laos', NULL),  -- (unnamed) · pip
    ('relation:11050769', 'LT', 'Lithuania', NULL),  -- Orlen Lietuva · pip
    ('node:8997288576', 'LY', 'Libya', NULL),  -- حقل النافورة ، شركة الخليج. · pip
    ('way:102807946', 'LY', 'Libya', NULL),  -- Ras Lanuf Oil Marketing Company · pip
    ('way:105885044', 'LY', 'Libya', NULL),  -- (unnamed) · pip
    ('way:126082243', 'LY', 'Libya', NULL),  -- Az Zawiya Oil Refining Company · pip
    ('way:310844993', 'LY', 'Libya', NULL),  -- Mellita Gas and Oil Industrial Complex · pip
    ('way:352884758', 'LY', 'Libya', NULL),  -- Sarir refinery · pip
    ('way:352886517', 'LY', 'Libya', NULL),  -- Wastewater Plant · pip
    ('way:561397439', 'LY', 'Libya', NULL),  -- AGOCO Al Hamada Oil field refinery · pip
    ('way:921681471', 'LY', 'Libya', NULL),  -- (unnamed) · pip
    ('way:279687034', 'MA', 'Morocco', NULL),  -- Raffinerie de Pétrole La SAMIR · pip
    ('way:58216748', 'MA', 'Morocco', NULL),  -- Raffinerie de Mohammedia · pip
    ('way:833845775', 'MD', 'Moldova', NULL),  -- Fabrica de zahăr · pip
    ('way:53578738', 'MG', 'Madagascar', NULL),  -- Raffinerie · pip
    ('way:121911433', 'MR', 'Mauritania', NULL),  -- Old Refinery · pip
    ('relation:9599114', 'MX', 'Mexico', NULL),  -- Madero Refinery · pip
    ('way:111297199', 'MX', 'Mexico', NULL),  -- Minatitlan Refinery · pip
    ('way:1126788385', 'MX', 'Mexico', NULL),  -- Refinería Dos Bocas · pip
    ('way:113738260', 'MX', 'Mexico', NULL),  -- Salina Cruz Refinery · pip
    ('way:295875035', 'MX', 'Mexico', NULL),  -- Cadereyta Refinery · pip
    ('way:319019526', 'MX', 'Mexico', NULL),  -- Tula Refinery · pip
    ('way:49229616', 'MX', 'Mexico', NULL),  -- Refinería Ing. Antonio M. Amor · pip
    ('way:1306585376', 'MY', 'Malaysia', NULL),  -- Niah Palm Oil Mill · pip
    ('way:332519061', 'MY', 'Malaysia', NULL),  -- Kilang Penapisan Minyak Kerteh · pip
    ('way:332519062', 'MY', 'Malaysia', NULL),  -- Onshore Gas Terminal · pip
    ('way:362351663', 'MY', 'Malaysia', NULL),  -- Terminal Gas dan Cecair · pip
    ('way:527443310', 'MY', 'Malaysia', NULL),  -- Onshore Slug Catcher · pip
    ('way:527443311', 'MY', 'Malaysia', NULL),  -- (unnamed) · pip
    ('way:584926981', 'MY', 'Malaysia', NULL),  -- Sandakan Edible Oils Sdn. Bhd. · nearest 0.4 km
    ('way:699425149', 'MY', 'Malaysia', NULL),  -- Terengganu Gas Terminal · pip
    ('way:812604850', 'MY', 'Malaysia', NULL),  -- Kerteh Oil Terminal · pip
    ('way:841169851', 'MY', 'Malaysia', NULL),  -- Kunak Refinery Sdn Bhd · pip
    ('way:784680075', 'NC', 'New Caledonia', NULL),  -- FBR · pip
    ('way:176319581', 'NE', 'Niger', NULL),  -- Sonidep · pip
    ('way:312456503', 'NE', 'Niger', NULL),  -- Soraz Oil Refinery · pip
    ('way:28923932', 'NG', 'Nigeria', NULL),  -- Kaduna Refinery · pip
    ('way:308267796', 'NG', 'Nigeria', NULL),  -- NNPC Oil Refinery · pip
    ('way:352951660', 'NG', 'Nigeria', NULL),  -- Warri Refinery · pip
    ('way:732777987', 'NG', 'Nigeria', NULL),  -- Dangote Refinery · pip
    ('relation:19897853', 'NL', 'Netherlands', NULL),  -- NAM-locatie Overschild · pip
    ('relation:5512299', 'NL', 'Netherlands', NULL),  -- NAM-locatie Amsweer · pip
    ('way:144928919', 'NL', 'Netherlands', NULL),  -- Gunvor Energy Rotterdam · pip
    ('way:146809645', 'NL', 'Netherlands', NULL),  -- BP Raffinaderij Rotterdam · pip
    ('way:168512752', 'NL', 'Netherlands', NULL),  -- NAM-locatie Kooipolder · pip
    ('way:174730741', 'NL', 'Netherlands', NULL),  -- Exolum Amsterdam B.V. · pip
    ('way:174730745', 'NL', 'Netherlands', NULL),  -- Zeeland Refinery · pip
    ('way:205754596', 'NL', 'Netherlands', NULL),  -- NAM-locatie Slochteren · pip
    ('way:262082145', 'NL', 'Netherlands', NULL),  -- NAM-locatie Coevorden-17 · pip
    ('way:6319211', 'NL', 'Netherlands', NULL),  -- Esso Rafﬁnaderij Rotterdam · pip
    ('way:6319326', 'NL', 'Netherlands', NULL),  -- Exxonmobil Chemical Holland · pip
    ('way:895629447', 'NL', 'Netherlands', NULL),  -- amine regeneration sour water strippers · pip
    ('relation:6275999', 'NO', 'Norway', NULL),  -- Mongstad production facility · nearest 1.6 km
    ('way:41594364', 'NO', 'Norway', NULL),  -- ExxonMobil Slagen · nearest 0.7 km
    ('relation:15426226', 'NZ', 'New Zealand', NULL),  -- Marsden Point Oil Refinery · pip
    ('way:798098473', 'OM', 'Oman', NULL),  -- Duqm Refinery · pip
    ('relation:16051167', 'PE', 'Peru', NULL),  -- La Pampilla Refinery · pip
    ('way:155104389', 'PE', 'Peru', NULL),  -- Refinería Conchán · pip
    ('way:201025291', 'PE', 'Peru', NULL),  -- Refinery of Talara · pip
    ('way:494892293', 'PE', 'Peru', NULL),  -- Compañía Minera Luren S.A · pip
    ('way:494892315', 'PE', 'Peru', NULL),  -- Chancadora Excalibur S.A.C. · pip
    ('way:597508692', 'PE', 'Peru', NULL),  -- Pecsa · pip
    ('way:672037372', 'PE', 'Peru', NULL),  -- Refineria Cajamarquilla · pip
    ('way:676317987', 'PE', 'Peru', NULL),  -- Refineria Petroperu Iquitos · pip
    ('way:673249516', 'PG', 'Papua New Guinea', NULL),  -- Mobil PNG Ltd · pip
    ('way:676434751', 'PG', 'Papua New Guinea', NULL),  -- Napa Napa Oil Refinery · nearest 0.8 km
    ('way:676955523', 'PG', 'Papua New Guinea', NULL),  -- Puma Energy PNG Ltd · nearest 0.2 km
    ('relation:17900779', 'PH', 'Philippines', NULL),  -- Petron Bataan Refinery · nearest 0.5 km
    ('way:635770194', 'PH', 'Philippines', NULL),  -- Carmen Concentrator · pip
    ('way:761162786', 'PH', 'Philippines', NULL),  -- Plastic and Tools, Inc. · pip
    ('way:1337603633', 'PK', 'Pakistan', NULL),  -- Engro Polymer and Chemicals Limited (EPCL) · pip
    ('way:230099290', 'PK', 'Pakistan', NULL),  -- Attock Oil Refinery · pip
    ('way:245502219', 'PK', 'Pakistan', NULL),  -- PARCO refinery · pip
    ('way:245548500', 'PK', 'Pakistan', NULL),  -- National Refinery · pip
    ('way:403731952', 'PK', 'Pakistan', NULL),  -- Byco Refinery · pip
    ('way:480023169', 'PK', 'Pakistan', NULL),  -- Pakistan Refinery Limited · pip
    ('relation:19871774', 'PL', 'Poland', NULL),  -- Rafineria Trzebinia · pip
    ('way:174730733', 'PL', 'Poland', NULL),  -- Rafineria Nafty Glimar S.A. · pip
    ('way:174730735', 'PL', 'Poland', NULL),  -- Unimot Terminale · pip
    ('way:174730736', 'PL', 'Poland', NULL),  -- Plock Refinery · pip
    ('way:60914896', 'PL', 'Poland', NULL),  -- Gdańsk Refinery · pip
    ('relation:20595312', 'PT', 'Portugal', NULL),  -- Galp Energia - Refinaria de Sines · pip
    ('way:1216294503', 'PT', 'Portugal', NULL),  -- Parque de Abastecimento da Boa Nova · pip
    ('way:614756788', 'PT', 'Portugal', NULL),  -- Dow Portugal · pip
    ('way:770877215', 'PT', 'Portugal', NULL),  -- Indorama · pip
    ('relation:1307309', 'RO', 'Romania', NULL),  -- Rafinăria Petromidia · pip
    ('way:197719915', 'RO', 'Romania', NULL),  -- Rafinăria Steaua Română Câmpina · pip
    ('way:560990911', 'RO', 'Romania', NULL),  -- Rafinăria Rompetrol Vega Ploiești · pip
    ('way:675657141', 'RO', 'Romania', NULL),  -- Rafinăria Crișana Petrolsub · pip
    ('way:88172678', 'RO', 'Romania', NULL),  -- Rafinăria Arpechim · pip
    ('way:88173512', 'RO', 'Romania', NULL),  -- Petrobrazi Refinery · pip
    ('way:88175576', 'RO', 'Romania', NULL),  -- RAFO Onești · pip
    ('way:88175668', 'RO', 'Romania', NULL),  -- Rafinăria Dărmănești · pip
    ('way:88181773', 'RO', 'Romania', NULL),  -- Terminal Petromidia · nearest 0.2 km
    ('way:921896532', 'RO', 'Romania', NULL),  -- Petrotel-Lukoil · pip
    ('relation:18932213', 'RS', 'Serbia', NULL),  -- НИС Рафинерија гаса Елемир · pip
    ('relation:5919069', 'RS', 'Serbia', NULL),  -- NIS Oil Refinery Novi Sad · pip
    ('way:674250980', 'RS', 'Serbia', NULL),  -- Рафинерија нафте Београд · pip
    ('way:68321105', 'RS', 'Serbia', NULL),  -- НИС Рафинерија нафте Панчево · pip
    ('relation:11366279', 'RU', 'Russia', NULL),  -- Kirishi Refinery · pip
    ('relation:14090332', 'RU', 'Russia', NULL),  -- КазаньОргсинтез · pip
    ('relation:19128860', 'RU', 'Russia', NULL),  -- ННК-Хабаровский НПЗ · pip
    ('relation:4850228', 'RU', 'Russia', NULL),  -- Оргхим · pip
    ('relation:5292354', 'RU', 'Russia', NULL),  -- (unnamed) · pip
    ('way:115184709', 'RU', 'Russia', NULL),  -- (unnamed) · pip
    ('way:1234898379', 'RU', 'Russia', NULL),  -- Бобровский нефтеперерабатывающий завод · pip
    ('way:236507372', 'RU', 'Russia', NULL),  -- Омский нефтеперерабатывающий завод · pip
    ('way:299684669', 'RU', 'Russia', NULL),  -- Novatek Gas Concentrate Complex · pip
    ('way:556446775', 'RU', 'Russia', NULL),  -- ППСН "Кез" ОАО "Удмуртнефть" · pip
    ('way:569868591', 'RU', 'Russia', NULL),  -- ООО "Метоксил", ветлужский завод · pip
    ('way:61412496', 'RU', 'Russia', NULL),  -- (unnamed) · pip
    ('way:711324646', 'RU', 'Russia', NULL),  -- LDPE Plant · pip
    ('way:72861155', 'RU', 'Russia', NULL),  -- Komsomolsk Refinery · pip
    ('way:81141435', 'RU', 'Russia', NULL),  -- УППН «Кызыл-Тау» · pip
    ('way:832539417', 'RU', 'Russia', NULL),  -- ЦПС Ван-Еган · pip
    ('way:1136914983', 'SA', 'Saudi Arabia', NULL),  -- Tasnee · pip
    ('way:1136915141', 'SA', 'Saudi Arabia', NULL),  -- Sharq · pip
    ('way:131678150', 'SA', 'Saudi Arabia', NULL),  -- Saudi Aramco · pip
    ('way:1317472731', 'SA', 'Saudi Arabia', NULL),  -- Al Muajjiz Crude oil terminal · pip
    ('way:294797390', 'SA', 'Saudi Arabia', NULL),  -- Petro Rabigh Oil Refining and Petrochemical Complex · pip
    ('way:331484290', 'SA', 'Saudi Arabia', NULL),  -- Aramco Riyadh Refinery · pip
    ('way:434711155', 'SA', 'Saudi Arabia', NULL),  -- Saudi Aramco Total Refining And Petrochemical · pip
    ('way:585207620', 'SA', 'Saudi Arabia', NULL),  -- Luberef Refinery · pip
    ('way:585223899', 'SA', 'Saudi Arabia', NULL),  -- YasRef · pip
    ('way:585223960', 'SA', 'Saudi Arabia', NULL),  -- Yansab · pip
    ('way:585223969', 'SA', 'Saudi Arabia', NULL),  -- SAMREF · pip
    ('way:585223970', 'SA', 'Saudi Arabia', NULL),  -- Yanpet · pip
    ('way:590280338', 'SA', 'Saudi Arabia', NULL),  -- Shaybah Refinery · pip
    ('way:614415380', 'SA', 'Saudi Arabia', NULL),  -- Jeddah Refinery · pip
    ('way:615014754', 'SA', 'Saudi Arabia', NULL),  -- Saudi Aramco Jubail Refinery · pip
    ('way:622299690', 'SA', 'Saudi Arabia', NULL),  -- Ibn Zahr · pip
    ('way:676562519', 'SA', 'Saudi Arabia', NULL),  -- Saudi Aramco Ras Tanura Refinery · pip
    ('way:899264339', 'SA', 'Saudi Arabia', NULL),  -- Jazan Refinery · pip
    ('way:199993049', 'SD', 'Sudan', NULL),  -- CNPC El Obeid · pip
    ('way:200009943', 'SD', 'Sudan', NULL),  -- Raffinerie · pip
    ('way:627215576', 'SD', 'Sudan', NULL),  -- CNPC Port Sudan Refinery · pip
    ('relation:11332243', 'SE', 'Sweden', NULL),  -- Preem Raffinaderi · pip
    ('relation:14645536', 'SE', 'Sweden', NULL),  -- Nynas Raffinaderi · pip
    ('way:173781450', 'SE', 'Sweden', NULL),  -- Nynas Raffinaderi · nearest 0.3 km
    ('way:53185286', 'SE', 'Sweden', NULL),  -- St1 Raffinaderi · pip
    ('way:23446401', 'SG', 'Singapore', NULL),  -- Pulau Bukom · nearest 4.5 km
    ('way:614047441', 'SG', 'Singapore', NULL),  -- Neste Singapore Refinery · nearest 2.8 km
    ('way:697853690', 'SG', 'Singapore', NULL),  -- ExxonMobil Singapore Refinery · pip
    ('way:4422045', 'SK', 'Slovakia', NULL),  -- MOL Slovnaft Bratislava Refinery · pip
    ('way:31504972', 'SN', 'Senegal', NULL),  -- Dakar Refinery · pip
    ('way:1433443372', 'SR', 'Suriname', NULL),  -- (unnamed) · pip
    ('relation:13579528', 'SY', 'Syria', NULL),  -- (unnamed) · pip
    ('way:1014283960', 'SY', 'Syria', NULL),  -- (unnamed) · pip
    ('way:255681448', 'SY', 'Syria', NULL),  -- Baniyas Refinery · pip
    ('way:465149076', 'SY', 'Syria', NULL),  -- (unnamed) · pip
    ('way:175056047', 'TD', 'Chad', NULL),  -- مصفاة جرماية · pip
    ('way:387894214', 'TG', 'Togo', NULL),  -- T Oil · pip
    ('way:169094827', 'TH', 'Thailand', NULL),  -- IRPC Refinery · pip
    ('way:650396523', 'TH', 'Thailand', NULL),  -- Star Petroleum Refining Public Company Limited · pip
    ('way:654271219', 'TH', 'Thailand', NULL),  -- Thai Oil Refinery · pip
    ('way:654271220', 'TH', 'Thailand', NULL),  -- Bangchak Sriracha Refinery · pip
    ('way:675654492', 'TH', 'Thailand', NULL),  -- Bangchak Refinery · pip
    ('way:246157354', 'TM', 'Turkmenistan', NULL),  -- Seydi Oil Refinery · pip
    ('way:592453433', 'TM', 'Turkmenistan', NULL),  -- (unnamed) · pip
    ('way:256386110', 'TN', 'Tunisia', NULL),  -- مصفاة جرزونة · pip
    ('way:301895784', 'TN', 'Tunisia', NULL),  -- (unnamed) · pip
    ('way:129693533', 'TR', 'Türkiye', NULL),  -- Tüpraş Batman Oil Refinery · pip
    ('way:157194960', 'TR', 'Türkiye', NULL),  -- Tüpraş  İzmit Rafineri Müdürlüğü A Sahası · nearest 0.1 km
    ('way:16897131', 'TR', 'Türkiye', NULL),  -- TÜPRAŞ Kırıkkale Refinery · pip
    ('way:226607383', 'TR', 'Türkiye', NULL),  -- Tüpraş İzmit Rafineri Müdürlüğü B Sahası · pip
    ('way:618579218', 'TR', 'Türkiye', NULL),  -- STAR Refinery · pip
    ('way:308359625', 'TW', 'Taiwan', NULL),  -- 台塑麥寮六輕工業區 · nearest 0.1 km
    ('relation:16998484', 'UA', 'Ukraine', NULL),  -- НПК "Галичина". Завод №2 · pip
    ('way:573930303', 'US', 'United States', 'AK'),  -- Kenai Refinery · pip
    ('way:60950041', 'US', 'United States', 'AK'),  -- Flint Hills Refinery · pip
    ('way:676681679', 'US', 'United States', 'AK'),  -- (unnamed) · pip
    ('way:743711655', 'US', 'United States', 'AK'),  -- Petro Star Refinery · pip
    ('relation:18631850', 'US', 'United States', 'AL'),  -- Saraland Refinery · pip
    ('way:622799746', 'US', 'United States', 'AL'),  -- Tuscaloosa Refinery · pip
    ('way:824150385', 'US', 'United States', 'AL'),  -- (unnamed) · pip
    ('way:824150386', 'US', 'United States', 'AL'),  -- (unnamed) · pip
    ('way:824150387', 'US', 'United States', 'AL'),  -- (unnamed) · pip
    ('way:633655329', 'US', 'United States', 'AR'),  -- Lion Oil Company · pip
    ('way:676581156', 'US', 'United States', 'AR'),  -- (unnamed) · pip
    ('relation:11664597', 'US', 'United States', 'CA'),  -- Rodeo San Francisco Refinery · pip
    ('way:107758176', 'US', 'United States', 'CA'),  -- Torrance Refinery · pip
    ('way:150457180', 'US', 'United States', 'CA'),  -- (unnamed) · pip
    ('way:230787366', 'US', 'United States', 'CA'),  -- Valero Wilmington Refinery · pip
    ('way:27768592', 'US', 'United States', 'CA'),  -- Paramount Refinery · pip
    ('way:464980724', 'US', 'United States', 'CA'),  -- Martinez Refinery · pip
    ('way:539755236', 'US', 'United States', 'CA'),  -- (unnamed) · pip
    ('way:540102351', 'US', 'United States', 'CA'),  -- (unnamed) · pip
    ('way:540102354', 'US', 'United States', 'CA'),  -- (unnamed) · pip
    ('way:540102358', 'US', 'United States', 'CA'),  -- Chevron Richmond · pip
    ('way:540102362', 'US', 'United States', 'CA'),  -- (unnamed) · pip
    ('way:540102364', 'US', 'United States', 'CA'),  -- (unnamed) · pip
    ('way:540102367', 'US', 'United States', 'CA'),  -- (unnamed) · pip
    ('way:540103367', 'US', 'United States', 'CA'),  -- (unnamed) · pip
    ('way:540108194', 'US', 'United States', 'CA'),  -- (unnamed) · pip
    ('way:540109149', 'US', 'United States', 'CA'),  -- (unnamed) · pip
    ('way:540109150', 'US', 'United States', 'CA'),  -- (unnamed) · pip
    ('way:540109653', 'US', 'United States', 'CA'),  -- (unnamed) · pip
    ('way:540110950', 'US', 'United States', 'CA'),  -- (unnamed) · pip
    ('way:134992178', 'US', 'United States', 'CO'),  -- Suncor · pip
    ('way:622953539', 'US', 'United States', 'CO'),  -- (unnamed) · pip
    ('way:620945041', 'US', 'United States', 'DE'),  -- Delaware City Refinery · pip
    ('way:910919921', 'US', 'United States', 'IA'),  -- (unnamed) · pip
    ('relation:19700997', 'US', 'United States', 'IL'),  -- Illinois Refining Division - Robinson Refinery · pip
    ('relation:6260703', 'US', 'United States', 'IL'),  -- Wood River Refinery · pip
    ('way:22053649', 'US', 'United States', 'IL'),  -- Joliet Refinery · pip
    ('way:372855533', 'US', 'United States', 'IL'),  -- Lemont Refinery · pip
    ('relation:19716067', 'US', 'United States', 'IN'),  -- BP Whiting Refinery · pip
    ('way:1389435302', 'US', 'United States', 'IN'),  -- Safety-Kleen Systems · pip
    ('way:306282764', 'US', 'United States', 'IN'),  -- Buckeye Hammond Facility · pip
    ('way:769721546', 'US', 'United States', 'IN'),  -- (unnamed) · pip
    ('way:502201004', 'US', 'United States', 'KS'),  -- CHS Refinery · pip
    ('way:502201015', 'US', 'United States', 'KS'),  -- CHS Refinery · pip
    ('way:676581243', 'US', 'United States', 'KY'),  -- Somerset Refinery · pip
    ('relation:9386940', 'US', 'United States', 'LA'),  -- Norco Refinery · pip
    ('relation:9386941', 'US', 'United States', 'LA'),  -- St. Charles Refinery · pip
    ('relation:9392520', 'US', 'United States', 'LA'),  -- Calumet Lubricants · pip
    ('way:1175113009', 'US', 'United States', 'LA'),  -- Baton Rouge Refinery · pip
    ('way:1175872560', 'US', 'United States', 'LA'),  -- Garyville Refinery · pip
    ('way:1176579927', 'US', 'United States', 'LA'),  -- Chalmette Refining · pip
    ('way:1178437056', 'US', 'United States', 'LA'),  -- Lake Charles Refinery · pip
    ('way:1178437058', 'US', 'United States', 'LA'),  -- Excel Paralubes · pip
    ('way:675658094', 'US', 'United States', 'LA'),  -- Placid Refining · pip
    ('way:675724419', 'US', 'United States', 'LA'),  -- Cotton Valley Refinery · pip
    ('way:676357241', 'US', 'United States', 'LA'),  -- Alon Refining · pip
    ('way:676362456', 'US', 'United States', 'LA'),  -- Calcasieu Refining · pip
    ('way:676428067', 'US', 'United States', 'LA'),  -- Valero Meraux Refinery · pip
    ('way:676574967', 'US', 'United States', 'LA'),  -- Shreveport Refinery · pip
    ('relation:10367912', 'US', 'United States', 'MI'),  -- Marathon Petroleum Detroit Refinery · pip
    ('way:163834450', 'US', 'United States', 'MI'),  -- Marysville Ethanol · pip
    ('way:298262300', 'US', 'United States', 'MN'),  -- Al-Corn Clean Fuel Ethanol Plant · pip
    ('way:31107217', 'US', 'United States', 'MN'),  -- Pine Bend Refinery · pip
    ('way:724652474', 'US', 'United States', 'MN'),  -- POET Biorefining · pip
    ('way:746687959', 'US', 'United States', 'MN'),  -- Guardian Energy · pip
    ('way:1156533272', 'US', 'United States', 'MO'),  -- (unnamed) · pip
    ('way:25486964', 'US', 'United States', 'MS'),  -- Pascagoula Refinery · pip
    ('way:676570631', 'US', 'United States', 'MS'),  -- Hunt Asphalt Plant · pip
    ('way:676682209', 'US', 'United States', 'MS'),  -- Ergon Refinery · pip
    ('way:910454887', 'US', 'United States', 'MS'),  -- Hunt Southland Refining Company · pip
    ('way:675808851', 'US', 'United States', 'ND'),  -- Marathon Dickinson Renewable Diesel Facility · pip
    ('way:676408874', 'US', 'United States', 'ND'),  -- Tesoro Mandan Refinery · pip
    ('way:750326632', 'US', 'United States', 'NE'),  -- (unnamed) · pip
    ('way:143732010', 'US', 'United States', 'NJ'),  -- Paulsboro Refinery · pip
    ('node:7496854602', 'US', 'United States', 'NM'),  -- (unnamed) · pip
    ('node:7496854603', 'US', 'United States', 'NM'),  -- (unnamed) · pip
    ('node:7496854604', 'US', 'United States', 'NM'),  -- (unnamed) · pip
    ('way:317325324', 'US', 'United States', 'NM'),  -- Gallup Refinery · pip
    ('way:705312467', 'US', 'United States', 'NM'),  -- (unnamed) · pip
    ('way:103762147', 'US', 'United States', 'OH'),  -- Lima Refinery · pip
    ('way:156954112', 'US', 'United States', 'OH'),  -- Cenovus Oil Refinery · pip
    ('relation:14252507', 'US', 'United States', 'OK'),  -- Ponca City Refinery · pip
    ('relation:8167008', 'US', 'United States', 'OK'),  -- Tulsa West Refinery · pip
    ('relation:9396205', 'US', 'United States', 'OK'),  -- Wynnewood Refinery · pip
    ('way:675647363', 'US', 'United States', 'OK'),  -- Valero · pip
    ('relation:11018108', 'US', 'United States', 'PA'),  -- Philadelphia Energy Solutions: Philadelphia Refinery Complex · pip
    ('relation:9392509', 'US', 'United States', 'PA'),  -- Trainer Refinery · nearest 0.4 km; state nearest 0.4 km
    ('way:1143804962', 'US', 'United States', 'PA'),  -- American Refining Group, Inc. · pip
    ('way:676682787', 'US', 'United States', 'PA'),  -- Warren Refinery · pip
    ('way:794186756', 'US', 'United States', 'PA'),  -- Point Breeze Refinery South Yard · pip
    ('way:794186762', 'US', 'United States', 'PA'),  -- Girard Point Refinery · pip
    ('way:166893787', 'US', 'United States', 'TN'),  -- Valero Memphis Refinery · pip
    ('node:585369735', 'US', 'United States', 'TX'),  -- Lyondell-Citgo Houston Refinery · pip
    ('way:1259534772', 'US', 'United States', 'TX'),  -- (unnamed) · pip
    ('way:137844670', 'US', 'United States', 'TX'),  -- Three Rivers Refinery · pip
    ('way:1380474666', 'US', 'United States', 'TX'),  -- (unnamed) · pip
    ('way:293095776', 'US', 'United States', 'TX'),  -- The San Antonio Refinery · pip
    ('way:528529366', 'US', 'United States', 'TX'),  -- Sweeny Refinery · pip
    ('way:528532414', 'US', 'United States', 'TX'),  -- Total Port Arthur Refinery · pip
    ('way:614046483', 'US', 'United States', 'TX'),  -- Valero Port Arthur Refinery · pip
    ('way:614046484', 'US', 'United States', 'TX'),  -- Motiva Port Arthur Refinery · pip
    ('way:675722606', 'US', 'United States', 'TX'),  -- Valero Refinery · pip
    ('way:682491653', 'US', 'United States', 'TX'),  -- (unnamed) · pip
    ('way:684676287', 'US', 'United States', 'TX'),  -- Nixon Refinery · pip
    ('way:35451870', 'US', 'United States', 'UT'),  -- North Salt Lake Refinery · pip
    ('way:818164942', 'US', 'United States', 'UT'),  -- (unnamed) · pip
    ('relation:541783', 'US', 'United States', 'WA'),  -- Marathon Anacortes Refinery · nearest 0.2 km; state nearest 0.2 km
    ('relation:541784', 'US', 'United States', 'WA'),  -- Puget Sound Refinery · pip
    ('way:50875072', 'US', 'United States', 'WA'),  -- BP Cherry Point Refinery · pip
    ('way:50884180', 'US', 'United States', 'WA'),  -- Phillips66 Ferndale Refinery · pip
    ('way:626041810', 'US', 'United States', 'WA'),  -- US Oil - Tacoma Refinery · pip
    ('relation:14623864', 'US', 'United States', 'WI'),  -- Superior Refinery · pip
    ('way:993655392', 'US', 'United States', 'WI'),  -- Maquis Energy · pip
    ('way:676430383', 'US', 'United States', 'WV'),  -- Newell Refinery · pip
    ('way:1166995179', 'US', 'United States', 'WY'),  -- Silver Eagle Evanston Refinery · pip
    ('way:535256498', 'US', 'United States', 'WY'),  -- Sinclair Wyoming Refinery · pip
    ('way:537350578', 'US', 'United States', 'WY'),  -- (unnamed) · pip
    ('way:676429840', 'US', 'United States', 'WY'),  -- Newcastle Refinery · pip
    ('relation:2535698', 'UY', 'Uruguay', NULL),  -- Refinería de La Teja · pip
    ('way:180376303', 'UZ', 'Uzbekistan', NULL),  -- Qorovulbozor Neftni qayta ishlash zavodi · pip
    ('way:102819548', 'VE', 'Venezuela', NULL),  -- Refinería Amuay · pip
    ('way:157032682', 'VE', 'Venezuela', NULL),  -- Refinería El Palito · pip
    ('way:697848807', 'VI', 'Virgin Islands (U.S.)', NULL),  -- Limetree Bay Refinery · nearest 0.1 km
    ('way:584188222', 'VN', 'Vietnam', NULL),  -- Nhà máy Lọc dầu Dung Quất · pip
    ('way:628808943', 'VN', 'Vietnam', NULL),  -- Liên hợp Lọc hóa dầu Nghi Sơn (NSRP) · pip
    ('way:209159890', 'ZA', 'South Africa', NULL),  -- Sasol · pip
    ('way:269667369', 'ZA', 'South Africa', NULL),  -- Engen Refinery · pip
    ('way:352958586', 'ZA', 'South Africa', NULL),  -- Natref · pip
    ('way:476656895', 'ZA', 'South Africa', NULL),  -- Sasol · pip
    ('way:67676903', 'ZA', 'South Africa', NULL),  -- Astron Energy Cape Town Refinery · pip
    ('way:77612135', 'ZA', 'South Africa', NULL),  -- Mossgas - Gas-to-Liquids Refinery · pip
    ('way:934819490', 'ZA', 'South Africa', NULL),  -- Mossel Bay GTL · pip
    ('way:218128525', 'ZM', 'Zambia', NULL)   -- Ndola Refinery · pip
  ) AS v(id, iso_country, country, us_state)
 WHERE r.id = v.id
   AND (r.iso_country IS DISTINCT FROM v.iso_country
     OR r.country     IS DISTINCT FROM v.country
     OR r.us_state    IS DISTINCT FROM v.us_state);

COMMIT;

-- ═══ VERIFY — one SELECT; paste back every row. Every row must read ok = true,
-- and row 0 counts the rows that do not. Rows 1–16 are the acceptance counts.
-- Rows 101+ are hand-checks whose expected values were written from where the
-- refineries actually are, not copied from the generator.
-- Composite = iso_country · country · us_state (us_state only on US rows).
WITH hc(ord, id, site, expected) AS (VALUES
  -- the 20-site country hand-check (Ruwais: no UAE row exists in the registry)
  (101, 'way:296896934',      'MOL Tiszaújváros',                               'HU · Hungary'),
  (102, 'way:1449918496',     'Maysan',                                         'IQ · Iraq'),
  (103, 'way:4422045',        'Slovnaft, Bratislava',                           'SK · Slovakia'),
  (104, 'relation:10378272',  'Donges (Loire estuary, fallback 0.7 km)',        'FR · France'),
  (105, 'way:738870542',      'Lavéra (Naphtachimie platform)',                 'FR · France'),
  (106, 'way:173780737',      'Mantua (Eni Versalis)',                          'IT · Italy'),
  (107, 'way:174730736',      'Płock',                                          'PL · Poland'),
  (108, 'way:6319211',        'Esso Rotterdam, Botlek (Pernis: not in registry)', 'NL · Netherlands'),
  (109, 'relation:11366279',  'Kirishi',                                        'RU · Russia'),
  (110, 'way:236507372',      'Omsk',                                           'RU · Russia'),
  (111, 'way:516440723',      'Al Zour',                                        'KW · Kuwait'),
  (112, 'relation:6485329',   'Mina Al Ahmadi',                                 'KW · Kuwait'),
  (113, 'way:203470198',      'Abadan (2.9 km from Iraq)',                      'IR · Iran'),
  (114, 'way:676562519',      'Ras Tanura',                                     'SA · Saudi Arabia'),
  (115, 'way:91585872',       'Jamnagar (Reliance)',                            'IN · India'),
  (116, 'way:445024987',      'Lanzhou',                                        'CN · China'),
  (117, 'way:528529366',      'Sweeny',                                         'US · United States · TX'),
  (118, 'way:155513317',      'Arzew',                                          'DZ · Algeria'),
  (119, 'way:256386110',      'Bizerte (Jarzouna)',                             'TN · Tunisia'),
  (120, 'way:295875035',      'Cadereyta',                                      'MX · Mexico'),
  -- borders, fallbacks, the 3 pre-filled rows, name overrides
  (121, 'way:614086706',      'Suncor Sarnia (0.4 km from the US)',             'CA · Canada'),
  (122, 'relation:11050769',  'Orlen Lietuva (0.7 km from Latvia)',             'LT · Lithuania'),
  (123, 'way:189056000',      'Brod (0.8 km from Croatia)',                     'BA · Bosnia and Herzegovina'),
  (124, 'way:363351264',      'ATLAS-CEPSA, Ceuta',                             'ES · Spain'),
  (125, 'way:23446401',       'Pulau Bukom (largest fallback, 4.5 km)',         'SG · Singapore'),
  (126, 'way:9882741',        'Schwechat (country was ''AT'')',                 'AT · Austria'),
  (127, 'relation:11232067',  'Burghausen (country was ''DE'')',                'DE · Germany'),
  (128, 'relation:8167008',   'Tulsa West (country was ''US'')',                'US · United States · OK'),
  (129, 'way:35389033',       'SARA, Martinique (Natural Earth: part of France)', 'FR · France'),
  (130, 'way:697848807',      'Limetree Bay, St Croix (VI, so no us_state)',    'VI · Virgin Islands (U.S.)'),
  (131, 'way:157194960',      'Tüpraş İzmit (fallback 0.1 km)',                 'TR · Türkiye'),
  (132, 'relation:10757338',  'Kralupy',                                        'CZ · Czech Republic'),
  -- US state hand-check
  (201, 'way:614046484',      'Motiva Port Arthur',                             'US · United States · TX'),
  (202, 'way:1380474666',     'unnamed row at 29.745 N 95.001 W: ExxonMobil Baytown site', 'US · United States · TX'),
  (203, 'node:585369735',     'Lyondell-Citgo Houston',                         'US · United States · TX'),
  (204, 'way:1175872560',     'Garyville',                                      'US · United States · LA'),
  (205, 'way:1178437056',     'Lake Charles',                                   'US · United States · LA'),
  (206, 'way:540102358',      'Chevron Richmond',                               'US · United States · CA'),
  (207, 'way:50875072',       'BP Cherry Point',                                'US · United States · WA'),
  (208, 'way:31107217',       'Pine Bend',                                      'US · United States · MN'),
  (209, 'way:573930303',      'Kenai',                                          'US · United States · AK'),
  (210, 'relation:10367912',  'Marathon Detroit (4.0 km from Canada)',          'US · United States · MI'),
  (211, 'way:22053649',       'Joliet',                                         'US · United States · IL'),
  (212, 'relation:541783',    'Marathon Anacortes (state fallback 0.2 km)',     'US · United States · WA'),
  -- every US refinery within 10 km of another state's polygon (19)
  (301, 'relation:11018108',  'Philadelphia Energy Solutions (NJ 5.3 km)',      'US · United States · PA'),
  (302, 'relation:14623864',  'Superior (MN 6.6 km)',                           'US · United States · WI'),
  (303, 'relation:19716067',  'BP Whiting (IL 2.6 km)',                         'US · United States · IN'),
  (304, 'relation:6260703',   'Wood River, Roxana (MO 5.1 km)',                 'US · United States · IL'),
  (305, 'relation:9392509',   'Trainer (NJ 1.5 km; state fallback 0.4 km)',    'US · United States · PA'),
  (306, 'way:1143804962',     'American Refining Group, Bradford (NY 2.2 km)',  'US · United States · PA'),
  (307, 'way:1389435302',     'Safety-Kleen, East Chicago (IL 3.8 km)',         'US · United States · IN'),
  (308, 'way:143732010',      'Paulsboro (PA 2.8 km)',                          'US · United States · NJ'),
  (309, 'way:156954112',      'Cenovus Toledo, Oregon OH (MI 5.6 km)',          'US · United States · OH'),
  (310, 'way:166893787',      'Valero Memphis (AR 4.9 km)',                     'US · United States · TN'),
  (311, 'way:25486964',       'Pascagoula (AL 9.7 km)',                         'US · United States · MS'),
  (312, 'way:306282764',      'Buckeye Hammond (IL 4.4 km)',                    'US · United States · IN'),
  (313, 'way:528532414',      'Total Port Arthur (LA 9.4 km)',                  'US · United States · TX'),
  (314, 'way:614046483',      'Valero Port Arthur (LA 9.3 km)',                 'US · United States · TX'),
  (315, 'way:620945041',      'Delaware City (NJ 6.7 km)',                      'US · United States · DE'),
  (316, 'way:676430383',      'Newell (OH 1.5 km)',                             'US · United States · WV'),
  (317, 'way:676682209',      'Ergon, Vicksburg (LA 5.4 km)',                   'US · United States · MS'),
  (318, 'way:794186756',      'Point Breeze, Philadelphia (NJ 4.9 km)',         'US · United States · PA'),
  (319, 'way:794186762',      'Girard Point, Philadelphia (NJ 4.1 km)',         'US · United States · PA')
),
r AS (
  SELECT id, iso_country, country, us_state FROM public.refineries
),
checks(ord, check_name, expected, actual) AS (
  SELECT 1, 'us_state column exists (data_type)', 'text',
         (SELECT data_type::text FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'refineries' AND column_name = 'us_state')
  UNION ALL
  SELECT 2, 'CHECK refineries_us_state_format_chk present', '1',
         (SELECT count(*)::text FROM pg_constraint
           WHERE conrelid = 'public.refineries'::regclass AND conname = 'refineries_us_state_format_chk')
  UNION ALL
  SELECT 3, 'CHECK refineries_us_state_requires_us_chk present', '1',
         (SELECT count(*)::text FROM pg_constraint
           WHERE conrelid = 'public.refineries'::regclass AND conname = 'refineries_us_state_requires_us_chk')
  UNION ALL
  SELECT 4, 'rows in public.refineries', '634', (SELECT count(*)::text FROM r)
  UNION ALL
  SELECT 5, 'count(iso_country) (acceptance: >= 603 of 634)', '634', (SELECT count(iso_country)::text FROM r)
  UNION ALL
  SELECT 6, 'count(country)', '634', (SELECT count(country)::text FROM r)
  UNION ALL
  SELECT 7, 'count(distinct iso_country)', '101', (SELECT count(DISTINCT iso_country)::text FROM r)
  UNION ALL
  SELECT 8, 'distinct (iso_country, country) pairs (one name per code)', '101',
         (SELECT count(*)::text FROM (SELECT DISTINCT iso_country, country FROM r WHERE iso_country IS NOT NULL) d)
  UNION ALL
  SELECT 9, 'rows whose country is still a 2-letter code', '0',
         (SELECT count(*)::text FROM r WHERE country ~ '^[A-Z]{2}$')
  UNION ALL
  SELECT 10, 'unresolved ids (iso_country IS NULL)', 'none',
         (SELECT COALESCE(string_agg(id, ' ' ORDER BY id), 'none') FROM r WHERE iso_country IS NULL)
  UNION ALL
  SELECT 11, 'US rows (iso_country = ''US'')', '118', (SELECT count(*)::text FROM r WHERE iso_country = 'US')
  UNION ALL
  SELECT 12, 'US rows: count(us_state)', '118', (SELECT count(us_state)::text FROM r WHERE iso_country = 'US')
  UNION ALL
  SELECT 13, 'US rows: count(distinct us_state)', '30', (SELECT count(DISTINCT us_state)::text FROM r WHERE iso_country = 'US')
  UNION ALL
  SELECT 14, 'us_state set on a non-US row', '0',
         (SELECT count(*)::text FROM r WHERE us_state IS NOT NULL AND iso_country IS DISTINCT FROM 'US')
  UNION ALL
  SELECT 15, 'US rows with no us_state (ids)', 'none',
         (SELECT COALESCE(string_agg(id, ' ' ORDER BY id), 'none') FROM r WHERE iso_country = 'US' AND us_state IS NULL)
  UNION ALL
  SELECT 16, 'firms_monitored_facilities: refinery rows with NULL facility_country', '0',
         (SELECT count(*)::text FROM public.firms_monitored_facilities
           WHERE facility_type = 'refinery' AND facility_country IS NULL)
  UNION ALL
  SELECT 17, 'hand-check mismatches (rows 101+)', '0',
         (SELECT count(*)::text FROM hc
           WHERE hc.expected IS DISTINCT FROM
                 (SELECT concat_ws(' · ', r.iso_country, r.country, r.us_state) FROM r WHERE r.id = hc.id))
  UNION ALL
  SELECT hc.ord, 'hand-check · ' || hc.site || ' · ' || hc.id, hc.expected,
         (SELECT concat_ws(' · ', r.iso_country, r.country, r.us_state) FROM r WHERE r.id = hc.id)
    FROM hc
)
SELECT ord, check_name, expected, actual, expected IS NOT DISTINCT FROM actual AS ok
  FROM (
    SELECT 0 AS ord, 'FAILING CHECKS (rows below with ok = false)' AS check_name, '0' AS expected,
           (SELECT count(*) FROM checks c WHERE c.expected IS DISTINCT FROM c.actual)::text AS actual
    UNION ALL
    SELECT ord, check_name, expected, actual FROM checks
  ) v
 ORDER BY ord;
