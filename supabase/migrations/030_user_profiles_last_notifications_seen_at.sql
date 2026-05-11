-- ═══════════════════════════════════════════════════════════════
-- Migration 030 — Bell badge clear-on-click
--
-- Adds a per-user "last seen" timestamp for the notification bell.
-- Click → POST /api/notifications/mark-seen sets this to NOW().
-- GET /api/notifications/unread-count then counts only fires with
-- fired_at > last_notifications_seen_at (capped at 24 h ago so a
-- user who hasn't checked in months doesn't suddenly see a giant
-- backlog — the badge is "what's new since I last looked OR the
-- last 24 h, whichever is more recent").
--
-- Defaults NULL — pre-existing users keep the current "last 24 h"
-- semantics until they click the bell once.
--
-- RLS: user_profiles already has a FOR ALL self-manage policy from
-- migration 001, so no policy work is needed.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS last_notifications_seen_at TIMESTAMPTZ;
