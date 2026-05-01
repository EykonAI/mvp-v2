-- ═══════════════════════════════════════════════════════════════
-- Migration 023 — Notification Center foundation
--
-- Three tables back the self-serve event-driven alerts feature
-- (Notification Center, /notif). The user creates rules, every rule
-- fires through one or more verified channels, every fire is logged.
--
--   user_channels            One row per verified delivery handle
--                            (email / SMS / WhatsApp). The rule
--                            references channels by id, not by raw
--                            handle string — this keeps the handle
--                            lifecycle (verify, rotate, revoke)
--                            orthogonal to the rule lifecycle.
--
--   user_notification_rules  One row per active or paused rule.
--                            Four rule types: single_event and
--                            multi_event are evaluated by the cheap
--                            cron (15-min cadence, pure SQL); the
--                            two AI types (outcome_ai, cross_data_ai)
--                            are evaluated by the AI cron (1-h
--                            cadence, Claude SDK).
--
--   user_notification_log    Per-fire append-only audit trail. Rows
--                            are written even when the dispatcher
--                            suppresses delivery (e.g. user is over
--                            the SMS / WhatsApp monthly cap) so the
--                            user can see why an expected fire
--                            never reached their phone.
--
-- Idempotent: every CREATE uses IF NOT EXISTS; policies are guarded
-- with DROP POLICY IF EXISTS, matching the project convention from
-- migrations 019 and 021.
-- ═══════════════════════════════════════════════════════════════

-- ─── Channels (verified per user) ──────────────────────────────

CREATE TABLE IF NOT EXISTS user_channels (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel_type             TEXT NOT NULL CHECK (channel_type IN ('email', 'sms', 'whatsapp')),
  -- Email address or E.164 phone number. The dispatcher refuses to
  -- send to a row where verified_at IS NULL.
  handle                   TEXT NOT NULL,
  -- Optional user-facing label, e.g. "Work email", "Trading SMS".
  label                    TEXT,
  -- NULL until the user completes verification. NOT NULL semantics
  -- live in app code, not a constraint, so the verify flow can
  -- write a row first and update it on success.
  verified_at              TIMESTAMPTZ,
  -- Six-digit code (email + SMS) or Twilio template marker
  -- (WhatsApp). Cleared on successful verification.
  verification_code        TEXT,
  verification_expires_at  TIMESTAMPTZ,
  -- Soft-disable a channel without losing the verification — e.g.
  -- a user pausing SMS while travelling.
  active                   BOOLEAN NOT NULL DEFAULT true,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Channel selector in the rule builder reads only verified, active
-- rows. Partial index keeps the lookup tight even after thousands
-- of unverified or revoked rows accumulate.
CREATE INDEX IF NOT EXISTS idx_user_channels_user_verified
  ON user_channels (user_id, channel_type)
  WHERE verified_at IS NOT NULL AND active = true;

-- ─── Rules ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_notification_rules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  rule_type         TEXT NOT NULL CHECK (rule_type IN (
    'single_event', 'multi_event', 'outcome_ai', 'cross_data_ai'
  )),
  -- Type-specific payload. Shape is enforced in app code (rule
  -- builder + cron evaluator) rather than the DB so we can iterate
  -- on the schema without migrations:
  --   single_event   { tool, filter }
  --   multi_event    { predicates: [...], window_hours }
  --   outcome_ai     { outcome_statement, k_events, scope }
  --   cross_data_ai  { outcome_statement, buckets: [...] }
  config            JSONB NOT NULL,
  -- References user_channels.id. The dispatcher drops any element
  -- that no longer points at a verified, active channel — no FK
  -- constraint because Postgres can't FK an array element.
  channel_ids       UUID[] NOT NULL,
  active            BOOLEAN NOT NULL DEFAULT true,
  -- Server-enforced minimum 15 min — a user typing 0 cannot create
  -- an alert-storm. Default 6 h matches §10.
  cooldown_minutes  INTEGER NOT NULL DEFAULT 360 CHECK (cooldown_minutes >= 15),
  -- Persona at creation time. Frozen on the row for analytics; the
  -- user's current persona may have moved on. NULL when the rule
  -- predates persona selection (defensive, not currently emitted).
  persona           TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Set by the cron evaluator after a successful fire. Drives the
  -- cooldown gate on the next evaluation pass.
  last_fired_at     TIMESTAMPTZ
);

