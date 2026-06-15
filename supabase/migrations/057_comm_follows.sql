-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 057 · COMM follow graph
--
-- follower_id follows followee_id. Powers the follower/following counts
-- on the profile and the Follow button; later, "follow-my-radar" mirrors
-- a followed analyst's signals into the follower's NOTIF.
--
-- Writes go through the service-role API guarded by getCurrentUser
-- (follower_id is always the authenticated user). Additive; apply
-- MANUALLY before merge. The loader reads counts fail-soft.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS comm_follows (
  follower_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  followee_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_followee ON comm_follows (followee_id);

ALTER TABLE comm_follows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS comm_follows_public_read ON comm_follows;
CREATE POLICY comm_follows_public_read ON comm_follows
  FOR SELECT USING (true);
