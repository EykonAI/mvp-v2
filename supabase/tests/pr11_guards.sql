-- PR-11 guard tests · refineries.site_type + the strike-claim inserts (mig 168)
--
-- Run in the Supabase SQL Editor AFTER applying 168, the whole file. It wraps
-- itself in BEGIN … ROLLBACK, so the writes it makes to prove each guard are
-- undone. The first FAIL raises and aborts the file (nothing is left behind).
--
-- PASS SIGNAL: the editor's result pane shows ONE row,
--   result = 'PR-11 guards: all 8 assertions passed (0–7) …'
-- It is the file's last statement and is reached only when no assertion
-- raised; any failure shows the FAIL error instead and no row. The NOTICE
-- lines (one PASS per assertion) are the detail, if the editor shows them.
--
-- What each test proves, and what would make it fail:
--   0  the column and the CHECK exist                   (168 not applied)
--   1  an out-of-vocabulary site_type is rejected       (CHECK dropped)
--   2  site_type cannot be NULL                         (NOT NULL dropped)
--   3  the OSM ingest's upsert leaves site_type alone   (a payload that sends site_type)
--   4  a row the ingest newly inserts reads 'refinery'  (DEFAULT dropped)
--   5  the 16 inserted rows are refineries with a country, a geom and a point
--      inside the widened ru-ua box                     (insert or trigger lost)
--   6  the re-typed rows left the refinery population   (re-type not applied)
--   7  the public "refineries watched" figure (refinery_type_coverage) counts
--      site_type = 'refinery' only: a re-typed site inside the boxes is not
--      counted, a new refinery inserted inside the boxes is counted (and one
--      outside only in the registry), and it equals firms_rule_coverage minus
--      the non-refinery rows; service_role only   (filter or grants lost)

BEGIN;

-- 0 · existence
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'refineries'
                    AND column_name = 'site_type' AND is_nullable = 'NO') THEN
    RAISE EXCEPTION 'FAIL 0 · refineries.site_type (NOT NULL) is missing — apply 168 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.refineries'::regclass
                    AND conname = 'refineries_site_type_chk') THEN
    RAISE EXCEPTION 'FAIL 0 · CHECK refineries_site_type_chk is missing';
  END IF;
  RAISE NOTICE 'PASS 0 · site_type column (NOT NULL) and refineries_site_type_chk exist';
END
$$;

-- 1 · the vocabulary is enforced by the database
DO $$
BEGIN
  BEGIN
    UPDATE public.refineries SET site_type = 'refinery_maybe' WHERE id = 'way:163834450';
    RAISE EXCEPTION 'FAIL 1 · an out-of-vocabulary site_type was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS 1 · out-of-vocabulary site_type rejected (check_violation)';
  END;
END
$$;

-- 2 · NULL is not a type
DO $$
BEGIN
  BEGIN
    UPDATE public.refineries SET site_type = NULL WHERE id = 'way:163834450';
    RAISE EXCEPTION 'FAIL 2 · site_type accepted NULL';
  EXCEPTION WHEN not_null_violation THEN
    RAISE NOTICE 'PASS 2 · NULL site_type rejected (not_null_violation)';
  END;
END
$$;

-- 3 · replay the OSM ingest's upsert on a re-typed row.
-- app/api/cron/ingest-osm-refineries sends these columns and upserts
-- ON CONFLICT (id) DO UPDATE over exactly them (PostgREST merge-duplicates).
-- After PR-0 it no longer sends country / iso_country, so they are left out
-- here too. site_type is never in the payload. (capacity_bpd is in the payload
-- today; once CAP-1 renames that column, drop it from this replay.)
INSERT INTO public.refineries (id, osm_type, osm_id, refinery_name, operator, owner, product,
                               capacity_bpd, start_date, city, wiki_url, source_tags,
                               latitude, longitude)
SELECT id, osm_type, osm_id, refinery_name, operator, owner, product,
       capacity_bpd, start_date, city, wiki_url, source_tags, latitude, longitude
  FROM public.refineries
 WHERE id = 'way:163834450'
