-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 062 · COMM D2 · event-spawned rooms
--
-- Lets a cron auto-open a discussion room for a significant event. The
-- spawn-event-rooms cron seeds one room per recent convergence_events
-- row (the platform's "anomaly-of-anomalies" signal). source_event_kind
-- / source_event_id record the origin; the partial unique index makes
-- spawning IDEMPOTENT — re-running the cron never duplicates a room for
-- the same event. created_by stays NULL for these ownerless system
-- rooms (the column is already nullable).
--
-- Additive; non-breaking (only adds two nullable columns + an index).
-- Apply MANUALLY in the Supabase SQL Editor BEFORE merge, per the 060
-- convention.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE comm_rooms
  ADD COLUMN IF NOT EXISTS source_event_kind TEXT,
  ADD COLUMN IF NOT EXISTS source_event_id   TEXT;

-- one room per (kind, id) source event; partial so DMs / user rooms
-- (source_event_id IS NULL) are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_comm_rooms_source_event
  ON comm_rooms (source_event_kind, source_event_id)
  WHERE source_event_id IS NOT NULL;
