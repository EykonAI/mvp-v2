-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 067 · COMM UX Uplift §4.2 · paid-space soft-delete
--
-- Adds an 'archived' status so a creator can "delete" a space in the app
-- without touching the chain. Archiving hides the space from discovery and
-- revokes member access (handled in the manage API) — but the on-chain
-- Unlock lock is non-custodial and is NOT destroyed: the lock row is simply
-- unlinked, and the creator's funds stay theirs on Base. (Mirrors the
-- abandon-vs-resume reality from the Spaces rollout.)
--
-- Additive: only widens the status CHECK. Apply MANUALLY in the Supabase
-- SQL Editor BEFORE merge — the manage API writes status='archived'.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE comm_spaces DROP CONSTRAINT IF EXISTS comm_spaces_status_check;
ALTER TABLE comm_spaces
  ADD CONSTRAINT comm_spaces_status_check
  CHECK (status IN ('draft', 'live', 'paused', 'archived'));
