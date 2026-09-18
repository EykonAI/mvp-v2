-- 167 · reference_snapshot_freshness: say how old each static registry is
--       (Reality Check Programme, build prompt rev H, Wave 2 · PR-4)
--
-- WHY. power_plants was loaded once — 182,417 rows, every ingested_at between
-- 2026-04-28 20:50:58 and 20:54:04 UTC — and has not been touched since. It is
-- two GEM releases behind and looks perfectly healthy: full rows, capacity on
-- every unit, a layer that renders, a tool that answers. A static table has no
-- clock of its own, so nothing on any surface could say "this is from April".
-- The same is true of every registry the product serves as reference data.
-- Measured 2026-09-18 (supabase-ro), max(ingested_at) per table:
--
--     power_plants    182,417 rows   2026-04-28   one load, 3 minutes
--     airports         85,254        2026-04-28   one load
--     ports             3,803        2026-04-28   one load
--     gas_pipelines     3,534        2026-04-29   one load
--     lng_terminals     1,198        2026-04-29   one load
--     oil_pipelines     1,417        2026-04-30   one load
--     refineries          634        2026-05-10   633 rows on 04-30, ONE row on 05-10
--     mines           304,613        2026-05-01   one load (USGS MRDS, frozen upstream at 2011)
--
-- WHAT. One view, reference_snapshot_freshness, one row per served registry:
-- row count, loaded_at (max of ingested_at), oldest_row_at, age in days, the
-- refresh interval this file DECLARES for it with the reason, and a
-- freshness_state — stale / within_interval / upstream_frozen / empty. The rule
-- is "older than its declared refresh contract", never "the table is empty":
-- an emptiness check could not have caught power_plants.
--
-- The declared intervals (the contract, stated here so they are auditable):
--
--   power_plants   120 d  GEM GIPT — bulk release only, no API (mig 015:
--                         quarterly); 90 d cadence + 30 d to obtain and load.
--   oil_pipelines  120 d  GEM GOIT — same GEM bulk-release contract.
--   gas_pipelines  120 d  GEM GGIT — same.
--   lng_terminals  120 d  GEM GGIT — same.
--   refineries      90 d  OpenStreetMap via Overpass — edited continuously
--                         upstream, nothing re-pulls it on a schedule.
--   airports        90 d  OurAirports — regenerated daily upstream.
--   ports          365 d  NGA World Port Index — republished irregularly
--                         (the download URL rotates per edition).
--   mines          none   USGS MRDS — frozen upstream at 2011. A reload cannot
--                         make it fresher, so age is not its defect:
--                         upstream_frozen, never "within interval".
--
-- WHAT loaded_at MEANS — read before trusting it. ingested_at is DEFAULT now()
-- and set on INSERT only: no ingest route or seed script carries it in its
-- upsert payload, and no trigger touches it (the three triggers on these
-- tables only set geom). So loaded_at is "the newest row ever inserted", not
-- "the last successful load". Two consequences, both deliberate here:
--   * A refresh that only updates existing ids in place does not advance it.
--     A new GEM release adds units, so a real refresh will move it; a no-op
--     re-run will not, and should not.
--   * A partial insert DOES advance it — already true today: refineries reads
--     2026-05-10 because of ONE row; the other 633 are from 2026-04-30.
--     PR-11 inserts 13 refineries by OSM id; from that day
--     refineries.loaded_at reads fresh while all 634 existing rows keep
--     their 2026-04-30 / 05-10 stamps. oldest_row_at is exposed beside it
--     so that is visible, not silent.
-- Changing ingested_at semantics is out of scope on purpose: the notification
-- evaluators read ingested_at as "new row since the last run" (lib/notifications/
-- tools.ts BUCKET_TABLES, evaluator-cheap queryPowerPlants), so stamping every
-- row on reload would fire every power-plant rule at once.
--
-- COST. Exact counts: the whole view is ~1.4 s cold (182k power_plants + 304k
-- mines seq scans), ~90 ms for power_plants alone. Every branch carries a
-- constant table_name, so a read filtered on table_name prunes the other seven
-- branches at plan time (One-Time Filter: false — verified with EXPLAIN on
-- production). The app reads one table at a time and caches it 10 minutes.
--
-- Does not refresh any data (a separate job). No function, no write path, no
-- temp tables, no session state. Idempotent: CREATE OR REPLACE with an
-- unchanged column list re-runs cleanly. security_invoker so the reader's own
-- RLS applies; readable by service_role only (mig 139 / 149 pattern).
--
-- Apply MANUALLY in the Supabase SQL Editor BEFORE merge — the whole file, not
-- a highlighted selection. The final SELECT is the VERIFY: paste its rows back.

