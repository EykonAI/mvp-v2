-- ═══════════════════════════════════════════════════════════════
-- Migration 021 — Per-user AI Analyst query history
--
-- Backs the "Query History" tab and the "Personalised Suggested" tab
-- introduced by the eYKON Intelligence Analyst personalisation work.
-- One row per chat submission. Re-runs bump last_run_at + run_count
-- on the existing row instead of inserting a new one (the writer in
-- /api/chat performs that upsert; this migration only owns the shape).
--
-- Read paths (all per-user, RLS-gated):
--   • History tab list:   ORDER BY last_run_at DESC LIMIT 10
--   • Starred-first sort: ORDER BY starred DESC, last_run_at DESC
--   • Suggested tab:      domain_tags overlap + recency window
--
-- Retention: rolling 90 days (product decision, brief §7). The
-- prune_user_queries_older_than_90_days() function is callable from
-- pg_cron / the Supervisor service — wiring the schedule is out of
-- scope for this migration; only the callable lives here.
--
-- Idempotent: every CREATE uses IF NOT EXISTS; policies are guarded
-- with DROP POLICY IF EXISTS, matching the project convention from
-- migration 019.
-- ═══════════════════════════════════════════════════════════════

-- ─── Table ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_queries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  query_text    TEXT NOT NULL,
  response_text TEXT NOT NULL,
  -- Summary of the Claude tool calls fired by this query. Each element:
  --   { "name": "query_refineries", "input": { ... }, "row_count": 42 }
  -- Used by the relevance ranker (specificity component) and the
  -- Suggested-tab cross-data classifier.
  tool_calls    JSONB,
  -- Inferred at write-time from tool_calls + light entity extraction
  -- on query_text (country/region keyword match). Drives the
  -- Suggested-tab "history-inferred" slot and §4.2 search.
  domain_tags   TEXT[],
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_run_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  run_count     INTEGER NOT NULL DEFAULT 1,
  exported_at   TIMESTAMPTZ,
  starred       BOOLEAN NOT NULL DEFAULT false
);

-- ─── Indexes ───────────────────────────────────────────────────

-- History tab list: per-user, newest-first.
CREATE INDEX IF NOT EXISTS idx_user_queries_user_recent
  ON user_queries (user_id, last_run_at DESC);

-- Starred-first ranking (4.1). Partial index keeps it small —
-- only the rows that actually pin to the top.
CREATE INDEX IF NOT EXISTS idx_user_queries_user_starred
  ON user_queries (user_id, last_run_at DESC)
  WHERE starred = true;

-- Suggested tab cross-data classifier and §4.2 tag-based search.
CREATE INDEX IF NOT EXISTS idx_user_queries_domain_tags
  ON user_queries USING GIN (domain_tags);

-- ─── Row-Level Security ───────────────────────────────────────
-- Per §6.4 of the brief: per-user data isolation must be enforced
-- at the database, not just the frontend. /api routes that need to
-- bypass RLS (e.g. the export route fetching by id with explicit
-- ownership check) use SUPABASE_SERVICE_ROLE_KEY.

ALTER TABLE user_queries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "self read" ON user_queries;
CREATE POLICY "self read" ON user_queries
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "self write" ON user_queries;
CREATE POLICY "self write" ON user_queries
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "self update" ON user_queries;
CREATE POLICY "self update" ON user_queries
  FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "self delete" ON user_queries;
CREATE POLICY "self delete" ON user_queries
  FOR DELETE USING (user_id = auth.uid());

-- ─── Retention helper (90 days, brief §7) ─────────────────────
-- Deletes rows whose last_run_at is older than the cutoff. Returns
-- the number of rows pruned so the caller can log it.
--
-- SECURITY DEFINER + a fixed search_path so a future pg_cron job
-- running as a low-priv role can still execute the prune, but no
-- caller can use the function as a stepping stone to other schemas.

CREATE OR REPLACE FUNCTION prune_user_queries_older_than_90_days()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM user_queries
  WHERE last_run_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- Lock down execute: only the postgres role (and any role explicitly
-- granted later) can call this. Anon and authenticated roles cannot.
REVOKE ALL ON FUNCTION prune_user_queries_older_than_90_days() FROM PUBLIC;
