-- 132_blackmarble_uncomplete_stuck_nights.sql
--
-- Make five Black Marble nights eligible for retry: 2026-08-25 .. 2026-08-29.
--
-- WHAT HAPPENED. NASA reprocesses VNP46A2 nights ~8 days after first
-- publication (08-21 was restamped 08-29; 08-24..08-29 were restamped
-- 09-04/06), and the ladsweb listing updates BEFORE the bytes reach the
-- Earthdata Cloud mirror the worker downloads from. The worker ran mid-wave:
-- it saw the new filenames, got 404 on download, and its only silent-zero
-- path — `if r.status_code == 404: return []` — turned each 404 into "a tile
-- with no facilities". process_night counted those as PROCESSED, wrote
-- ok=true, and completed_nights() (tiles_missing=0 AND ok) then skipped the
-- night forever. Verified per night from blackmarble_ingest_runs:
--
--   night   tiles_processed  facilities_written
--   08-24        84/84           10,556   (normal)
--   08-25        84/84            1,553   (20 of 84 tiles — NASA mid-swap)
--   08-26        84/84                0
--   08-27        84/84                0
--   08-28        84/84                0
--   08-29        84/84                0
--   08-30..      0/84 missing         0   (genuine NASA latency — leave alone)
--
-- NASA's lag is ~9 days, exactly as §6.3 originally documented. The "13 days"
-- measured on 2026-09-07 was 9 days of NASA plus 4 days of this defect, and
-- the brief was corrected in the wrong direction on the strength of it. Every
-- night-lights claim family (mig 128) anchors its DATA clock on max(period)
-- of blackmarble_facility_radiance, so it has been anchored on a PARTIAL
-- night since 09-05.
--
-- THE CODE FIX (same PR) makes a 404 count as a MISSING tile and requires
-- tiles_processed = tiles_expected AND facilities_written > 0 for a night to
-- be complete. This migration is the data half: the five run rows currently
-- satisfy the OLD completeness test, and the new one only sees them if the
-- stored numbers stop lying. Nothing in blackmarble_facility_radiance is
-- touched — the upsert key (facility_type, facility_id, period) refreshes
-- the 1,553 partial 08-25 rows in place on the retry.
--
-- The rolling window is today-4 back 12 nights, so on any run from 09-08 to
-- 09-12 all five nights are still inside it and will be retried on the next
-- 09:44 UTC tick after this is applied. Apply it BEFORE that tick, or the
-- retry waits a day.
--
-- IDEMPOTENT: the WHERE targets rows whose numbers still assert the false
-- state; after one run they no longer match.


-- ─────────────────────────────────────────────────────────────────────
-- STEP 1 — READ ONLY. Expect exactly 5 rows: 08-25 (fw 1553), 08-26..08-29 (fw 0),
-- every one with tp 84, tm 0, ok true.
-- ─────────────────────────────────────────────────────────────────────
select night, tiles_expected, tiles_processed, tiles_missing, facilities_written, ok, ran_at
from blackmarble_ingest_runs
where night between '2026-08-25' and '2026-08-29'
  and ok = true and tiles_missing = 0
  and tiles_processed = tiles_expected
  and facilities_written < 10000
order by night;


-- ─────────────────────────────────────────────────────────────────────
-- STEP 2 — THE WRITE. Expect UPDATE 5.
-- tiles_processed → 0 and tiles_missing → tiles_expected say the truth:
-- we did not (successfully) look at any tile. ok stays true — there was no
-- error, there was a silent miss, and the error column is for exceptions.
-- ─────────────────────────────────────────────────────────────────────
begin;

update blackmarble_ingest_runs
set tiles_processed = 0,
    tiles_missing   = tiles_expected,
    error           = 'reset by migration 132: tiles 404''d mid-reprocessing and were miscounted as processed; night re-queued for retry'
where night between '2026-08-25' and '2026-08-29'
  and ok = true and tiles_missing = 0
  and tiles_processed = tiles_expected
  and facilities_written < 10000;

commit;


-- ─────────────────────────────────────────────────────────────────────
-- STEP 3 — VERIFY. Expect requeued 5, still_marked_complete 0.
-- Then, after the next 09:44 UTC worker run: facilities_written should read
-- ~10,556 for each of the five nights and max(period) in
-- blackmarble_facility_radiance should advance to 2026-08-29.
-- ─────────────────────────────────────────────────────────────────────
select
  count(*) filter (where tiles_missing = tiles_expected and tiles_processed = 0) as requeued,
  count(*) filter (where tiles_missing = 0 and ok and tiles_processed = tiles_expected
                     and facilities_written < 10000)                              as still_marked_complete
from blackmarble_ingest_runs
where night between '2026-08-25' and '2026-08-29';
