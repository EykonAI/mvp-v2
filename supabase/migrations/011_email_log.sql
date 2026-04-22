-- ═══════════════════════════════════════════════════════════════
-- Migration 011 — Email log (Phase C transactional email)
--
-- Audit trail for every email Resend sends on our behalf. The cron
-- drain writes a 'queued' row; the resend-webhook handler updates it
-- through delivered → opened → clicked → bounced → complained. The
-- user-facing read policy is GDPR Article 20 compliant: each user
-- can export a history of "every email you've sent me" without the
-- internal payload details (the HTML body isn't stored, only the
-- template name and addressing + event timestamps).
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Addressing. user_id is NULL for pre-signup emails (waitlist
  -- confirmation, verified-discount approval).
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  to_email TEXT NOT NULL,
  from_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  -- Template + any contextual data. The HTML body is NOT persisted
  -- so we don't accumulate content that would need to be covered by
  -- a DPA or deletion policy.
  template TEXT NOT NULL,
  context JSONB NOT NULL DEFAULT '{}',
  -- Resend-assigned message id. NULL when EMAIL_DRY_RUN=true or
  -- auth is disabled (we log-only in dev).
  resend_message_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','sent','delivered','opened','clicked','bounced','complained','failed','dry_run')),
  error_message TEXT,
  -- Event timestamps. Updated by the resend-webhook handler.
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  bounced_at TIMESTAMPTZ,
  complained_at TIMESTAMPTZ,
  -- Links back to the triggering event so we can diagnose "why did
  -- this user get this email" during support conversations.
  notification_queue_id UUID REFERENCES notification_queue(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_log_user
  ON email_log (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_log_to_email
  ON email_log (to_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_status
  ON email_log (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_template
  ON email_log (template);

-- RLS: owners can read their own email log (GDPR export).
-- Writes only via service role (cron + webhook + API routes).
ALTER TABLE email_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own email log" ON email_log
  FOR SELECT USING (auth.uid() = user_id);
