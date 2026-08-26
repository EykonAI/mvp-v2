-- ═══════════════════════════════════════════════════════════════
-- 114 · NEWSJACK COMPOSER PROVENANCE
--
-- Records WHICH writer produced each X draft: the copywriting agent
-- (lib/copy/x-composer.ts) or the deterministic template that has
-- always written them (lib/newsjack/template.ts).
--
-- WHY THIS MATTERS MORE THAN IT LOOKS. The composer falls back to the
-- template on any failure, by design — a bad model turn must never
-- cost the engine a detected event. That safety property has a cost:
-- an agent failing EVERY run looks exactly like an agent that is
-- working. Without this stamp there is no way to tell from outside.
-- Same lesson as the ?length=300 echo that finally exposed six days
-- of merges that never deployed.
--
-- Additive. Existing rows correctly read 'template' — that is what
-- wrote them. Nothing else is backfilled: a fabricated attribution is
-- worse than an honest blank.
--
-- newsjack_drafts is RLS-enabled with NO permissive policy and is
-- reachable only via the service-role API; these columns inherit that
-- unchanged.
--
-- Apply MANUALLY in the Supabase SQL Editor BEFORE merge.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE newsjack_drafts
  ADD COLUMN IF NOT EXISTS composer         TEXT NOT NULL DEFAULT 'template'
                             CHECK (composer IN ('agent','template')),
  ADD COLUMN IF NOT EXISTS composer_model   TEXT,
  ADD COLUMN IF NOT EXISTS codex_version    TEXT,
  ADD COLUMN IF NOT EXISTS compose_attempts SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fallback_reason  TEXT,
  ADD COLUMN IF NOT EXISTS craft_warnings   JSONB NOT NULL DEFAULT '[]'::jsonb;

-- The weekly digest breaks out agent vs template and counts
-- fallbacks; this keeps that read off a sequential scan as the table
-- grows. Partial: only X drafts are composed today.
CREATE INDEX IF NOT EXISTS idx_newsjack_drafts_composer
  ON newsjack_drafts (composer, created_at DESC)
  WHERE channel = 'x';

COMMENT ON COLUMN newsjack_drafts.composer IS
  'agent = written by lib/copy/x-composer.ts; template = renderXThread fallback. Three consecutive template rows on a live agent means the agent is down.';
COMMENT ON COLUMN newsjack_drafts.fallback_reason IS
  'Why the template was used despite the agent being enabled. NULL when the agent wrote the row, or when the agent was switched off.';
COMMENT ON COLUMN newsjack_drafts.codex_version IS
  'CODEX_VERSION from lib/copy/x-codex.ts at composition time. A voice file with no version is a stale build you cannot see.';