ON CONFLICT (id) DO UPDATE
  SET osm_type = EXCLUDED.osm_type, osm_id = EXCLUDED.osm_id,
      refinery_name = EXCLUDED.refinery_name, operator = EXCLUDED.operator,
      owner = EXCLUDED.owner, product = EXCLUDED.product,
      capacity_bpd = EXCLUDED.capacity_bpd, start_date = EXCLUDED.start_date,
      city = EXCLUDED.city, wiki_url = EXCLUDED.wiki_url,
      source_tags = EXCLUDED.source_tags,
      latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude;

DO $$
DECLARE t text;
BEGIN
  SELECT site_type INTO t FROM public.refineries WHERE id = 'way:163834450';
  IF t IS DISTINCT FROM 'ethanol_biofuel' THEN
    RAISE EXCEPTION 'FAIL 3 · Marysville Ethanol reads % after an ingest-shaped upsert (want ethanol_biofuel)', t;
  END IF;
  RAISE NOTICE 'PASS 3 · ingest-shaped upsert left site_type = ethanol_biofuel on way:163834450';
END
$$;

-- 4 · a row the ingest inserts for the first time gets the default
INSERT INTO public.refineries (id, osm_type, osm_id, refinery_name, source_tags, latitude, longitude)
VALUES ('node:-168000001', 'node', -168000001, 'PR-11 guard fixture (rolled back)', '{}'::jsonb, 55.0, 40.0);

DO $$
DECLARE t text; g boolean;
BEGIN
  SELECT site_type, geom IS NOT NULL INTO t, g FROM public.refineries WHERE id = 'node:-168000001';
  IF t IS DISTINCT FROM 'refinery' OR NOT g THEN
    RAISE EXCEPTION 'FAIL 4 · new row reads site_type %, geom set %', t, g;
  END IF;
  RAISE NOTICE 'PASS 4 · a newly inserted row defaults to site_type = refinery (and the geom trigger fired)';
END
$$;

-- 5 · the 16 strike-claim rows
DO $$
DECLARE n int; bad text;
BEGIN
  WITH ids(id) AS (VALUES
    ('way:59165930'), ('relation:17219746'), ('way:177076429'), ('relation:12537907'),
    ('relation:3532772'), ('relation:18874378'), ('way:58202189'), ('relation:7533661'),
    ('way:60217666'), ('way:55556171'), ('way:242185403'), ('way:203381296'),
    ('relation:4096524'), ('way:115832750'), ('relation:3138434'), ('way:186584015'))
  SELECT count(r.id),
         string_agg(i.id, ' ') FILTER (
           -- NULL-safe: a NULL iso_country / country must FAIL, not slip
           -- through a NOT IN that evaluates to NULL.
           WHERE r.id IS NULL
              OR r.site_type IS DISTINCT FROM 'refinery'
              OR COALESCE(r.iso_country NOT IN ('RU', 'UA'), true)
              OR COALESCE(r.country NOT IN ('Russia', 'Ukraine'), true)
              OR COALESCE((r.iso_country, r.country) NOT IN (('RU', 'Russia'), ('UA', 'Ukraine')), true)
              OR r.geom IS NULL
              OR NOT public.firms_point_in_regions(r.latitude, r.longitude,
                   '[{"west":22,"south":44,"east":74,"north":62}]'::jsonb))
    INTO n, bad
    FROM ids i LEFT JOIN public.refineries r ON r.id = i.id;
  IF n <> 16 OR bad IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 5 · % of 16 present; failing ids: %', n, COALESCE(bad, 'none');
  END IF;
  RAISE NOTICE 'PASS 5 · all 16 inserted: refinery, RU/UA with an English country, geom set, inside ru-ua (22–74 E, 44–62 N)';
END
$$;

