-- ═══════════════════════════════════════════════════════════════
-- 115 · NEWSJACK DRAFT REVISIONS
--
-- Lets a recomposed thread be saved into the review queue as a NEW row
-- beside the original, instead of overwriting it.
--
-- WHY NOT JUST UPDATE THE EXISTING ROW. The original is the audit trail:
-- it is what the engine actually produced at detection time, and #415's
-- whole provenance design rests on being able to tell later which writer
-- wrote what. Overwriting it would stamp composer='agent' on a row the
-- template wrote, and the queue and the weekly digest would then both
-- misreport. Keep both; let the founder choose between them.
--
-- WIDENING, NOT REPLACING. The existing UNIQUE (event_id, channel) is
-- swapped for UNIQUE (event_id, channel, revision). That is strictly MORE
-- permissive: every existing row satisfies it at revision 0, and no pair
-- can collide because the old constraint already guaranteed uniqueness on
-- the first two columns. This is the safe direction — the brief's warning
-- is about REPLACING a constraint with a narrower one on a populated
-- table, which this is not. Verify anyway at apply time:
--
--   SELECT event_id, channel, count(*)
--   FROM newsjack_drafts GROUP BY 1,2 HAVING count(*) > 1;   -- expect 0 rows
--
-- Additive otherwise. RLS unchanged: still on, still no permissive policy,
-- still service-role only.
--
-- Apply MANUALLY in the Supabase SQL Editor BEFORE merge.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE newsjack_drafts
  ADD COLUMN IF NOT EXISTS revision            SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS supersedes_draft_id UUID REFERENCES newsjack_drafts(id) ON DELETE SET NULL;

ALTER TABLE newsjack_drafts
  DROP CONSTRAINT IF EXISTS newsjack_drafts_event_id_channel_key;

ALTER TABLE newsjack_drafts
  ADD CONSTRAINT newsjack_drafts_event_channel_revision_key
    UNIQUE (event_id, channel, revision);

CREATE INDEX IF NOT EXISTS idx_newsjack_drafts_supersedes
  ON newsjack_drafts (supersedes_draft_id)
  WHERE supersedes_draft_id IS NOT NULL;

COMMENT ON COLUMN newsjack_drafts.revision IS
  '0 = written by the engine at detection time. 1+ = saved from the founder-gated dry-run recompose. Originals are never overwritten.';
COMMENT ON COLUMN newsjack_drafts.supersedes_draft_id IS
  'The revision-0 draft this one was recomposed from. Nullable: the link is provenance, not a dependency.';
