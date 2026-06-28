-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 065 · COMM E2 · paid-space lock lifecycle status
--
-- Adds a deploy/config state machine to comm_spaces so "Enable
-- subscriptions" is safe under concurrent / multi-replica requests.
-- An atomic claim (claimSpaceLockWork) replaces the in-process-only
-- serializer in unlock.ts that let a double-click race the deployer
-- nonce → "replacement transaction underpriced". It also lets the UI
-- show "live" only once the non-custodial handoff (creator = manager,
-- deployer renounced) has actually completed — not merely when a lock
-- address was first recorded.
--
--   lock_status    : NULL = not started · 'working' = a deploy/config is
--                    in flight (claimed) · 'ready' = fully configured +
--                    non-custodial · 'failed' = a step threw; reclaimable
--                    so the idempotent flow resumes on the next call.
--   lock_status_at : when the row entered its current status. A 'working'
--                    claim older than the app TTL (5 min) is treated as
--                    stale (a crashed deploy) → reclaimable.
--
-- Backfill: spaces that already hold a lock are marked 'ready' so their
-- display doesn't regress. (Pre-existing half-configured test locks are
-- being abandoned; their on-chain state is independent of this flag.)
--
-- Additive. Apply MANUALLY in the Supabase SQL Editor BEFORE merge —
-- loadSpace + the enable route now select / transition lock_status, so
-- the column must exist before the new code deploys.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE comm_spaces
  ADD COLUMN IF NOT EXISTS lock_status    TEXT CHECK (lock_status IN ('working','ready','failed')),
  ADD COLUMN IF NOT EXISTS lock_status_at TIMESTAMPTZ;

UPDATE comm_spaces
  SET lock_status = 'ready', lock_status_at = now()
  WHERE lock_address IS NOT NULL AND lock_status IS NULL;
