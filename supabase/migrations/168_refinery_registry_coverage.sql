-- 168 · refineries: registry coverage for active theatres (Reality Check PR-11)
--       site_type column · 96 watched non-refineries re-typed · 16 strike-claim
--       refineries inserted by OSM id · a dated watch item
--
-- WHY. The Reality Check board (PR-5) publishes a funnel over "watched
-- refineries". Read on 2026-09-18, that population was wrong in both
-- directions:
--
--   1. 96 of the 431 watched refinery-tagged sites are not crude-oil
--      refineries: terminals and depots, petrochemical works, ethanol and
--      renewable-diesel plants, gas plants, oil- and gas-field units, palm-oil
--      mills, sugar factories, a smelter. Several sit in the current refuted
--      set (Marysville Ethanol; Versalis and Eni Versalis at Mantua;
--      Naphtachimie and the Petroineos rail terminal at Lavéra). Nothing in
--      the registry could say so: refineries had no type column, and the OSM
--      ingest rewrites whole rows. Re-typing moves the headline, which is
--      why this lands before PR-5.
--   2. Of the 15 refineries named in recent Russia–Ukraine strike claims,
--      13 were absent (Ryazan, Volgograd, Syzran, Saratov, Tuapse, Afipsky,
--      Ilsky, Novokuibyshevsk, Kstovo, Yaroslavl, Nizhnekamsk, Kremenchuk,
--      Ufa); Omsk was registered but outside every FIRMS box; only Kirishi
--      was watched.
--
-- WHY THE INGEST MISSED THEM. app/api/cron/ingest-osm-refineries asks Overpass
-- for exactly three tags: man_made=petroleum_refinery, industrial=refinery,
-- industrial=oil_refinery. Read from the OSM API on 2026-09-18, none of the 16
-- objects below carries any of them: 10 are industrial=oil (OSM's generic
-- "oil industry" value) and 6 are landuse=industrial with no industrial=*
-- tag at all. Adding industrial=oil to the query is not a small fix — the
-- route's own comment records that the broader query returned ~125k features
-- (oilfields, vegetable-oil mills, paint factories), and 6 of the 16 would
-- still be missed. So they are inserted here by OSM id, and the route is not touched
-- (PR-0 edits it).
--
-- WHAT KEEPS IT.
--   · site_type is a new column the ingest never sends. Its upsert is
--     ON CONFLICT (id) DO UPDATE over the columns in the payload, so a
--     re-ingest leaves site_type alone; a row it newly INSERTS gets the
--     default 'refinery'. (supabase/tests/pr11_guards.sql replays that upsert.)
--   · The 16 inserted rows do not match the ingest's tag query, so a
--     re-ingest never returns them and never touches them. The ingest never
--     deletes.
--   · country / iso_country follow PR-0 (migration 158): ISO alpha-2 plus the
--     English name spelled as power_plants.country spells it ('Russia',
--     'Ukraine'). us_state stays NULL (non-US). Omsk and Kirishi get theirs
--     from 158, not from here; the VERIFY below reads them.
--
-- SOURCES. Each id was resolved with a handful of public read-only requests
-- (Nominatim search, then the OSM API /api/0.6/<type>/<id>/full) on
-- 2026-09-18. latitude/longitude are the centre of the object's bounding box
-- — the value the ingest's Overpass `out center` produces — and each was
-- checked to fall INSIDE its own polygon (ray casting over the outer rings,
-- holes honoured); all 16 did. source_tags are the object's tags exactly as
-- the OSM API returned them. refinery_name follows the ingest's rule
-- (name:en, else name). geom is set by refineries_set_geom_trg.
--
-- WHICH PLANTS. Nizhnekamsk is two crude refineries, both inserted: TANECO
-- (way:242185403) and the TAIF-NK refinery (way:203381296, "ОАО ТАИФ-НК";
-- its separate gasoline plant and deep-conversion complex are not inserted).
-- Ufa is Bashneft's three crude refineries, all inserted: Ufaneftekhim,
-- Novoil and UNPZ. Under the 5 km single-linkage complex rule (D-8) TANECO and
-- TAIF-NK form one complex (~3.4 km apart); in Ufa, UNPZ and Novoil form one
-- (~3.7 km) and Ufaneftekhim is its own (~5.9 km from Novoil). Afipsky uses
-- the tagged multipolygon (relation:18874378, name:en Afipsky Refinery), not
-- its duplicate-named outer way:47090272.
--
-- RE-TYPING RULE. A row is re-typed only on evidence in its own name or OSM
-- tags, or — marked [operator] / [location] below — where the name or place
-- identifies a known non-refinery. Each UPDATE row is guarded by the name read
-- on 2026-09-18 (IS NOT DISTINCT FROM) and only moves a row that still has
-- the default 'refinery', so it never overwrites a later decision and a
-- re-run changes nothing. Rows with no evidence (about 40 unnamed
-- landuse=industrial polygons, parts of refineries, closed refineries) stay
-- 'refinery': site_type says what a site IS, not whether it runs.
--
-- WHO READS IT. Nothing yet. FIRMS and Black Marble keep observing every row
-- (their rosters do not read site_type, so no history is lost and a re-type
-- is reversible). The Reality Check board population (PR-5) and every
-- "watched refineries" figure filter site_type = 'refinery'; the funnel's
-- watched count is re-published after this merges.
--
-- NEW SITES START EMPTY. FIRMS history cannot be backfilled: the ingest keeps
-- only detections within 8 km of an already-monitored facility and prunes the
-- rest after 3 days, and none of the 16 had a refinery or a >= 500 MW plant
-- within 13 km. Their FIRMS baselines build in wall-clock time from the first
-- hourly FIRMS run after this file is applied (they sit inside the current
-- ru-ua box). Black Marble can be backfilled — scoped run, see the PR. Until a
-- site carries a baseline it reads VOID_INSUFFICIENT_NIGHTS: expected.
--
-- CHECK QUERIES FOR LATER (not run by this file)
--   Within 24 h of the deploy (the 16 + Omsk each in firms_facility_observations):
--     SELECT r.id, r.refinery_name, min(o.period) AS first_day, count(o.period) AS days
--       FROM public.refineries r
--       LEFT JOIN public.firms_facility_observations o
--              ON o.facility_type = 'refinery' AND o.facility_id = r.id
--      WHERE r.id IN (
--        'way:59165930', 'relation:17219746', 'way:177076429', 'relation:12537907',
--        'relation:3532772', 'relation:18874378', 'way:58202189', 'relation:7533661',
--        'way:60217666', 'way:55556171', 'way:242185403', 'way:203381296',
--        'relation:4096524', 'way:115832750', 'relation:3138434', 'way:186584015',
--        'way:236507372')
--      GROUP BY 1, 2 ORDER BY 3 NULLS FIRST;
--   ~40 days after apply (the ledger watch item seeded below): >= 30 on both.
--     SELECT r.id, r.refinery_name,
--            (SELECT count(DISTINCT o.period) FROM public.firms_facility_observations o
--              WHERE o.facility_type = 'refinery' AND o.facility_id = r.id)      AS firms_days,
--            (SELECT count(*) FROM public.blackmarble_facility_radiance b
--              WHERE b.facility_type = 'refinery' AND b.facility_id = r.id)      AS bm_nights,
--            (SELECT count(*) FROM public.blackmarble_facility_radiance b
--              WHERE b.facility_type = 'refinery' AND b.facility_id = r.id
--                AND b.cloud_confidence = 'confident_clear'
--                AND b.radiance IS NOT NULL)                                     AS bm_usable_clear
--       FROM public.refineries r
--      WHERE r.id IN (
--        'way:59165930', 'relation:17219746', 'way:177076429', 'relation:12537907',
--        'relation:3532772', 'relation:18874378', 'way:58202189', 'relation:7533661',
--        'way:60217666', 'way:55556171', 'way:242185403', 'way:203381296',
--        'relation:4096524', 'way:115832750', 'relation:3138434', 'way:186584015',
--        'way:236507372')
--      ORDER BY 3, 4;
--
-- Apply MANUALLY in the Supabase SQL Editor BEFORE merge — the whole file, not
-- a highlighted selection — after 158 (PR-0). Paste back the VERIFY rows:
-- every row must read ok = true. Idempotent: a second run changes nothing.

