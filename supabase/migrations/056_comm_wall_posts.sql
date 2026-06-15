-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 056 · COMM wall posts
--
-- The profile "wall": short, character-limited posts authored by the
-- profile owner. Posting is owner-only (enforced at the API layer via
-- getCurrentUser + author_id = user.id), so a wall is a personal feed,
-- not open comments — a low abuse surface. Optional prediction_id /
-- share_token columns let a future post be prediction-backed or
-- evidence-linked (reusing the share-token system); v1 uses body only.
--
-- Additive. Apply MANUALLY in the Supabase SQL Editor BEFORE merge.
-- The /u/<handle> loader reads this table fail-soft, so a deploy that
-- lands before this migration degrades gracefully (no wall) rather
-- than 500ing.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS comm_wall_posts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id     UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  body          TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 280),
  prediction_id UUID REFERENCES predictions_register(id),  -- optional: prediction-backed
  share_token   TEXT,                                      -- optional: evidence link
  visibility    TEXT NOT NULL DEFAULT 'public'
        CHECK (visibility IN ('public','followers')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wall_author
  ON comm_wall_posts (author_id, created_at DESC);

ALTER TABLE comm_wall_posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS comm_wall_public_read ON comm_wall_posts;
CREATE POLICY comm_wall_public_read ON comm_wall_posts
  FOR SELECT USING (visibility = 'public');
-- writes go through the service-role API guarded by getCurrentUser;
-- 'followers' visibility is filtered server-side via the follow graph.
