-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 060 · COMM Workstream B1 · rooms + messages (DMs)
--
-- A DM is a room with kind='dm' and a unique dm_key = sorted(uidA,uidB),
-- so "message someone" is a get-or-create on that key. Rooms (kind=
-- 'room') and paid spaces (kind='space') reuse the same tables in B2/E.
--
-- All access goes through the service-role API guarded by getCurrentUser
-- with explicit membership checks, so RLS is enabled with NO permissive
-- policy — these are private conversations (service_role bypasses RLS).
-- Add member-scoped SELECT policies later if the browser subscribes
-- directly (Supabase Realtime). Additive; apply MANUALLY before merge.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS comm_rooms (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       TEXT NOT NULL DEFAULT 'dm' CHECK (kind IN ('dm','room','space')),
  title      TEXT,
  dm_key     TEXT UNIQUE,                 -- 'uidA:uidB' (sorted) for DMs; null otherwise
  created_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS comm_room_members (
  room_id      UUID NOT NULL REFERENCES comm_rooms(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ,
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_room_members_user ON comm_room_members (user_id);

CREATE TABLE IF NOT EXISTS comm_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id    UUID NOT NULL REFERENCES comm_rooms(id) ON DELETE CASCADE,
  author_id  UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  body       TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_room ON comm_messages (room_id, created_at);

ALTER TABLE comm_rooms        ENABLE ROW LEVEL SECURITY;
ALTER TABLE comm_room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE comm_messages     ENABLE ROW LEVEL SECURITY;
-- (no permissive policies — private; all access via the service-role API)
