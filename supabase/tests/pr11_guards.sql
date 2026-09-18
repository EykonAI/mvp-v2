-- PR-11 guard tests · refineries.site_type + the strike-claim inserts (mig 168)
--
-- Run in the Supabase SQL Editor AFTER applying 168, the whole file. It wraps
-- itself in BEGIN … ROLLBACK, so the writes it makes to prove each guard are
-- undone. Paste back the NOTICE lines: every one must read PASS. The first
-- FAIL raises and aborts the file (the ROLLBACK still leaves nothing behind).
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
           WHERE r.id IS NULL
              OR r.site_type <> 'refinery'
              OR r.iso_country NOT IN ('RU', 'UA')
              OR r.country NOT IN ('Russia', 'Ukraine')
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

ROLLBACK;