BEGIN;

CREATE OR REPLACE VIEW public.reference_snapshot_freshness
WITH (security_invoker = true) AS
WITH contract (table_name, source, expected_refresh_days, refresh_reason, reload_via) AS (
  VALUES
    ('power_plants'::text,
     'Global Energy Monitor — Global Integrated Power Tracker (GIPT)'::text,
     120::integer,
     'GEM publishes GIPT as a bulk release with no API (mig 015: quarterly download). 90-day release cadence plus 30 days to obtain and load the file.'::text,
     '/api/cron/ingest-gem-power (GEM_GIPT_URL) or scripts/seed-gem-power.mjs'::text),
    ('oil_pipelines',
     'Global Energy Monitor — Global Oil Infrastructure Tracker (GOIT)',
     120,
     'GEM bulk release, no API; the ingest route is built for a quarterly refresh. 90-day cadence plus 30 days to load.',
     '/api/cron/ingest-gem-oil-pipelines or scripts/seed-gem-oil-pipelines.mjs'),
    ('gas_pipelines',
     'Global Energy Monitor — Global Gas Infrastructure Tracker (GGIT), pipelines',
     120,
     'GEM bulk release, no API; the ingest route is built for a quarterly refresh. 90-day cadence plus 30 days to load.',
     '/api/cron/ingest-gem-gas-pipelines or scripts/seed-gem-gas-pipelines.mjs'),
    ('lng_terminals',
     'Global Energy Monitor — Global Gas Infrastructure Tracker (GGIT), LNG terminals',
     120,
     'GEM bulk release, no API; same quarterly contract as the other GEM trackers. 90-day cadence plus 30 days to load.',
     '/api/cron/ingest-gem-lng-terminals or scripts/seed-gem-lng-terminals.mjs'),
    ('refineries',
     'OpenStreetMap via the Overpass API (refinery tags)',
     90,
     'OSM is edited continuously upstream and nothing re-pulls it on a schedule; a quarterly re-pull is the contract.',
     '/api/cron/ingest-osm-refineries or scripts/seed-osm-refineries.mjs'),
    ('airports',
     'OurAirports',
     90,
     'OurAirports regenerates its CSV daily upstream; the ingest is one-shot, so a quarterly re-pull is the contract.',
     '/api/cron/ingest-ourairports'),
    ('ports',
     'NGA World Port Index (Pub. 150)',
     365,
     'NGA republishes the WPI irregularly (the download URL rotates per edition); an annual re-pull is the contract.',
     '/api/cron/ingest-wpi (WPI_DOWNLOAD_URL)'),
    ('mines',
     'USGS Mineral Resources Data System (MRDS)',
     NULL,
     'MRDS is frozen upstream at 2011: a reload cannot make it fresher, so it has no refresh interval and is never reported as within one.',
     '/api/cron/ingest-usgs-mrds-mines or scripts/seed-usgs-mrds-mines.mjs')
),
loads AS (
  -- One branch per table, each with a constant table_name so a filtered read
  -- prunes the others at plan time.
  SELECT 'power_plants'::text AS table_name, count(*)::bigint AS row_count,
         max(ingested_at) AS loaded_at, min(ingested_at) AS oldest_row_at
    FROM public.power_plants
  UNION ALL
  SELECT 'oil_pipelines', count(*), max(ingested_at), min(ingested_at) FROM public.oil_pipelines
  UNION ALL
  SELECT 'gas_pipelines', count(*), max(ingested_at), min(ingested_at) FROM public.gas_pipelines
  UNION ALL
  SELECT 'lng_terminals', count(*), max(ingested_at), min(ingested_at) FROM public.lng_terminals
  UNION ALL
  SELECT 'refineries',    count(*), max(ingested_at), min(ingested_at) FROM public.refineries
  UNION ALL
  SELECT 'airports',      count(*), max(ingested_at), min(ingested_at) FROM public.airports
  UNION ALL
  SELECT 'ports',         count(*), max(ingested_at), min(ingested_at) FROM public.ports
  UNION ALL
  SELECT 'mines',         count(*), max(ingested_at), min(ingested_at) FROM public.mines
)
SELECT
  c.table_name,
  c.source,
  l.row_count,
  l.loaded_at,
  l.oldest_row_at,
  floor(extract(epoch FROM (now() - l.loaded_at)) / 86400)::integer          AS age_days,
  c.expected_refresh_days,
  c.refresh_reason,
  CASE
    WHEN l.row_count = 0 OR l.loaded_at IS NULL                               THEN 'empty'
    WHEN c.expected_refresh_days IS NULL                                      THEN 'upstream_frozen'
    WHEN now() - l.loaded_at > make_interval(days => c.expected_refresh_days) THEN 'stale'
    ELSE 'within_interval'
  END                                                                          AS freshness_state,
  COALESCE(l.row_count > 0
           AND c.expected_refresh_days IS NOT NULL
           AND now() - l.loaded_at > make_interval(days => c.expected_refresh_days),
           false)                                                              AS is_stale,
  l.loaded_at + make_interval(days => c.expected_refresh_days)                 AS stale_after,
  c.reload_via
