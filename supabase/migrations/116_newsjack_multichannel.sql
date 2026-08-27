-- ═══════════════════════════════════════════════════════════════
-- 116 · NEWSJACK MULTI-CHANNEL DRAFTS
--
-- Widens newsjack_drafts.channel to admit the three copywriter
-- channels (reddit / discord / tiktok), and un-partitions the composer
-- index so the weekly digest can break out fallback rate per channel
-- rather than for X alone.
--
-- WIDENING, NOT REPLACING. The rule against swapping a CHECK on a
-- populated table is about NARROWING; this constraint is a strict
-- superset, and Postgres validates the new CHECK against existing rows
-- when it is added, so a row that violated it would raise here rather
-- than pass silently.
--
-- RUN THESE TWO READ-ONLY FIRST (both were run against production on
-- 2026-08-27 while writing this file; re-run at apply time):
--   SELECT channel, count(*) FROM newsjack_drafts GROUP BY 1 ORDER BY 1;
--     -- expect only x / linkedin / substack
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'newsjack_drafts'::regclass AND contype = 'c';
--     -- expect newsjack_drafts_channel_check with exactly those three
--
-- RLS unchanged: still on, still no permissive policy, service-role only.
-- Apply MANUALLY in the Supabase SQL Editor BEFORE merge — Railway
-- auto-deploys main on merge, and the engine starts writing six drafts
-- per event the moment the foundation lands.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE newsjack_drafts
  DROP CONSTRAINT IF EXISTS newsjack_drafts_channel_check;

ALTER TABLE newsjack_drafts
  ADD CONSTRAINT newsjack_drafts_channel_check
  CHECK (channel IN ('x','linkedin','substack','reddit','discord','tiktok'));

-- 114 created this as a partial (WHERE channel = 'x') because X was the
-- only composed channel. Six are now composed and the digest groups by
-- channel; the partial would push those reads to a sequential scan.
DROP INDEX IF EXISTS idx_newsjack_drafts_composer;
CREATE INDEX IF NOT EXISTS idx_newsjack_drafts_composer
  ON newsjack_drafts (channel, composer, created_at DESC);

COMMENT ON COLUMN newsjack_drafts.channel IS
  'x | linkedin | substack | reddit | discord | tiktok. The three new
   channels are written by lib/copy/channels/<channel>/ and are
   DRAFT-ONLY by decision, not omission: Reddit (commercial-API terms +
   shadowban risk), TikTok (Content Posting API audit; SELF_ONLY until
   passed), Discord (pending an owned server; then webhook behind the
   same one-tap approval).';
