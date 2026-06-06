-- ═══════════════════════════════════════════════════════════════
-- Migration 050 — fiat_waitlist unsubscribe (bulk-email compliance, F-2)
--
-- The waitlist broadcast route (POST /api/admin/waitlist/broadcast) sends
-- one transactional email per contact. Every send MUST carry a working
-- unsubscribe link, and we must never email anyone who has opted out.
--
--   • unsubscribe_token — per-row opaque token used in the public
--     /api/unsubscribe?token=… link + the List-Unsubscribe header. Has a
--     per-row DEFAULT (gen_random_uuid, volatile → unique per insert) so
--     NEW signups get a token with NO app-code change; existing rows are
--     backfilled below.
--   • unsubscribed_at  — set when the contact opts out. The broadcast route
--     filters on `unsubscribed_at IS NULL`, so opt-outs are suppressed.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE fiat_waitlist
  ADD COLUMN IF NOT EXISTS unsubscribe_token TEXT DEFAULT replace(gen_random_uuid()::text, '-', ''),
  ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMPTZ;

-- Backfill tokens for the rows that predate this column.
UPDATE fiat_waitlist
  SET unsubscribe_token = replace(gen_random_uuid()::text, '-', '')
  WHERE unsubscribe_token IS NULL;

ALTER TABLE fiat_waitlist ALTER COLUMN unsubscribe_token SET NOT NULL;

-- Unique + fast lookup for the unsubscribe route.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fiat_waitlist_unsub_token
  ON fiat_waitlist (unsubscribe_token);
