-- ═══════════════════════════════════════════════════════════════
-- 014 — ports.country_code → full-name `country` column
--
-- The NGA WPI Pub 150 CSV labels its country column "Country Code" but
-- actually fills it with full English country names ("United States",
-- "Libya", "Greece"), not ISO 3166 alpha-2. The `country_code CHAR(2)`
-- column from migration 013 was therefore unusable — every value would
-- truncate to the first two letters of the name.
--
-- This migration adds a `country TEXT` column for the real values and
-- leaves `country_code` in place (NULL) so a future PR can populate ISO
-- codes via a name → ISO mapping if/when that becomes useful.
--
-- Idempotent — safe to re-run. Ports table is expected to be empty when
-- this lands (real WPI data ingest happens in the same PR), so no data
-- migration step is needed.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE ports ADD COLUMN IF NOT EXISTS country TEXT;

-- The `idx_ports_country` index name was already taken by migration 013
-- pointing at `country_code` (which we now leave NULL). Use a distinct name
-- to avoid the silent CREATE INDEX IF NOT EXISTS no-op.
CREATE INDEX IF NOT EXISTS idx_ports_country_name ON ports (country);
