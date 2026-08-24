-- 111 · Per-vessel AIS cadence baselines
--
-- The v2 composite was monotone in one variable, so the leaderboard was a
-- 22-way tie: an absolute silence threshold cannot rank a fleet whose vessels
-- report at wildly different rates. The honest signal — the same invariant
-- FIRMS uses — is deviation from a vessel's OWN baseline: silence divided by
-- that vessel's observed median inter-fix interval.
--
-- vessel_cadence caches the baseline; refresh_vessel_cadence() recomputes it
-- from ais_position_history (14-day window, >= 5 fixes = >= 4 inter-fix
-- deltas, median via percentile_cont). Called hourly by the
-- compute-shadow-fleet-scores cron alongside refresh_ais_box_liveness().
--
-- The clock caveat, stated rather than hidden: ais_position_history is
-- written by the hourly sample-ais-history cron, so the measured cadence is
-- "how often OUR pipeline observed a fresh fix", floored near 1 h — not the
-- transponder's raw rate. That is the correct baseline here, because the
-- silence being judged is measured by the same instrument. The 0.5 h floor
-- guards the ratio against a degenerate denominator.
--
-- THE CIRCULARITY THIS SCHEMA MUST RESPECT (do not "clean up" later):
-- sample-ais-history samples the vessels in vessel_profiles. Baselines are
-- computed from those samples. If the scoring cron DELETED profiles that
-- lack a baseline, the sampler would stop sampling them and they could never
-- earn one — the pipeline would strangle itself. Vessels without a baseline
-- therefore keep their profile row with composite_score NULL ("observed, not
-- yet scorable"); the sampler keeps feeding them, and they become scorable
-- within hours. Rehearsed read-only on production 2026-08-24: 745 vessels
-- had a baseline (median inter-fix 1.27 h avg, max 12.6 h, none > 24 h).

create table if not exists vessel_cadence (
  mmsi              text primary key,
  fixes             integer not null,
  median_interval_h double precision not null,
  window_days       integer not null default 14,
  computed_at       timestamptz not null default now()
);

alter table vessel_cadence enable row level security;
-- No policy on purpose: service-role only, like ais_box_liveness (mig 110).

create or replace function refresh_vessel_cadence() returns void
language sql
as $$
  with deltas as (
    select mmsi,
           extract(epoch from (recorded_at
             - lag(recorded_at) over (partition by mmsi order by recorded_at)))/3600.0 as dh
    from ais_position_history
    where recorded_at > now() - interval '14 days'
  ),
  cad as (
    select mmsi,
           count(*) + 1 as fixes,
           greatest(0.5, percentile_cont(0.5) within group (order by dh)) as median_h
    from deltas
    where dh is not null
    group by mmsi
    having count(*) >= 4  -- 4 deltas = 5 real fixes
  ),
  upserted as (
    insert into vessel_cadence (mmsi, fixes, median_interval_h, window_days, computed_at)
    select mmsi, fixes, median_h, 14, now()
    from cad
    on conflict (mmsi) do update set
      fixes             = excluded.fixes,
      median_interval_h = excluded.median_interval_h,
      window_days       = excluded.window_days,
      computed_at       = excluded.computed_at
    returning mmsi
  )
  -- A baseline that has aged out of the 14-day window is stale evidence, not
  -- a baseline. Remove rows the window no longer supports.
  delete from vessel_cadence vc
  where not exists (select 1 from cad where cad.mmsi = vc.mmsi);
$$;

-- Seed immediately so the first post-merge cron tick scores against real
-- baselines rather than voiding everything for one hour.
select refresh_vessel_cadence();