BEGIN;

-- ─── 1 · site_type ──────────────────────────────────────────────────────────
ALTER TABLE public.refineries
  ADD COLUMN IF NOT EXISTS site_type text NOT NULL DEFAULT 'refinery';

COMMENT ON COLUMN public.refineries.site_type IS
  'What the site is (mig 168): refinery (crude-oil refinery, the default) | petrochemical | ethanol_biofuel | gas_processing | terminal | upstream | other. Never written by the OSM ingest. Reality Check populations filter site_type = ''refinery''. Says what a site is, not whether it operates.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.refineries'::regclass
                    AND conname  = 'refineries_site_type_chk') THEN
    ALTER TABLE public.refineries
      ADD CONSTRAINT refineries_site_type_chk
      CHECK (site_type IN ('refinery', 'petrochemical', 'ethanol_biofuel',
                           'gas_processing', 'terminal', 'upstream', 'other'));
  END IF;
END
$$;

-- ─── 2 · re-type the 96 watched non-refineries ─────────────────────────────
-- [name] / [tag]: evidence in the row's own name or OSM tags.
-- [operator] / [location]: the name or the place identifies a known non-refinery.
UPDATE public.refineries AS r
   SET site_type = v.site_type
  FROM (VALUES
    ('relation:18204336'::text, 'Suncor - Burrard Terminal'::text, 'terminal'::text),  -- [name] name: 'Burrard Terminal' (Burrard Inlet products terminal)
    ('relation:6417288', 'Terminal Wagram', 'terminal'),  -- [name] name: 'Terminal Wagram' (Reichstett, former refinery site, now storage terminal)
    ('way:11638316', 'HES Wilhelmshaven Tank Terminal', 'terminal'),  -- [name] name: 'Tank Terminal'
    ('way:1216294503', 'Parque de Abastecimento da Boa Nova', 'terminal'),  -- [name] name: 'Parque de Abastecimento' = supply/storage depot
    ('way:174730735', 'Unimot Terminale', 'terminal'),  -- [name] name: 'Terminale'
    ('way:174730741', 'Exolum Amsterdam B.V.', 'terminal'),  -- [operator] name = Exolum (bulk-liquid storage company); tag seveso only
    ('way:233051351', 'Kalundborg Raffinaderihavn', 'terminal'),  -- [name] name: 'Raffinaderihavn' = refinery harbour
    ('way:28813313', 'Raffineriehafen der BP Gelsenkirchen GmbH', 'terminal'),  -- [name] name: 'Raffineriehafen' = refinery harbour
    ('way:293123123', 'Raffineria ISAB sito sud - Pontile', 'terminal'),  -- [name] name: 'Pontile' = jetty
    ('way:306282764', 'Buckeye Hammond Facility', 'terminal'),  -- [tag] operator=Buckeye Partners (pipelines and terminals)
    ('way:166334648', 'IOCL Paradip Refinery Tankfarm', 'terminal'),  -- [name] name: 'Tankfarm'
    ('way:203574530', 'المستودعات', 'terminal'),  -- [name] name: 'al-mustawdaat' = 'the depots'
    ('way:476855039', 'IOCL Terminal', 'terminal'),  -- [name] name: 'Terminal'
    ('way:812604850', 'Kerteh Oil Terminal', 'terminal'),  -- [name] name: 'Oil Terminal'
    ('way:88181773', 'Terminal Petromidia', 'terminal'),  -- [name] name: 'Terminal'
    ('way:42016332', 'Dépôt Rouen Petit-Couronne', 'terminal'),  -- [name] name: 'Dépôt' = depot (Petit-Couronne refinery closed 2013)
    ('way:55336680', 'Petroineos - Terminal Rail Route', 'terminal'),  -- [name] name: 'Terminal Rail Route' (Lavéra rail terminal)
    ('way:661007793', 'Puerto de Refinería', 'terminal'),  -- [name] name: 'Puerto' = refinery port (url: Cepsa Gibraltar-San Roque)
    ('way:363351264', 'ATLAS-CEPSA', 'terminal'),  -- [location] Ceuta (35.89 N, -5.34 E): no refinery exists in Ceuta; Atlas S.A. is Cepsa's fuel-distribution company there
    ('relation:14090332', 'КазаньОргсинтез', 'petrochemical'),  -- [name] Kazanorgsintez (polyethylene/polycarbonate producer); man_made=works
    ('way:161212773', 'Evonik Degussa Antwerpen', 'petrochemical'),  -- [name] name: Evonik (speciality chemicals)
    ('way:173780737', 'Eni Versalis', 'petrochemical'),  -- [tag] url=versalis.eni.com (Eni's chemicals arm), Mantua
    ('way:773097705', 'Versalis', 'petrochemical'),  -- [tag] url=versalis.eni.com (Eni's chemicals arm), Mantua
    ('way:174730747', 'INEOS Nitriles', 'petrochemical'),  -- [name] name: 'Nitriles' (acrylonitrile plant)
    ('way:1136914983', 'Tasnee', 'petrochemical'),  -- [name] Tasnee (petrochemicals), Jubail
    ('way:1136915141', 'Sharq', 'petrochemical'),  -- [name] Sharq = Eastern Petrochemical Co., Jubail
    ('way:622299690', 'Ibn Zahr', 'petrochemical'),  -- [name] Ibn Zahr (SABIC affiliate: MTBE/polypropylene), Jubail
    ('way:1337603633', 'Engro Polymer and Chemicals Limited (EPCL)', 'petrochemical'),  -- [name] name: 'Polymer and Chemicals' (PVC)
    ('way:28451871', 'Plateforme chimique du Pont-de-Claix', 'petrochemical'),  -- [name] name: 'Plateforme chimique' = chemical platform
    ('way:6319326', 'Exxonmobil Chemical Holland', 'petrochemical'),  -- [name] name: 'Chemical'
    ('way:614756788', 'Dow Portugal', 'petrochemical'),  -- [name] Dow (chemicals), Estarreja
    ('way:770877215', 'Indorama', 'petrochemical'),  -- [tag] operator=Indorama Ventures Portugal PTA (purified terephthalic acid)
    ('way:738870542', 'Plateforme pétrochimique de Lavera - Naphtachimie', 'petrochemical'),  -- [name] name: 'Plateforme pétrochimique … Naphtachimie' (steam cracker)
    ('way:296896934', 'MOL Tiszaújváros Refinery', 'petrochemical'),  -- [tag] operator=MOL Petrolkémia Zrt. (MOL's petrochemical company, ex-TVK); MOL's Hungarian crude refinery is Duna
    ('way:163834450', 'Marysville Ethanol', 'ethanol_biofuel'),  -- [name] name: 'Ethanol'
    ('way:298262300', 'Al-Corn Clean Fuel Ethanol Plant', 'ethanol_biofuel'),  -- [name] name: 'Ethanol Plant'
    ('way:724652474', 'POET Biorefining', 'ethanol_biofuel'),  -- [name] POET Biorefining (corn ethanol)
    ('way:746687959', 'Guardian Energy', 'ethanol_biofuel'),  -- [operator] Guardian Energy (ethanol producer), Janesville MN
    ('way:993655392', 'Maquis Energy', 'ethanol_biofuel'),  -- [tag] website=hennepin.marquisenergy.com (Marquis Energy, ethanol)
    ('way:80395526', 'Bio-raffineria Eni di Crescentino', 'ethanol_biofuel'),  -- [name] name: 'Bio-raffineria' (cellulosic ethanol)
    ('way:675808851', 'Marathon Dickinson Renewable Diesel Facility', 'ethanol_biofuel'),  -- [name] name: 'Renewable Diesel Facility'
    ('way:614047441', 'Neste Singapore Refinery', 'ethanol_biofuel'),  -- [operator] Neste's Singapore plant makes renewable diesel/SAF (NEXBTL); no crude unit
    ('way:217644816', 'Total Provence Refinery', 'ethanol_biofuel'),  -- [tag] old_name=Raffinerie de Provence; wikipedia=fr:Plateforme de la Mède (crude processing ended 2016; biorefinery since 2019)
    ('way:317494344', 'پالایشگاه چهارم پارس جنوبی فاز 6 و 7 و 8', 'gas_processing'),  -- [name] South Pars 4th gas refinery (phases 6-8)
    ('way:525709337', 'پالایشگاه ششم پارس جنوبی فاز ۱۵ و۱۶', 'gas_processing'),  -- [name] South Pars 6th gas refinery (phases 15-16)
    ('way:525709341', 'پالایشگاه هشتم پارس جنوبی فاز ۲۰ و۲۱', 'gas_processing'),  -- [name] South Pars 8th gas refinery (phases 20-21)
    ('way:525709349', 'پالایشگاه هفتم پارس جنوبی فاز ۱۷ و ۱۸', 'gas_processing'),  -- [name] South Pars 7th gas refinery (phases 17-18)
    ('way:525709350', 'پالایشگاه پنجم پارس جنوبی فاز ۹ و ۱۰', 'gas_processing'),  -- [name] South Pars 5th gas refinery (phases 9-10)
    ('way:525717121', 'پالایشگاه دوم پارس جنوبی فاز ۲ و ۳', 'gas_processing'),  -- [name] South Pars 2nd gas refinery (phases 2-3)
    ('way:525717890', 'پالایشگاه سوم پارس جنوبی فاز ۴ و ۵', 'gas_processing'),  -- [name] South Pars 3rd gas refinery (phases 4-5)
    ('way:495378392', 'Parsian gas refinery', 'gas_processing'),  -- [tag] name 'gas refinery'; product=gas
    ('way:1332986148', 'Gas Processing Unit, Vaghodia', 'gas_processing'),  -- [name] name: 'Gas Processing Unit' (GAIL)
    ('way:443698404', 'Kaybob South 3 Gas Plant', 'gas_processing'),  -- [tag] name 'Gas Plant'; product=gas
    ('way:625851276', 'Kaybob South 2', 'gas_processing'),  -- [tag] product=gas (Kaybob South gas plant)
    ('way:625851282', 'Kaybob South 1', 'gas_processing'),  -- [tag] product=gas (Kaybob South gas plant)
    ('way:332519062', 'Onshore Gas Terminal', 'gas_processing'),  -- [name] name: 'Onshore Gas Terminal' (Kerteh gas reception)
    ('way:699425149', 'Terengganu Gas Terminal', 'gas_processing'),  -- [name] name: 'Gas Terminal'
    ('way:362351663', 'Terminal Gas dan Cecair', 'gas_processing'),  -- [tag] short_name=GPP (gas processing plant); produce=gas
    ('way:527443310', 'Onshore Slug Catcher', 'gas_processing'),  -- [name] name: 'Slug Catcher' (gas-condensate reception)
    ('way:527443311', NULL, 'gas_processing'),  -- [tag] produce=gas; 1 km from Terengganu Gas Terminal
    ('relation:18932213', 'НИС Рафинерија гаса Елемир', 'gas_processing'),  -- [name] name: 'Рафинерија гаса' = gas refinery
    ('way:302704249', NULL, 'gas_processing'),  -- [tag] product=gas (Khuzestan)
    ('way:442917425', NULL, 'gas_processing'),  -- [tag] product=gas (Khuzestan)
    ('way:442917462', NULL, 'gas_processing'),  -- [tag] product=gas (Khuzestan)
    ('relation:19897853', 'NAM-locatie Overschild', 'upstream'),  -- [tag] NAM production location; product=natural_gas
    ('relation:5512299', 'NAM-locatie Amsweer', 'upstream'),  -- [tag] NAM production location; product=natural_gas
    ('way:168512752', 'NAM-locatie Kooipolder', 'upstream'),  -- [tag] NAM production location; product=natural_gas
    ('way:205754596', 'NAM-locatie Slochteren', 'upstream'),  -- [tag] NAM production location; product=natural_gas
    ('way:262082145', 'NAM-locatie Coevorden-17', 'upstream'),  -- [name] NAM production location (Coevorden gas field)
    ('way:1424094993', 'محطة عزل غاز الطوبة', 'upstream'),  -- [name] 'gas isolation station' (oilfield gas-oil separation), Tuba field
    ('way:1424218792', 'محطة عزل غاز حقل صبة', 'upstream'),  -- [name] 'gas isolation station', Subba field
    ('way:81141435', 'УППН «Кызыл-Тау»', 'upstream'),  -- [name] УППН = oil pre-treatment unit; operator NGDU Prikamneft (oil production)
    ('way:556446775', 'ППСН "Кез" ОАО "Удмуртнефть"', 'upstream'),  -- [name] ППСН = oil delivery/acceptance point, Udmurtneft (oil production)
    ('way:396383136', 'Cairn Refinery', 'upstream'),  -- [location] 16.49 N 82.09 E = Cairn's Ravva onshore processing terminal (Cairn owns no refinery)
    ('way:590280338', 'Shaybah Refinery', 'upstream'),  -- [location] Shaybah field (22.68 N 54.13 E): Aramco central processing/NGL facilities, no refinery
    ('way:1050701688', 'PKS PTPN IV Puluraja', 'other'),  -- [name] PKS = Pabrik Kelapa Sawit (palm-oil mill)
    ('way:1306585376', 'Niah Palm Oil Mill', 'other'),  -- [name] name: 'Palm Oil Mill'
    ('way:584926981', 'Sandakan Edible Oils Sdn. Bhd.', 'other'),  -- [name] name: 'Edible Oils'
    ('way:841169851', 'Kunak Refinery Sdn Bhd', 'other'),  -- [tag] product=palm_oil
    ('way:207012038', 'Raffinerie de sucre', 'other'),  -- [name] name: 'Raffinerie de sucre' = sugar refinery
    ('way:833845775', 'Fabrica de zahăr', 'other'),  -- [name] name: 'Fabrica de zahăr' = sugar factory
    ('way:295375063', 'Bunge', 'other'),  -- [tag] website=bunge.com (oilseed processing); product=oil
    ('way:891696592', 'Cargill Hamburg-Harburg', 'other'),  -- [name] Cargill (oilseed crushing/refining), Hamburg-Harburg
    ('way:453238234', 'North Vancouver Liquid Waste Facility', 'other'),  -- [tag] description='Waste oil is re-refined into usable products'; operator=GFL Environmental
    ('way:1389435302', 'Safety-Kleen Systems', 'other'),  -- [operator] Safety-Kleen East Chicago = used-oil re-refinery
    ('way:635770194', 'Carmen Concentrator', 'other'),  -- [name] name: 'Concentrator' (Carmen Copper, Toledo City, Cebu)
    ('way:761162786', 'Plastic and Tools, Inc.', 'other'),  -- [name] plastics manufacturer
    ('relation:4850228', 'Оргхим', 'other'),  -- [tag] description='former Uren wood-chemical plant'
    ('way:569868591', 'ООО "Метоксил", ветлужский завод', 'other'),  -- [tag] description: former wood-chemical combine; resins, inhibitors, foundry binders
    ('way:220791937', 'Jeongju Refinery', 'other'),  -- [tag] name:ko=정주제련소 (제련소 = metal smelter); old_name Pyongbuk Refinery (smelter)
    ('way:29343421', 'Stanic', 'other'),  -- [tag] abandoned:landuse=industrial (Bari; former refinery)
    ('way:1156533272', NULL, 'other'),  -- [tag] landuse=brownfield; old_name=Amoco Sugar Creek Refinery
    ('way:840880654', NULL, 'other'),  -- [tag] landuse=brownfield (0.5 km from CPCL Refinery)
    ('way:824150385', NULL, 'other'),  -- [tag] description='Chip Stge' (wood-chip storage)
    ('way:824150386', NULL, 'other'),  -- [tag] description='Chip Pile'
    ('way:824150387', NULL, 'other')   -- [tag] description='Chip Pile'
  ) AS v(id, expected_name, site_type)
 WHERE r.id = v.id
   AND r.site_type = 'refinery'
   AND r.refinery_name IS NOT DISTINCT FROM v.expected_name;

-- ─── 3 · insert the 16 strike-claim refineries ─────────────────────────────
INSERT INTO public.refineries (
  id, osm_type, osm_id, refinery_name, operator, owner, product, start_date,
  country, iso_country, city, wiki_url, source_tags, latitude, longitude, site_type
) VALUES
  -- Ryazan · https://www.openstreetmap.org/way/59165930
    ('way:59165930', 'way', 59165930, 'ЗАО "РНПК"', NULL, NULL, NULL, NULL, 'Russia', 'RU', NULL, 'https://www.wikidata.org/wiki/Q55664215', $tags${"barrier": "wall", "industrial": "oil", "landuse": "industrial", "name": "ЗАО \"РНПК\"", "source": "Bing", "wikidata": "Q55664215"}$tags$::jsonb, 54.5618321, 39.7494320, 'refinery'),
  -- Volgograd · https://www.openstreetmap.org/relation/17219746
    ('relation:17219746', 'relation', 17219746, 'Волгоградский нефтеперерабатывающий завод', NULL, NULL, NULL, NULL, 'Russia', 'RU', 'Волгоград', 'https://www.wikidata.org/wiki/Q24938034', $tags${"addr:city": "Волгоград", "addr:country": "RU", "fire_object:type": "poo", "fire_operator": "RU-VGG-1-7", "fire_rank": "2", "fixme": "power lines, offsets", "landuse": "industrial", "name": "Волгоградский нефтеперерабатывающий завод", "name:ru": "Волгоградский нефтеперерабатывающий завод", "type": "multipolygon", "website": "https://vnpz.lukoil.ru", "wikidata": "Q24938034", "wikipedia": "ru:Лукойл-Волгограднефтепереработка", "wikipedia:ru": "Лукойл-Волгограднефтепереработка"}$tags$::jsonb, 48.4922191, 44.6266661, 'refinery'),
  -- Syzran · https://www.openstreetmap.org/way/177076429
    ('way:177076429', 'way', 177076429, 'Syzran Oil Refinery', 'Роснефть', NULL, NULL, '1942', 'Russia', 'RU', NULL, 'https://www.wikidata.org/wiki/Q4447906', $tags${"addr:housenumber": "1", "addr:street": "Астраханская улица", "alt_name": "Сызранский НПЗ", "image": "https://upload.wikimedia.org/wikipedia/commons/3/35/GOR_3494_copy.jpg", "landuse": "industrial", "name": "Сызранский нефтеперерабатывающий завод", "name:en": "Syzran Oil Refinery", "official_name": "Акционерное общество «Сызранский нефтеперерабатывающий завод»", "operator": "Роснефть", "start_date": "1942", "website": "https://snpz.rosneft.ru/about/Glance/OperationalStructure/Pererabotka/snpz/", "wikidata": "Q4447906", "wikipedia": "ru:Сызранский нефтеперерабатывающий завод"}$tags$::jsonb, 53.0801393, 48.3939727, 'refinery'),
  -- Saratov · https://www.openstreetmap.org/relation/12537907
    ('relation:12537907', 'relation', 12537907, 'Саратовский нефтеперерабатывающий завод', NULL, NULL, NULL, '1934', 'Russia', 'RU', NULL, 'https://www.wikidata.org/wiki/Q4408468', $tags${"landuse": "industrial", "name": "Саратовский нефтеперерабатывающий завод", "start_date": "1934", "type": "multipolygon", "wikidata": "Q4408468", "wikipedia": "ru:Саратовский нефтеперерабатывающий завод"}$tags$::jsonb, 51.4508454, 45.9440206, 'refinery'),
  -- Tuapse · https://www.openstreetmap.org/relation/3532772
    ('relation:3532772', 'relation', 3532772, 'Tuapse Refinery', 'ПАО «НК „Роснефть“»', NULL, NULL, '1929', 'Russia', 'RU', NULL, 'https://www.wikidata.org/wiki/Q4464791', $tags${"alt_name": "Туапсинский НПЗ", "fire_operator": "RU-KDA-6-10", "fire_rank": "3", "image": "https://upload.wikimedia.org/wikipedia/commons/4/4e/Туапсе_Росфнефть.jpg", "industrial": "oil", "landuse": "industrial", "name": "Туапсинский нефтеперерабатывающий завод", "name:en": "Tuapse Refinery", "name:fr": "Raffinerie de Touapsé", "name:uk": "Туапсинський нафтопереробний завод", "operator": "ПАО «НК „Роснефть“»", "start_date": "1929", "type": "multipolygon", "wikidata": "Q4464791", "wikimedia_commons": "Category:Tuapse Refinery", "wikipedia": "ru:Туапсинский нефтеперерабатывающий завод"}$tags$::jsonb, 44.1028253, 39.0983460, 'refinery'),
  -- Afipsky · https://www.openstreetmap.org/relation/18874378
    ('relation:18874378', 'relation', 18874378, 'Afipsky Refinery', NULL, NULL, NULL, NULL, 'Russia', 'RU', NULL, 'https://www.wikidata.org/wiki/Q112960406', $tags${"area": "yes", "industrial": "oil", "landuse": "industrial", "name": "Афипский НПЗ", "name:en": "Afipsky Refinery", "name:ru": "Афипский НПЗ", "type": "multipolygon", "wikidata": "Q112960406"}$tags$::jsonb, 44.8826772, 38.8263919, 'refinery'),
  -- Ilsky · https://www.openstreetmap.org/way/58202189
    ('way:58202189', 'way', 58202189, 'Ilskiy refinery plant', NULL, NULL, NULL, '2001', 'Russia', 'RU', NULL, 'https://www.wikidata.org/wiki/Q4199956', $tags${"alt_name": "Ильский НПЗ", "contact:email": "info@i-npz.ru", "contact:phone": "+7 861 2001820", "contact:website": "https://www.i-npz.ru", "fire_object:type": "poo", "fire_operator": "RU-KDA-12-80", "fire_rank": "3", "image": "https://upload.wikimedia.org/wikipedia/commons/b/b5/Технологическая_установка_АТ-3.jpg", "industrial": "oil", "landuse": "industrial", "name": "Ильский нефтеперерабатывающий завод", "name:en": "Ilskiy refinery plant", "name:uk": "Ільський нафтопереробний завод", "start_date": "2001", "wikidata": "Q4199956", "wikimedia_commons": "Category:Ilskiy refinery plant", "wikipedia": "ru:Ильский нефтеперерабатывающий завод"}$tags$::jsonb, 44.8603289, 38.6090728, 'refinery'),
  -- Novokuibyshevsk · https://www.openstreetmap.org/relation/7533661
    ('relation:7533661', 'relation', 7533661, 'Новокуйбышевский НПЗ', NULL, NULL, NULL, NULL, 'Russia', 'RU', NULL, NULL, $tags${"landuse": "industrial", "name": "Новокуйбышевский НПЗ", "short_name": "КНПЗ", "type": "multipolygon"}$tags$::jsonb, 53.0967879, 49.9079408, 'refinery'),
  -- Kstovo (NORSI) · https://www.openstreetmap.org/way/60217666
    ('way:60217666', 'way', 60217666, 'ОАО ЛУКОЙЛ-Нижегороднефтеоргсинтез', NULL, NULL, NULL, NULL, 'Russia', 'RU', NULL, 'https://www.wikidata.org/wiki/Q4269070', $tags${"landuse": "industrial", "name": "ОАО ЛУКОЙЛ-Нижегороднефтеоргсинтез", "source": "bing", "wikidata": "Q4269070"}$tags$::jsonb, 56.1000570, 44.1610197, 'refinery'),
  -- Yaroslavl (Slavneft-YANOS) · https://www.openstreetmap.org/way/55556171
    ('way:55556171', 'way', 55556171, 'Ярославнефтеоргсинтез', NULL, NULL, NULL, '1961', 'Russia', 'RU', NULL, 'https://www.wikidata.org/wiki/Q4538810', $tags${"alt_name": "Ярославский НПЗ", "contact:website": "http://www.refinery.yaroslavl.ru", "industrial": "oil", "landuse": "industrial", "layer": "0", "name": "Ярославнефтеоргсинтез", "old_name": "Новоярославский ордена Трудового Красного Знамени НПЗ имени 50-летия ВЛКСМ", "short_name": "Славнефть-ЯНОС", "start_date": "1961", "wikidata": "Q4538810", "wikimedia_commons": "Category:Yaroslavlnefteorgsintez", "wikipedia": "ru:Ярославнефтеоргсинтез"}$tags$::jsonb, 57.5453294, 39.7889203, 'refinery'),
  -- Nizhnekamsk (TANECO) · https://www.openstreetmap.org/way/242185403
    ('way:242185403', 'way', 242185403, 'Taneko oil refinery', NULL, NULL, NULL, NULL, 'Russia', 'RU', NULL, 'https://www.wikidata.org/wiki/Q28667150', $tags${"alt_name": "Nizhnekamsk oil refinery", "industrial": "oil", "landuse": "industrial", "name": "ТАНЕКО", "name:en": "Taneko oil refinery", "name:ru": "ТАНЕКО", "wikidata": "Q28667150"}$tags$::jsonb, 55.5707388, 51.9055285, 'refinery'),
  -- Nizhnekamsk (TAIF-NK refinery) · https://www.openstreetmap.org/way/203381296
    ('way:203381296', 'way', 203381296, 'ОАО "ТАИФ-НК"', NULL, NULL, NULL, NULL, 'Russia', 'RU', NULL, NULL, $tags${"landuse": "industrial", "name": "ОАО \"ТАИФ-НК\""}$tags$::jsonb, 55.6001715, 51.9151543, 'refinery'),
  -- Kremenchuk · https://www.openstreetmap.org/relation/4096524
    ('relation:4096524', 'relation', 4096524, 'Кременчуцький нафтопереробний завод', NULL, NULL, NULL, NULL, 'Ukraine', 'UA', NULL, NULL, $tags${"industrial": "oil", "landuse": "industrial", "name": "Кременчуцький нафтопереробний завод", "name:ru": "Кременчугский нефтеперерабатывающий завод", "name:uk": "Кременчуцький нафтопереробний завод", "type": "multipolygon"}$tags$::jsonb, 49.1710285, 33.4683883, 'refinery'),
  -- Ufa (Bashneft-Ufaneftekhim) · https://www.openstreetmap.org/way/115832750
    ('way:115832750', 'way', 115832750, 'Башнефть-Уфанефтехим', NULL, NULL, NULL, '1954', 'Russia', 'RU', NULL, 'https://www.wikidata.org/wiki/Q654845', $tags${"contact:website": "https://www.rosneft.ru/business/Downstream/refining/neftekompleksbashneft/", "industrial": "oil", "landuse": "industrial", "name": "Башнефть-Уфанефтехим", "name:ba": "Башнефть-Өфөнефтехим", "old_name": "Уфимский нефтеперерабатывающий завод имени XXII съезда КПСС", "start_date": "1954", "wikidata": "Q654845", "wikipedia": "ru:Башнефть-Уфанефтехим"}$tags$::jsonb, 54.9322189, 56.0586792, 'refinery'),
  -- Ufa (Bashneft-Novoil) · https://www.openstreetmap.org/relation/3138434
    ('relation:3138434', 'relation', 3138434, 'Башнефть-Новойл', NULL, NULL, NULL, '1951', 'Russia', 'RU', NULL, 'https://www.wikidata.org/wiki/Q4322977', $tags${"contact:website": "https://www.rosneft.ru/business/Downstream/refining/neftekompleksbashneft/", "industrial": "oil", "landuse": "industrial", "name": "Башнефть-Новойл", "name:ba": "Башнефть-Новойл", "old_name": "Ново-уфимский нефтеперерабатывающий завод", "start_date": "1951", "type": "multipolygon", "wikidata": "Q4322977", "wikipedia": "ru:Башнефть-Новойл"}$tags$::jsonb, 54.8796311, 56.0793771, 'refinery'),
  -- Ufa (Bashneft-UNPZ) · https://www.openstreetmap.org/way/186584015
    ('way:186584015', 'way', 186584015, 'Башнефть-УНПЗ', NULL, NULL, NULL, '1935', 'Russia', 'RU', NULL, 'https://www.wikidata.org/wiki/Q4479115', $tags${"barrier": "wall", "contact:website": "https://www.rosneft.ru/business/Downstream/refining/neftekompleksbashneft/", "industrial": "oil", "landuse": "industrial", "name": "Башнефть-УНПЗ", "name:ba": "Башнефть-ӨНЭЗ", "old_name": "Уфимский нефтеперерабатывающий завод", "start_date": "1935", "wikidata": "Q4479115", "wikipedia": "ru:Башнефть-УНПЗ"}$tags$::jsonb, 54.8467829, 56.0961959, 'refinery')
ON CONFLICT (id) DO NOTHING;

-- ─── 4 · the dated follow-up, as a (manual) ledger watch item ──────────────
-- ledger_watch_prove() (mig 147) has no predicate kind for "n nights per
-- facility", so this item carries no proof and is flipped by hand; the query
-- is the second one in the header.
INSERT INTO public.ledger_watch_items (due_at, text)
SELECT now() + interval '40 days', v.text
  FROM (VALUES ('Reality Check PR-11 (mig 168): the 16 inserted strike-claim refineries and Omsk each carry >= 30 FIRMS days and >= 30 Black Marble nights (query in the 168 header). Until then they read VOID_INSUFFICIENT_NIGHTS — expected.')) AS v(text)
 WHERE NOT EXISTS (SELECT 1 FROM public.ledger_watch_items w WHERE w.text = v.text);

COMMIT;

-- ─── VERIFY — ONE SELECT (the SQL Editor shows only the last statement) ────
-- "in a box" uses the FIRMS region boxes AFTER this PR deploys (ru-ua east 74,
-- lib/firms/client.ts), through the same firms_point_in_regions() the FIRMS
-- rollup uses. Until the deploy, Omsk and ЗИиОФ are still outside ru-ua.
-- Expected counts assume no OSM re-ingest between 2026-09-18 and the apply.
WITH boxes(j) AS (
  SELECT '[{"west":22,"south":44,"east":74,"north":62},{"west":44,"south":22,"east":60,"north":34},{"west":-10,"south":35,"east":22,"north":60},{"west":100,"south":18,"east":146,"north":46},{"west":60,"south":5,"east":100,"north":37},{"west":95,"south":-11,"east":142,"north":20},{"west":-100,"south":24,"east":-52,"north":55},{"west":-130,"south":25,"east":-100,"north":55}]'::jsonb
),
r AS (
  SELECT rf.*, public.firms_point_in_regions(rf.latitude, rf.longitude, (SELECT j FROM boxes)) AS in_box
    FROM public.refineries rf
),
sites(ord, id, label, expected) AS (VALUES
  (101::int, 'way:59165930', 'Ryazan', 'RU · Russia · refinery · in a box'),
  (102, 'relation:17219746', 'Volgograd', 'RU · Russia · refinery · in a box'),
  (103, 'way:177076429', 'Syzran', 'RU · Russia · refinery · in a box'),
  (104, 'relation:12537907', 'Saratov', 'RU · Russia · refinery · in a box'),
  (105, 'relation:3532772', 'Tuapse', 'RU · Russia · refinery · in a box'),
  (106, 'relation:18874378', 'Afipsky', 'RU · Russia · refinery · in a box'),
  (107, 'way:58202189', 'Ilsky', 'RU · Russia · refinery · in a box'),
  (108, 'relation:7533661', 'Novokuibyshevsk', 'RU · Russia · refinery · in a box'),
  (109, 'way:60217666', 'Kstovo (NORSI)', 'RU · Russia · refinery · in a box'),
  (110, 'way:55556171', 'Yaroslavl (Slavneft-YANOS)', 'RU · Russia · refinery · in a box'),
  (111, 'way:242185403', 'Nizhnekamsk (TANECO)', 'RU · Russia · refinery · in a box'),
  (112, 'way:203381296', 'Nizhnekamsk (TAIF-NK refinery)', 'RU · Russia · refinery · in a box'),
  (113, 'relation:4096524', 'Kremenchuk', 'UA · Ukraine · refinery · in a box'),
  (114, 'way:115832750', 'Ufa (Bashneft-Ufaneftekhim)', 'RU · Russia · refinery · in a box'),
  (115, 'relation:3138434', 'Ufa (Bashneft-Novoil)', 'RU · Russia · refinery · in a box'),
  (116, 'way:186584015', 'Ufa (Bashneft-UNPZ)', 'RU · Russia · refinery · in a box'),
  (117, 'way:236507372', 'Omsk (registered; box widened; iso from 158)', 'RU · Russia · refinery · in a box'),
  (118, 'relation:11366279', 'Kirishi (registered, watched; iso from 158)', 'RU · Russia · refinery · in a box')
),
checks(ord, check_name, expected, actual) AS (
  SELECT 1, 'site_type column (data_type · nullable · default)', 'text · NO · ''refinery''::text',
         (SELECT concat_ws(' · ', data_type, is_nullable, column_default) FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'refineries' AND column_name = 'site_type')
  UNION ALL
  SELECT 2, 'CHECK refineries_site_type_chk present', '1',
         (SELECT count(*)::text FROM pg_constraint
           WHERE conrelid = 'public.refineries'::regclass AND conname = 'refineries_site_type_chk')
  UNION ALL
  SELECT 3, 'rows in public.refineries (634 + 16)', '650', (SELECT count(*)::text FROM r)
  UNION ALL
  SELECT 4, 'rows re-typed (site_type <> refinery)', '96', (SELECT count(*)::text FROM r WHERE site_type <> 'refinery')
  UNION ALL
  SELECT 5, 're-typed by type', 'ethanol_biofuel 9 · gas_processing 21 · other 21 · petrochemical 15 · terminal 19 · upstream 11',
         (SELECT string_agg(site_type || ' ' || n, ' · ' ORDER BY site_type)
            FROM (SELECT site_type, count(*) AS n FROM r WHERE site_type <> 'refinery' GROUP BY 1) t)
  UNION ALL
  SELECT 6, 're-typed rows outside the boxes (all 96 came from the watched set)', '0',
         (SELECT count(*)::text FROM r WHERE site_type <> 'refinery' AND NOT in_box)
  UNION ALL
  SELECT 7, 'registry rows in a box after deploy (431 + Omsk + ЗИиОФ + 16)', '449',
         (SELECT count(*)::text FROM r WHERE in_box)
  UNION ALL
  SELECT 8, 'site_type = refinery rows in a box after deploy (the new watched population)', '353',
         (SELECT count(*)::text FROM r WHERE in_box AND site_type = 'refinery')
  UNION ALL
  SELECT 9, 'the 16 inserted rows present', '16',
         (SELECT count(*)::text FROM r WHERE id IN (SELECT id FROM sites WHERE ord BETWEEN 101 AND 116))
  UNION ALL
  SELECT 10, 'the 16 in firms_monitored_facilities with a facility_country', '16',
         (SELECT count(*)::text FROM public.firms_monitored_facilities f
           WHERE f.facility_type = 'refinery' AND f.facility_country IS NOT NULL
             AND f.facility_id IN (SELECT id FROM sites WHERE ord BETWEEN 101 AND 116))
  UNION ALL
  SELECT 11, 'strike-claim sites failing their per-site row (below)', '0',
         (SELECT count(*)::text FROM sites s
           WHERE s.expected IS DISTINCT FROM
                 (SELECT concat_ws(' · ', r.iso_country, r.country, r.site_type,
                                   CASE WHEN r.geom IS NULL THEN 'NO geom' END,
                                   CASE WHEN r.in_box THEN 'in a box' ELSE 'NOT in a box' END)
                    FROM r WHERE r.id = s.id))
  UNION ALL
  SELECT 12, 'ledger watch item seeded (manual, due ~40 days after apply)', '1',
         (SELECT count(*)::text FROM public.ledger_watch_items WHERE text LIKE 'Reality Check PR-11 (mig 168)%')
  UNION ALL
  SELECT s.ord, 'site · ' || s.label || ' · ' || s.id, s.expected,
         (SELECT concat_ws(' · ', r.iso_country, r.country, r.site_type,
                           CASE WHEN r.geom IS NULL THEN 'NO geom' END,
                           CASE WHEN r.in_box THEN 'in a box' ELSE 'NOT in a box' END)
            FROM r WHERE r.id = s.id)
    FROM sites s
)
SELECT ord, check_name, expected, actual, expected IS NOT DISTINCT FROM actual AS ok
  FROM (
    SELECT 0 AS ord, 'FAILING CHECKS (rows below with ok = false)' AS check_name, '0' AS expected,
           (SELECT count(*) FROM checks c WHERE c.expected IS DISTINCT FROM c.actual)::text AS actual
    UNION ALL
    SELECT ord, check_name, expected, actual FROM checks
  ) v
 ORDER BY ord;
