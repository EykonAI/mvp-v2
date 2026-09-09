-- 151 · Night-lights detection twice a day.
--
-- WHY
-- ---
-- NASA publishes a Black Marble night about 8.4 days after it happens
-- (measured on 2026-08-17 → 08-23: 8.41 d each, i.e. available by the 09:45
-- UTC worker run of day+8) and sometimes in a batch (08-25 → 08-29 all landed
-- on 09-08; 08-30 → 09-05 were still missing on 09-09 at 11.3 d). The worker
-- runs once, at 09:45 UTC, and the detector once, at 10:05. A night that
-- appears after 09:45 waits a full day before a claim can be issued on it
-- and before the claims whose windows it closes can be judged.
--
-- A second pair — worker 21:45 (Railway, the founder's schedule:
-- `45 9,21 * * *` on the Black Marble ingest cron), detector 22:05 (this
-- file) — halves that wait. When no new night has arrived, the 22:05 run
-- re-judges the newest three nights in ~2 s and leaves its run rows, which is
-- exactly what the monitor reads (a row iff a night was judged).
--
-- WHAT DID NOT SHIP, AND WHY (measured 2026-09-09)
--   · Raising the daily cap (100 → 200): supply is 8–43 first-light sites per
--     night; the cap has never bound (declined {} on every run). Batch days
--     looked like 90/day only because five nights' events were issued at once.
--   · A 3-day horizon: base 0.493 (centred) but 13.5 % of windows have no
--     clear night (7 d: 4.6 %) and the cell model discriminates less
--     (leave-one-out +0.108 vs +0.193 at 7 d; 5 d: 0.539 · 6.3 % · +0.166).
--     A second horizon on the same site-events is also a correlated claim,
--     not independent evidence. Decision left to the founder; default: no.
-- What did ship, in #509's code: claims are issued only when the flagged
-- night IS the data clock (the window entirely unpublished) — 184 of the 241
-- claims so far were issued with 1–5 window nights already on disk.

BEGIN;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'detect-nightlights';
SELECT cron.schedule('detect-nightlights', '5 10,22 * * *', $job$ SELECT public.nightlights_detect_due(3, 5) $job$);

COMMIT;

-- STEP 1 — READ ONLY, before applying:
--   SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'detect-nightlights';
--   -- expect schedule '5 10 * * *', command nightlights_detect_due(3, 5)
--
-- VERIFY, after applying (rows on screen):
--   SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'detect-nightlights';
--   -- expect exactly one row, schedule '5 10,22 * * *', same command
--   SELECT count(*) FROM cron.job WHERE jobname = 'detect-nightlights';   -- 1
