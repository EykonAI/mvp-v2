-- ═══════════════════════════════════════════════════════════════
-- 019 — Row Level Security: explicit public-read on reference data,
--       lockdown on internal tables.
--
-- Supabase auto-exposes every table in `public` via PostgREST. With
-- RLS disabled on a table, anyone holding the anon key (which ships
-- in our front-end JS bundle and is therefore publicly knowable) can
-- read the entire table via REST.
--
-- This migration silences the eight RLS critical warnings shown in
-- the Supabase Advisor by partitioning the affected tables into two
-- groups:
--
--   A) Public reference data (CC-BY ingested datasets) — enable RLS
--      and add an explicit "anyone can SELECT" policy. No behaviour
--      change; the public-readability becomes deliberate and
--      audit-trail-able instead of accidental.
--
--   B) Internal data (AI-generated reports, anomaly flags, sub-agent
--      logs) — enable RLS with NO policies. Anon-key reads now return
--      zero rows. Server-side routes using the SUPABASE_SERVICE_ROLE_KEY
--      bypass RLS by design and continue working unchanged.
--
-- spatial_ref_sys is intentionally NOT touched — it's a PostGIS-managed
-- catalogue table whose RLS state can break spatial functions if
-- modified. The Advisor warning for it is well-known and dismissable.
--
-- Idempotent — DROP POLICY IF EXISTS guards the CREATE POLICY calls.
-- ═══════════════════════════════════════════════════════════════

-- ─── A) Public reference data — RLS on, public SELECT ─────────

-- airports (OurAirports, public domain ⊆ CC-BY-attributed)
ALTER TABLE airports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read access" ON airports;
CREATE POLICY "Public read access" ON airports FOR SELECT USING (true);

-- ports (NGA World Port Index, US Government public)
ALTER TABLE ports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read access" ON ports;
CREATE POLICY "Public read access" ON ports FOR SELECT USING (true);

-- power_plants (GEM GIPT, CC-BY 4.0)
ALTER TABLE power_plants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read access" ON power_plants;
CREATE POLICY "Public read access" ON power_plants FOR SELECT USING (true);

-- gas_pipelines (GEM GGIT, CC-BY 4.0)
ALTER TABLE gas_pipelines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read access" ON gas_pipelines;
CREATE POLICY "Public read access" ON gas_pipelines FOR SELECT USING (true);

-- lng_terminals (GEM GGIT, CC-BY 4.0)
ALTER TABLE lng_terminals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read access" ON lng_terminals;
CREATE POLICY "Public read access" ON lng_terminals FOR SELECT USING (true);

-- ─── B) Internal data — RLS on, no policies (service-role only) ─

-- agent_reports — proprietary AI-generated intelligence narratives
ALTER TABLE agent_reports ENABLE ROW LEVEL SECURITY;
-- (no SELECT/INSERT/UPDATE/DELETE policies; anon key returns zero rows.
--  /api/* server routes use the service role key which bypasses RLS.)

-- anomaly_flags — internal Intelligence Center signal-detection state
ALTER TABLE anomaly_flags ENABLE ROW LEVEL SECURITY;

-- agent_execution_log — sub-agent runtime telemetry / audit trail
ALTER TABLE agent_execution_log ENABLE ROW LEVEL SECURITY;
