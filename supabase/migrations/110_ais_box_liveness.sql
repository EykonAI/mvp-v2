-- 110 · AIS coverage-box liveness
--
-- Coverage becomes a first-class object. The AIS worker subscribes to ten
-- bounding boxes (services/ais-ingest/index.js BOUNDING_BOXES); until now
-- nothing recorded whether each box was actually delivering. The /start
-- honesty board reads one global MAX(updated_at) and therefore reported the
-- feed LIVE while Hormuz had produced nothing since 2026-08-02 and
-- Bab-el-Mandeb since 2026-07-18 — an aggregate hiding a dead component.
--
-- This migration adds the per-box snapshot table and the function that
-- refreshes it. The function is called by the hourly compute-shadow-fleet-
-- scores cron (no new Railway service — the 50-service cap stands).
--
-- BOX DEFINITIONS EXIST IN THREE PLACES and must stay in sync:
--   services/ais-ingest/index.js   BOUNDING_BOXES   (the subscription)
--   apps/web/lib/intel/aisCoverage.ts  AIS_BOXES    (the reader / gate)
--   this function                                    (the snapshot)
-- The TS module is canonical for slugs and precedence. Cross-language
-- sharing is not possible because the worker's Railway root directory
-- excludes apps/web; the duplication is deliberate and documented at all
-- three sites.
--
-- Assignment precedence matches aisCoverage.ts boxForPosition(): chokepoint
-- boxes are tested BEFORE broad regions (they overlap — Hormuz sits inside
-- Africa+Indian-Ocean), so a vessel in a strait counts toward the strait.
-- One box per vessel, so per-box vessel counts sum to the boxed fleet.
--
-- Single sequential scan of vessel_positions by design (~176k rows, hourly).
-- A per-box indexed spatial query was considered and rejected: ten GiST
-- probes complicate the function for no wall-clock win at this table size,
-- and the CASE chain is the only form that provably matches the TS
-- precedence order.

create table if not exists ais_box_liveness (
  slug            text primary key,
  label           text not null,
  kind            text not null check (kind in ('chokepoint', 'broad')),
  lat0            double precision not null,
  lon0            double precision not null,
  lat1            double precision not null,
  lon1            double precision not null,
  newest_fix      timestamptz,
  fixes_last_hour integer,
  vessels         integer,
  computed_at     timestamptz not null default now()
);

alter table ais_box_liveness enable row level security;
-- No policy on purpose: service-role access only, like the other
-- operational tables (see the platform brief §3.3).

create or replace function refresh_ais_box_liveness() returns void
language sql
as $$
  with boxes(slug, label, kind, lat0, lon0, lat1, lon1, priority) as (
    values
      -- chokepoints first — priority mirrors aisCoverage.ts boxForPosition()
      ('hormuz',        'Strait of Hormuz', 'chokepoint', 24.0,  54.0, 28.0,  58.0, 1),
      ('bab-el-mandeb', 'Bab-el-Mandeb',    'chokepoint', 11.0,  42.0, 14.0,  45.0, 2),
      ('suez',          'Suez Canal',       'chokepoint', 27.0,  31.0, 33.0,  34.0, 3),
      ('bosphorus',     'Bosphorus',        'chokepoint', 40.5,  28.5, 41.5,  29.5, 4),
      ('malacca',       'Strait of Malacca','chokepoint',  1.0,  97.0,  7.0, 105.0, 5),
      ('panama',        'Panama Canal',     'chokepoint',  8.0, -81.0, 10.0, -79.0, 6),
      ('europe-med',    'Europe + Med',     'broad',      30.0, -15.0, 70.0,  45.0, 7),
      ('americas-atl',  'Americas Atlantic','broad',     -10.0, -90.0, 60.0, -30.0, 8),
      ('africa-io',     'Africa + Indian Ocean','broad', -40.0,  10.0, 40.0,  60.0, 9),
      ('asia-pacific',  'Asia-Pacific',     'broad',     -15.0,  90.0, 50.0, 180.0, 10)
  ),
  assigned as (
    -- one scan; first matching box in priority order wins
    select
      (select b.slug from boxes b
        where p.latitude between b.lat0 and b.lat1
          and p.longitude between b.lon0 and b.lon1
        order by b.priority limit 1) as slug,
      p.updated_at
    from vessel_positions p
    where p.latitude is not null and p.longitude is not null
  ),
  agg as (
    select slug,
           max(updated_at) as newest_fix,
           count(*) filter (where updated_at > now() - interval '1 hour')::int as fixes_last_hour,
           count(*)::int as vessels
    from assigned
    where slug is not null
    group by slug
  )
  insert into ais_box_liveness
    (slug, label, kind, lat0, lon0, lat1, lon1, newest_fix, fixes_last_hour, vessels, computed_at)
  select b.slug, b.label, b.kind, b.lat0, b.lon0, b.lat1, b.lon1,
         a.newest_fix, coalesce(a.fixes_last_hour, 0), coalesce(a.vessels, 0), now()
  from boxes b
  left join agg a using (slug)
  on conflict (slug) do update set
    newest_fix      = excluded.newest_fix,
    fixes_last_hour = excluded.fixes_last_hour,
    vessels         = excluded.vessels,
    computed_at     = excluded.computed_at;
$$;

-- Seed the snapshot immediately so the honesty board and the coverage strip
-- have rows the moment this is applied, rather than waiting for the first
-- hourly cron tick.
select refresh_ais_box_liveness();