-- 6 · the re-typed rows left the refinery population (and nothing else did)
DO $$
DECLARE n int; wrong text;
BEGIN
  SELECT count(*) INTO n FROM public.refineries WHERE site_type <> 'refinery';
  SELECT string_agg(id || '=' || site_type, ' ') INTO wrong
    FROM public.refineries
   WHERE id IN ('way:163834450', 'way:773097705', 'way:173780737',
                'way:738870542', 'way:55336680', 'way:833845775')
     AND site_type = 'refinery';
  IF n <> 96 OR wrong IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 6 · % rows re-typed (want 96); still refinery: %', n, COALESCE(wrong, 'none');
  END IF;
  RAISE NOTICE 'PASS 6 · 96 rows re-typed, including Marysville, both Mantua Versalis rows, Naphtachimie, the Lavéra rail terminal and Fabrica de zahăr';
END
$$;

-- 7 · the public "refineries watched" figure counts site_type = 'refinery' only.
-- The boxes are FIRMS_REGIONS after this PR deploys (ru-ua east 74) — the
-- jsonb lib/marketing/watched-coverage.ts passes. Checked as identities and
-- deltas, not absolute numbers, so an OSM re-ingest cannot fail it.
DO $$
DECLARE
  boxes constant jsonb := '[{"west":22,"south":44,"east":74,"north":62},{"west":44,"south":22,"east":60,"north":34},{"west":-10,"south":35,"east":22,"north":60},{"west":100,"south":18,"east":146,"north":46},{"west":60,"south":5,"east":100,"north":37},{"west":95,"south":-11,"east":142,"north":20},{"west":-100,"south":24,"east":-52,"north":55},{"west":-130,"south":25,"east":-100,"north":55}]';
  w0 int; g0 int; w1 int; g1 int; w2 int; g2 int; w3 int; g3 int;
  mon int; mat int; nr_box int; nr_all int;
  lat double precision; lon double precision; pt jsonb;
