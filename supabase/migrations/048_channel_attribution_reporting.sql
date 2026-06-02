-- ═══════════════════════════════════════════════════════════════
-- Migration 048 — Channel attribution reporting views
--
-- Two read-only views that answer the PAMS definition-of-done question
-- "which channel actually converted?" end to end:
--
--   channel_touchpoint_summary  — TOP of funnel. Aggregates the raw
--     channel_touchpoints stream (046): touches, distinct sessions and
--     known users, and the first/last time each channel was seen.
--
--   channel_attribution_summary — BOTTOM of funnel. Aggregates
--     user_profiles by acquisition channel: signups and paid
--     conversions per channel, plus the paid-conversion rate.
--
-- The channel used for grouping is COALESCE(acquisition_channel,
-- acquisition_channel_pending, 'direct'): a converted user has the
-- finalised acquisition_channel; a not-yet-converted signup still has
-- the pending value; an untagged signup falls back to 'direct'.
--
-- These are reporting views queried via the SERVICE ROLE (founder
-- admin / analytics). They are plain SECURITY INVOKER views, so RLS on
-- the underlying tables still applies to any non-service-role caller —
-- there is no new client read path onto user data here.
--
-- Idempotent: CREATE OR REPLACE VIEW. Apply MANUALLY in the Supabase
-- Dashboard → SQL Editor AFTER 046 (depends on its columns/table).
-- ═══════════════════════════════════════════════════════════════

-- ─── Top of funnel: the inbound touch stream by channel ─────────

CREATE OR REPLACE VIEW channel_touchpoint_summary AS
SELECT
  channel,
  COUNT(*)                              AS touches,
  COUNT(DISTINCT session_id)            AS distinct_sessions,
  COUNT(DISTINCT user_id)               AS distinct_known_users,
  MIN(created_at)                       AS first_seen,
  MAX(created_at)                       AS last_seen
FROM channel_touchpoints
GROUP BY channel
ORDER BY touches DESC;

-- ─── Bottom of funnel: signups → paid conversions by channel ────

CREATE OR REPLACE VIEW channel_attribution_summary AS
SELECT
  COALESCE(acquisition_channel, acquisition_channel_pending, 'direct') AS channel,
  COUNT(*)                                                AS signups,
  COUNT(*) FILTER (WHERE first_paid_at IS NOT NULL)       AS paid_conversions,
  ROUND(
    COUNT(*) FILTER (WHERE first_paid_at IS NOT NULL)::numeric
      / NULLIF(COUNT(*), 0),
    4
  )                                                       AS paid_rate
FROM user_profiles
GROUP BY COALESCE(acquisition_channel, acquisition_channel_pending, 'direct')
ORDER BY signups DESC;
