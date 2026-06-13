-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 054 · aircraft_positions: add type + military columns
--
-- The ADS-B feed now sources from ADSBexchange (services/adsb-ingest,
-- PR #181), whose v2 records carry an aircraft type code (`t`) and a
-- dbFlags bitmask whose bit 0 marks military airframes — fields the
-- adsb.lol and OpenSky eras dropped or never had. Persist them so
-- /api/aircraft can surface them again and the Globe's military
-- highlighting (red track + "(Military)" tooltip, MapView.tsx) and the
-- "Military" sub-layer (lib/layer-config.ts) light up.
--
--   type     — aircraft type code (e.g. "B738", "A320"); NULL if unknown
--   military — true when ADSBexchange dbFlags bit 0 is set
--
-- aircraft_positions is upsert-keyed on icao24 (migration 044) and is
-- currently empty, so adding a NOT NULL DEFAULT column needs no
-- backfill and no table rewrite. RLS "Public read aircraft"
-- (migration 001) is row-level, so the new columns are readable with
-- no policy change.
--
-- Idempotent. Apply MANUALLY in the Supabase Dashboard → SQL Editor
-- BEFORE merging PR #181: Railway auto-deploys main on merge, and the
-- updated /api/aircraft select (and the ingest upsert) would 500 on the
-- missing columns until this runs.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE aircraft_positions
  ADD COLUMN IF NOT EXISTS type     text,
  ADD COLUMN IF NOT EXISTS military boolean NOT NULL DEFAULT false;

-- Make PostgREST pick up the new columns immediately. The Dashboard SQL
-- editor usually reloads on DDL, but this NOTIFY is harmless and makes
-- it deterministic.
NOTIFY pgrst, 'reload schema';
