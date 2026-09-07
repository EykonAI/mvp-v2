-- 131_chokepoint_zero_rows_cleanup.sql
--
-- Delete every vessel_count = 0 row from ais_chokepoint_observations.
--
-- THE INVARIANT. `vessel_count` is NOT NULL, so the cron cannot record "we
-- looked and could not see". A row therefore asserts an OBSERVATION, and the
-- rule this table is supposed to obey is the one migration 085 states for
-- coverage generally: A ROW EXISTS IFF WE LOOKED. A row saying zero vessels
-- crossed the Strait of Malacca in 24 hours is not an observation — it is a
-- claim we never had standing to make. Malacca runs 800-1,300 vessels a day in
-- this very table; Suez ~210; Bosphorus ~38. None of them is ever empty.
--
-- WHAT WAS ACTUALLY FOUND, 2026-09-07. The note this came from recorded "9
-- poisoned rows on 08-07..09". That was the state in August: #357 deleted
-- those, and the 08-07..08-17 outage window now correctly holds NO rows at
-- all, which is the invariant working. But #357 only cleaned its own window.
-- THIRTY zero rows survive, spanning 2026-05-27 to 2026-08-18 — most of them
-- older than the August outage entirely.
--
-- They fall into two kinds, and both are "we didn't look":
--
--   A · ALL BOXES ZERO on the same day — 14 rows, 2026-05-27 .. 2026-07-22.
--       A feed-wide outage signature. The 07-21/07-22 pair is the documented
--       #301 cert failure (ais-ingest down 48h on an expired-CA TLS error).
--
--   B · ONE BOX ZERO WHILE THE OTHERS REPORTED — 16 rows, 2026-05-30 ..
--       2026-08-18, including FOURTEEN CONSECUTIVE Malacca days (05-30..06-12)
--       while Suez and Bosphorus reported real counts throughout. The feed was
--       up; that one box returned nothing. This is the same per-box coverage
--       hole visible today in ais_box_liveness (Bab-el-Mandeb silent 51 days,
--       Hormuz intermittent), one table down.
--
-- WHY NOT ARGUED FROM ais_position_history. The obvious test — "were there any
-- global positions in the 24h window?" — is INVALID for 23 of these 30 rows:
-- that table retains ~64 days and its floor is 2026-07-05, so every earlier
-- day returns zero because the history was PRUNED, not because the feed was
-- dark. Using it would have "confirmed" 23 rows on an artefact of retention.
-- The classification above uses only same-day sibling rows, which are not
-- subject to that retention and are therefore sound across the whole span.
--
-- URGENCY: NONE, and that is stated rather than implied. No zero row falls in
-- any current trailing-14-day window (verified: mean_14d equals mean excluding
-- zeros for all three live boxes, 2026-08-25..09-07). These rows poison LONGER
-- windows, historical charts, and any backfilled baseline — not today's UI.
--
-- WHAT THIS DOES NOT FIX — the writer still produces them. The liveness guard
-- in app/api/cron/snapshot-chokepoints/route.ts says so in its own comment:
-- "The guard keys on feed liveness, never on the count value — a genuine zero
-- on a live feed" is recorded deliberately. That premise is now false. A zero
-- on a live feed can mean THIS BOX HAS NO COVERAGE, which is exactly how
-- suez 2026-08-18 was written while Malacca and Bosphorus reported normally.
-- The guard is global; the failure is per-box. Fixing it needs a per-box
-- staleness check against ais_box_liveness.newest_fix, and is deliberately NOT
-- bundled here: this migration is a data cleanup, and a cleanup that quietly
-- carried a behaviour change would be the harder thing to review.
--
-- IDEMPOTENT: a second run deletes nothing, because nothing matches.
-- NOT REVERSIBLE: these rows carry no information beyond "0", which is the
-- claim being withdrawn, so nothing recoverable is lost.


-- ─────────────────────────────────────────────────────────────────────
-- STEP 1 — READ ONLY. Run alone first.
-- Expect: to_delete 30 · all_boxes_zero 14 · single_box_zero 16 ·
--         span 2026-05-27 .. 2026-08-18 · in_current_14d 0
-- If in_current_14d is NOT 0, STOP — a live baseline is affected and the
-- situation has changed since this was written.
-- ─────────────────────────────────────────────────────────────────────
with z as (select chokepoint, period from ais_chokepoint_observations where vessel_count = 0),
cls as (
  select z.chokepoint, z.period,
         (select count(*) from ais_chokepoint_observations o
           where o.period = z.period and o.vessel_count > 0) as siblings_reporting
  from z)
select count(*)                                             as to_delete,
       count(*) filter (where siblings_reporting = 0)        as all_boxes_zero,
       count(*) filter (where siblings_reporting > 0)        as single_box_zero,
       min(period)::text || ' .. ' || max(period)::text      as span,
       count(*) filter (where period > current_date - 14)    as in_current_14d
from cls;


-- ─────────────────────────────────────────────────────────────────────
-- STEP 2 — THE WRITE. Run only after STEP 1 matches.
-- ─────────────────────────────────────────────────────────────────────
begin;

delete from ais_chokepoint_observations where vessel_count = 0;
-- Expect: DELETE 30

commit;


-- ─────────────────────────────────────────────────────────────────────
-- STEP 3 — VERIFY. Expect zeros_left 0, rows_left 253, min_count >= 1,
-- and the three live boxes' 14-day means UNCHANGED from before the run
-- (bosphorus 38 · malacca 1016 · suez 212) — this cleanup must not move
-- any current figure, and if it does, something else was deleted.
-- Re-running STEP 1 must then report to_delete 0.
-- ─────────────────────────────────────────────────────────────────────
select
  (select count(*) from ais_chokepoint_observations where vessel_count = 0) as zeros_left,
  (select count(*) from ais_chokepoint_observations)                        as rows_left,
  (select min(vessel_count) from ais_chokepoint_observations)               as min_count,
  (select round(avg(vessel_count)) from ais_chokepoint_observations
     where chokepoint='bosphorus' and period > current_date - 14)           as bosphorus_14d,
  (select round(avg(vessel_count)) from ais_chokepoint_observations
     where chokepoint='malacca'   and period > current_date - 14)           as malacca_14d,
  (select round(avg(vessel_count)) from ais_chokepoint_observations
     where chokepoint='suez'      and period > current_date - 14)           as suez_14d;
