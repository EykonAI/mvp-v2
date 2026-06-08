-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 051 · Harden PAMS reporting views to SECURITY INVOKER
--
-- Migration 048 created channel_touchpoint_summary and
-- channel_attribution_summary with plain `CREATE OR REPLACE VIEW`.
-- Its header INTENDED them to be SECURITY INVOKER, but a Postgres view
-- defaults to SECURITY DEFINER semantics unless `security_invoker` is
-- set explicitly — so the Supabase security linter flags BOTH as
-- ERROR (security_definer_view). As written they would enforce the
-- view OWNER's RLS rather than the caller's, i.e. a potential read path
-- onto user_profiles for any role granted SELECT on the view.
--
-- Fix: flip both to security_invoker = true so the querying role's RLS
-- applies. They are queried via the service role (founder/admin
-- analytics), so behaviour is unchanged for the intended caller — this
-- only closes the lint/exposure gap.
--
-- Idempotent. Apply MANUALLY in the Supabase Dashboard → SQL Editor.
-- ═══════════════════════════════════════════════════════════════

ALTER VIEW public.channel_touchpoint_summary  SET (security_invoker = true);
ALTER VIEW public.channel_attribution_summary SET (security_invoker = true);
