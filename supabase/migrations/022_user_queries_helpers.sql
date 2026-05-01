-- ═══════════════════════════════════════════════════════════════
-- Migration 022 — user_queries helper RPCs
--
-- Adds the atomic-increment helper that the Re-run path
-- (/api/user_queries/[id]/rerun) calls to bump run_count without
-- racing concurrent re-runs.
--
-- SECURITY DEFINER so the function can be called via the service-role
-- admin client (where auth.uid() is NULL). Ownership is enforced by
-- the explicit p_user_id parameter combined with the WHERE clause.
-- The Node-side caller must verify ownership *before* invoking this
-- (e.g. by reading the row under RLS first).
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION increment_user_query_run_count(
  p_id      UUID,
  p_user_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new INTEGER;
BEGIN
  UPDATE user_queries
  SET run_count   = run_count + 1,
      last_run_at = NOW()
  WHERE id = p_id AND user_id = p_user_id
  RETURNING run_count INTO v_new;
  RETURN COALESCE(v_new, 0);
END;
$$;

REVOKE ALL ON FUNCTION increment_user_query_run_count(UUID, UUID) FROM PUBLIC;