BEGIN
  -- 7a · identity with the unchanged firms_rule_coverage
  SELECT watched_refineries, registry_refineries INTO w0, g0
    FROM public.refinery_type_coverage(boxes);
  SELECT monitored_facilities, matching_facilities INTO mon, mat
    FROM public.firms_rule_coverage('refinery', NULL, NULL, boxes);
  SELECT count(*) FILTER (WHERE public.firms_point_in_regions(latitude, longitude, boxes)), count(*)
    INTO nr_box, nr_all
    FROM public.refineries WHERE site_type <> 'refinery';
  IF w0 IS DISTINCT FROM mon - nr_box OR g0 IS DISTINCT FROM mat - nr_all OR nr_box < 96 THEN
    RAISE EXCEPTION 'FAIL 7a · refinery_type_coverage % / % is not firms_rule_coverage % / % minus the non-refinery rows % / % (want >= 96 in the boxes)',
      w0, g0, mon, mat, nr_box, nr_all;
  END IF;

  -- 7b · a re-typed site inside the boxes is not counted: Marysville Ethanol
  -- (way:163834450, ethanol_biofuel since 168). A box that is exactly its
  -- point holds it for firms_rule_coverage and not for the public figure.
  SELECT latitude, longitude INTO lat, lon FROM public.refineries WHERE id = 'way:163834450';
  pt := jsonb_build_array(jsonb_build_object('west', lon, 'south', lat, 'east', lon, 'north', lat));
  SELECT monitored_facilities INTO mon
    FROM public.firms_rule_coverage('refinery', NULL, 'Marysville Ethanol', pt);
  SELECT watched_refineries INTO w1 FROM public.refinery_type_coverage(pt);
  IF NOT public.firms_point_in_regions(lat, lon, boxes) OR mon IS DISTINCT FROM 1
     OR w1 IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FAIL 7b · Marysville Ethanol: in the boxes %, firms_rule_coverage sees %, refinery_type_coverage counts % (want true, 1, 0)',
      public.firms_point_in_regions(lat, lon, boxes), mon, w1;
  END IF;
  -- … and putting it back to 'refinery' is exactly +1 watched, +1 registry.
  UPDATE public.refineries SET site_type = 'refinery' WHERE id = 'way:163834450';
  SELECT watched_refineries, registry_refineries INTO w1, g1 FROM public.refinery_type_coverage(boxes);
  UPDATE public.refineries SET site_type = 'ethanol_biofuel' WHERE id = 'way:163834450';
  IF (w1 - w0, g1 - g0) IS DISTINCT FROM (1, 1) THEN
    RAISE EXCEPTION 'FAIL 7b · re-typing Marysville back to refinery moved the figure by % / % (want +1 / +1)', w1 - w0, g1 - g0;
  END IF;

  -- 7c · a new refinery inserted inside the boxes is counted (the ingest's
  -- insert shape: no site_type, so the default applies) …
  INSERT INTO public.refineries (id, osm_type, osm_id, refinery_name, source_tags, latitude, longitude)
  VALUES ('node:-168000002', 'node', -168000002, 'PR-11 guard fixture, in a box (rolled back)', '{}'::jsonb, 55.1, 40.1);
  SELECT watched_refineries, registry_refineries INTO w2, g2 FROM public.refinery_type_coverage(boxes);
  IF (w2 - w0, g2 - g0) IS DISTINCT FROM (1, 1) THEN
    RAISE EXCEPTION 'FAIL 7c · a new refinery inside the boxes moved the figure by % / % (want +1 / +1)', w2 - w0, g2 - g0;
  END IF;
  -- … one outside every box only joins the registry, and one inserted as a
  -- terminal inside the boxes joins neither.
  INSERT INTO public.refineries (id, osm_type, osm_id, refinery_name, source_tags, latitude, longitude)
  VALUES ('node:-168000003', 'node', -168000003, 'PR-11 guard fixture, no box (rolled back)', '{}'::jsonb, -30.0, -60.0);
  INSERT INTO public.refineries (id, osm_type, osm_id, refinery_name, source_tags, latitude, longitude, site_type)
  VALUES ('node:-168000004', 'node', -168000004, 'PR-11 guard fixture, terminal (rolled back)', '{}'::jsonb, 55.2, 40.2, 'terminal');
  SELECT watched_refineries, registry_refineries INTO w3, g3 FROM public.refinery_type_coverage(boxes);
  IF (w3 - w2, g3 - g2) IS DISTINCT FROM (0, 1) THEN
    RAISE EXCEPTION 'FAIL 7c · an out-of-box refinery plus an in-box terminal moved the figure by % / % (want +0 / +1)', w3 - w2, g3 - g2;
  END IF;

  -- 7d · NULL regions fail closed, as firms_point_in_regions does
  SELECT watched_refineries INTO w1 FROM public.refinery_type_coverage(NULL);
  IF w1 IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FAIL 7d · refinery_type_coverage(NULL) watched % (want 0)', w1;
  END IF;

  -- 7e · service_role only
  IF NOT has_function_privilege('service_role', 'public.refinery_type_coverage(jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.refinery_type_coverage(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.refinery_type_coverage(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL 7e · refinery_type_coverage EXECUTE: service_role %, anon %, authenticated % (want true, false, false)',
      has_function_privilege('service_role', 'public.refinery_type_coverage(jsonb)', 'EXECUTE'),
      has_function_privilege('anon', 'public.refinery_type_coverage(jsonb)', 'EXECUTE'),
      has_function_privilege('authenticated', 'public.refinery_type_coverage(jsonb)', 'EXECUTE');
  END IF;

  RAISE NOTICE 'PASS 7 · refinery_type_coverage = % watched / % registry = firms_rule_coverage minus % / % non-refinery rows; Marysville (re-typed, in a box) not counted; a new in-box refinery +1/+1, out-of-box +0/+1, in-box terminal +0/+0; NULL regions 0; service_role only',
    w0, g0, nr_box, nr_all;
END
$$;

ROLLBACK;

-- Reached only when no assertion above raised. This row is the pass signal.
SELECT 'PR-11 guards: all 8 assertions passed (0–7: column + CHECK, vocabulary, NOT NULL, ingest upsert, default, the 16 inserts, the 96 re-types, the site_type-only watched figure); transaction rolled back, nothing written' AS result,
       now() AS checked_at;
