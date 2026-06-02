-- ═══════════════════════════════════════════════════════════════
-- Migration 046 — channel_touchpoints (per-channel marketing attribution)
--
-- The PAMS workstream: make every inbound campaign click attributable
-- to the marketing channel it came from (X, LinkedIn, newsletter,
-- Product Hunt, Reddit, Hacker News, …), persist it first-touch across
-- the visit, and resolve it to the user at signup and again at first
-- paid conversion — closing the loop channel → signup → revenue.
--
-- DISTINCT from attribution_events (025), which is VIRAL-REFERRAL
-- sharing ("advocate u_… shared artifact X; recipient clicked"). That
-- table's referrer_public_id / artifact_type / artifact_id are all
-- NOT NULL and carry no meaning for an anonymous paid-channel touch, so
-- it is the wrong home for channel data. This is a new, parallel table
-- that mirrors attribution_events' privacy posture (ip_hash never raw
-- IP; service-role-only RLS) and user_profiles' pending→resolved
-- attribution pattern (referred_by_pending → referred_by).
--
-- The channel tag is the canonical utm_source (or the short ?ch= alias)
-- validated against apps/web/lib/attribution/channels.ts. ?ref= stays
-- owned by the referral system (025) and is NOT touched here.
--
-- This migration is additive only:
--   • New table channel_touchpoints (the inbound touch stream).
--   • user_profiles gains acquisition_channel_pending (first-touch,
--     captured pre-conversion) and acquisition_channel (finalised at
--     first paid conversion), mirroring referred_by_pending/referred_by.
--
-- RLS: channel_touchpoints is RLS-enabled with NO policies — service
-- role only, exactly like attribution_events. Writes happen server-side
-- via the service-role client; there is no client read path.
--
-- Idempotent: every CREATE / ADD COLUMN uses IF NOT EXISTS. Matches the
-- project convention from 007 / 021 / 025 / 045.
--
-- Apply MANUALLY in Supabase Dashboard → SQL Editor (Railway does not
-- auto-apply migrations). Verify with the supabase-ro MCP afterwards.
-- ═══════════════════════════════════════════════════════════════

-- ─── channel_touchpoints (every inbound campaign touch) ─────────
-- One row per tagged landing (written by /api/attribution/channel via
-- the service role). first-/last-touch are derivable by created_at
-- ordering within a session_id or user_id; the user-level first-touch
-- winner is finalised onto user_profiles.acquisition_channel by the
-- 047 trigger extension.

CREATE TABLE IF NOT EXISTS channel_touchpoints (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Anonymous session id (eykon_session cookie). Ties pre-signup
  -- touches from the same visitor together. Nullable: some touches
  -- arrive before any session cookie exists.
  session_id    TEXT,
  -- Set once the visitor is a known auth user (capture while signed in,
  -- or backfilled). NO ACTION-free: SET NULL on user delete so the
  -- aggregate touch stream survives GDPR deletion as anonymised rows.
  user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Canonical channel tag (utm_source / ?ch), validated against the
  -- single-source-of-truth list in lib/attribution/channels.ts.
  channel       TEXT NOT NULL,
  -- Raw UTM values for granularity (campaign-level reporting). The
  -- canonical `channel` above is derived from utm_source.
  utm_source    TEXT,
  utm_medium    TEXT,
  utm_campaign  TEXT,
  utm_content   TEXT,
  utm_term      TEXT,
  -- First path the touch hit (e.g. '/', '/intel'). Path only.
  landing_path  TEXT,
  -- HOST of document.referrer only (e.g. 'www.linkedin.com'); never the
  -- full referrer URL — that can carry PII in its query string.
  referrer_host TEXT,
  -- SHA-256 of the client IP (lib/referral/capture#hashIpAddress). The
  -- raw IP is NEVER persisted. Backs the per-IP capture rate limit.
  ip_hash       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Session funnel: order a visitor's touches to pick first-/last-touch.
CREATE INDEX IF NOT EXISTS idx_ctp_session
  ON channel_touchpoints (session_id, created_at);
-- Channel reporting: touches per channel over time.
CREATE INDEX IF NOT EXISTS idx_ctp_channel
  ON channel_touchpoints (channel, created_at DESC);
-- Resolve touches to a known user.
CREATE INDEX IF NOT EXISTS idx_ctp_user
  ON channel_touchpoints (user_id);
-- Backs the per-IP capture rate limit (checkChannelTouchIpRate):
-- .eq(ip_hash).gt(created_at, cutoff).
CREATE INDEX IF NOT EXISTS idx_ctp_ip
  ON channel_touchpoints (ip_hash, created_at DESC);

-- ─── Row-Level Security ───────────────────────────────────────
-- Service-role only — no client SELECT/INSERT/UPDATE/DELETE. With RLS
-- enabled and zero policies defined, all non-service-role access is
-- denied by default. Identical posture to attribution_events (025).

ALTER TABLE channel_touchpoints ENABLE ROW LEVEL SECURITY;

-- ─── user_profiles: pending → resolved channel attribution ──────
-- Mirrors referred_by_pending (text) → referred_by (uuid) from 025.
-- acquisition_channel_pending holds the first-touch channel captured at
-- signup (handle_new_user, 047); acquisition_channel is the finalised
-- value written at first paid conversion (handle_first_paid_conversion,
-- 047), so paid revenue is attributable to the originating channel.
-- Both nullable forever: an untagged/direct signup leaves them NULL.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS acquisition_channel_pending TEXT,
  ADD COLUMN IF NOT EXISTS acquisition_channel         TEXT;
