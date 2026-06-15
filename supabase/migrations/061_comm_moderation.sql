-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 061 · COMM Workstream B3 · moderation (block + report)
--
-- comm_blocks: a directed block (blocker → blocked). Enforced in the
-- DM flow (no new DM if blocked, either direction) and by filtering a
-- blocker's view of blocked authors' messages.
-- comm_reports: user/message/room reports for founder review
-- (/admin/comm-reports, gated by isFounder).
--
-- Private; all access via the service-role API (writes guarded by
-- getCurrentUser, the reports list by isFounder). Additive; apply
-- MANUALLY before merge.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS comm_blocks (
  blocker_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON comm_blocks (blocker_id);

CREATE TABLE IF NOT EXISTS comm_reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('user','message','room')),
  target_id   TEXT NOT NULL,
  reason      TEXT,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','dismissed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON comm_reports (status, created_at DESC);

ALTER TABLE comm_blocks  ENABLE ROW LEVEL SECURITY;
ALTER TABLE comm_reports ENABLE ROW LEVEL SECURITY;
-- (no permissive policies — all access via the service-role API)
