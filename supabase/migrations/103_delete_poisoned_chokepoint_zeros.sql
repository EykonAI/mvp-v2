-- 103: delete the poisoned chokepoint zero rows (2026-08-07 onward)
--
-- WHAT HAPPENED
-- The AIS ingest worker stopped producing rows at 2026-08-05 13:31 UTC
-- (AISStream free-tier LB overload). The snapshot-chokepoints cron
-- (00:30 UTC daily) kept counting the now-empty 24h window and wrote
-- vessel_count = 0 for bosphorus / suez / malacca on 2026-08-07, -08
-- and -09 — nine rows at the time this migration was authored. These
-- are instrument artefacts, not observations: the look never happened.
-- They rendered in the Commodities workspace as "0 · −100% vs 14d avg"
-- and were entering the trailing 14-day baseline.
--
-- WHY DELETE (not annotate / re-score)
-- A row in ais_chokepoint_observations must mean "we looked with a
-- live instrument" (row-exists-iff-we-looked; same construction as the
-- FIRMS coverage rule in migration 085). There is no observation to
-- re-score here — contrast migration 099, which re-scored real
-- observations. The companion code change (same PR) adds a feed-
-- liveness guard to the cron so this class of row can no longer be
-- written.
--
-- The upper bound is current_date, not a literal: if the cron writes
-- another zero row between authorship and application, it is the same
-- artefact and is cleaned by the same rule. The feed has been dead
-- since 08-05, so every zero in this range is provably a dead-feed
-- artefact. Last genuine counts (2026-08-06): malacca 692, suez 193,
-- bosphorus 39 — all far from zero; these corridors do not do genuine
-- zeros on a live feed.
--
-- RUN READ-ONLY FIRST (SELECT twin) — expect 9 rows as of 2026-08-09,
-- +3 per additional day the worker stayed dead with the old cron:
--
--   select chokepoint, period, vessel_count, snapshot_at
--   from ais_chokepoint_observations
--   where chokepoint in ('bosphorus', 'suez', 'malacca')
--     and vessel_count = 0
--     and period >= '2026-08-07'
--     and period <= current_date
--   order by period, chokepoint;
--
-- VERIFY AFTER: the same SELECT returns 0 rows.

delete from ais_chokepoint_observations
where chokepoint in ('bosphorus', 'suez', 'malacca')
  and vessel_count = 0
  and period >= '2026-08-07'
  and period <= current_date;