FROM contract c
JOIN loads l USING (table_name);

COMMENT ON VIEW public.reference_snapshot_freshness IS
  'One row per static registry the product serves (power_plants, oil/gas pipelines, LNG terminals, refineries, airports, ports, mines): row count, loaded_at = max(ingested_at) (newest INSERT — ingested_at is not stamped on update), oldest_row_at, age_days, the declared expected_refresh_days with its reason, freshness_state (stale / within_interval / upstream_frozen / empty) and is_stale. Stale = older than the declared refresh contract. Read one table at a time (branches prune on table_name). Mig 167, Reality Check PR-4.';

-- Grants: service role only, by role name (mig 139 / 149 pattern). The browser
-- never reads this view; the server routes do, with the service role.
REVOKE ALL    ON public.reference_snapshot_freshness FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.reference_snapshot_freshness TO service_role;

COMMIT;

-- VERIFY (rows on screen, not the banner). Expected, read 2026-09-18 14:10 UTC:
--   airports       85,254 · loaded 2026-04-28 · age 143 ·  90 d · stale           (stale after 2026-07-27)
--   power_plants  182,417 · loaded 2026-04-28 · age 142 · 120 d · stale           (stale after 2026-08-26)
--   gas_pipelines   3,534 · loaded 2026-04-29 · age 141 · 120 d · stale
--   lng_terminals   1,198 · loaded 2026-04-29 · age 141 · 120 d · stale
--   oil_pipelines   1,417 · loaded 2026-04-30 · age 140 · 120 d · stale
--   refineries        634 · loaded 2026-05-10 · age 130 ·  90 d · stale           (oldest row 2026-04-30)
--   ports           3,803 · loaded 2026-04-28 · age 142 · 365 d · within_interval (stale after 2027-04-28)
--   mines         304,613 · loaded 2026-05-01 · age 140 ·   —   · upstream_frozen
--   every row: security_invoker true · anon_can_read false · service_role_can_read true
-- Ages grow by one a day; the states hold until a reload (or, for ports, 2027-04-28).
SELECT f.table_name,
       f.row_count,
       f.loaded_at::date                                  AS loaded_on,
       f.oldest_row_at::date                              AS oldest_row_on,
       f.age_days,
       f.expected_refresh_days,
       f.freshness_state,
       f.is_stale,
       f.stale_after::date                                AS stale_after,
       (SELECT 'security_invoker=true' = ANY (c.reloptions)
          FROM pg_class c
         WHERE c.oid = 'public.reference_snapshot_freshness'::regclass) AS security_invoker,
       has_table_privilege('anon',         'public.reference_snapshot_freshness', 'SELECT') AS anon_can_read,
       has_table_privilege('service_role', 'public.reference_snapshot_freshness', 'SELECT') AS service_role_can_read
  FROM public.reference_snapshot_freshness f
 ORDER BY f.is_stale DESC, f.age_days DESC NULLS LAST, f.table_name;
