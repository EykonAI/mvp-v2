-- ═══════════════════════════════════════════════════════════════
-- Migration 024 — Notification Center per-user billing state
--
-- Tracks the soft-warn email that fires once per calendar month when
-- a user crosses 80 % of their SMS + WhatsApp combined cap (Pro 50,
-- Desk 200, Enterprise 1000 per brief §10). Without persistent state
-- the dispatcher would re-warn on every fire above the threshold,
-- which is exactly the noise the cap is supposed to prevent.
--
-- Counter is derived on-the-fly from user_notification_log (no
-- denormalised count column — accurate by construction). Only the
-- "warning email already sent" flag lives here.
--
-- One row per user; updated_at carries the last refresh, warned_at
-- is set when the soft-warn email lands (cleared when the period
-- rolls over).
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS user_notif_billing_state (
  user_id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 'YYYY-MM' of the period the warning was issued for. NULL means
  -- never warned. The dispatcher rolls this forward when it sees a
  -- new calendar month.
  warned_for_period  TEXT,
  warned_at          TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Row-Level Security ───────────────────────────────────────
-- Read-only from the user's perspective; the cron evaluators (service
-- role) own writes.

ALTER TABLE user_notif_billing_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "self read" ON user_notif_billing_state;
CREATE POLICY "self read" ON user_notif_billing_state
  FOR SELECT USING (user_id = auth.uid());