-- Rule list view (per-user, newest first) and the cheap evaluator's
-- per-user scan both hit this index.
CREATE INDEX IF NOT EXISTS idx_user_notification_rules_user_active
  ON user_notification_rules (user_id, active, updated_at DESC);

-- The cheap and AI crons each scan rules of their own types across
-- all users. Partial index keeps each scan tight.
CREATE INDEX IF NOT EXISTS idx_user_notification_rules_cheap_active
  ON user_notification_rules (rule_type, last_fired_at)
  WHERE active = true AND rule_type IN ('single_event', 'multi_event');

CREATE INDEX IF NOT EXISTS idx_user_notification_rules_ai_active
  ON user_notification_rules (rule_type, last_fired_at)
  WHERE active = true AND rule_type IN ('outcome_ai', 'cross_data_ai');

-- ─── Fire log ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_notification_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ON DELETE CASCADE on rule_id keeps the log tied to the rule's
  -- lifecycle. user_id remains independently FK'd to auth.users so
  -- account deletion still cleans up.
  rule_id          UUID REFERENCES user_notification_rules(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fired_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Channels the dispatcher attempted. May differ from the rule's
  -- current channel_ids if a channel was deleted between fire and
  -- log write.
  channel_ids      UUID[] NOT NULL,
  -- Event details + AI rationale where applicable. Shape mirrors
  -- the rule type:
  --   single_event   { tool, row, summary }
  --   multi_event    { events: [...], window_hours, summary }
  --   outcome_ai     { outcome_statement, rationale, events: [...] }
  --   cross_data_ai  { outcome_statement, buckets: [...], rationale }
  payload          JSONB NOT NULL,
  -- Per-channel result: { "<channel_id>": { ok, provider_id?, error?, suppressed_reason? } }
  -- suppressed_reason is set when the dispatcher refuses to send
  -- (e.g. "monthly_cap_exceeded", "channel_unverified").
  delivery_status  JSONB
);

-- Recent-fires view (24 h on /notif?filter=recent, 30 d on
-- /settings) and the bell-glyph 24-h count both hit this.
CREATE INDEX IF NOT EXISTS idx_user_notification_log_user_recent
  ON user_notification_log (user_id, fired_at DESC);

-- Per-rule per-day rate limit (20 fires / 24 h, §3.6). Lookup by
-- rule_id with a fired_at filter — small index, big payoff.
CREATE INDEX IF NOT EXISTS idx_user_notification_log_rule_recent
  ON user_notification_log (rule_id, fired_at DESC);

-- ─── Row-Level Security ───────────────────────────────────────
-- Per the project's per-user-data principle: every table is RLS
-- enabled with self-* policies. Cron evaluators run as the service
-- role and bypass RLS by design — they're trusted code paths that
-- mutate other users' rows.

ALTER TABLE user_channels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "self read" ON user_channels;
CREATE POLICY "self read" ON user_channels
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "self write" ON user_channels;
CREATE POLICY "self write" ON user_channels
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "self update" ON user_channels;
CREATE POLICY "self update" ON user_channels
  FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "self delete" ON user_channels;
CREATE POLICY "self delete" ON user_channels
  FOR DELETE USING (user_id = auth.uid());

ALTER TABLE user_notification_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "self read" ON user_notification_rules;
CREATE POLICY "self read" ON user_notification_rules
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "self write" ON user_notification_rules;
CREATE POLICY "self write" ON user_notification_rules
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "self update" ON user_notification_rules;
CREATE POLICY "self update" ON user_notification_rules
  FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "self delete" ON user_notification_rules;
CREATE POLICY "self delete" ON user_notification_rules
  FOR DELETE USING (user_id = auth.uid());

-- The fire log is read-only from the user's perspective. Inserts
-- happen via the cron evaluators (service role); deletes happen via
-- the rule's ON DELETE CASCADE. No self-write or self-delete policy.
ALTER TABLE user_notification_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "self read" ON user_notification_log;
CREATE POLICY "self read" ON user_notification_log
  FOR SELECT USING (user_id = auth.uid());
