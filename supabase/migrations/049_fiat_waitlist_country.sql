-- ═══════════════════════════════════════════════════════════════
-- Migration 049 — fiat_waitlist.country (Waitlist Dashboard, F-2)
--
-- Adds an ISO-3166 alpha-2 country code, resolved server-side from the
-- request's edge geo header (x-vercel-ip-country / cf-ipcountry / …) at
-- signup time — see app/api/waitlist/route.ts + lib/geo/request-country.ts.
--
-- Privacy: we store the COUNTRY CODE ONLY, never the raw IP. ip_hash stays
-- the sole IP-derived value and is a one-way SHA-256 (irreversible by
-- design), so the 24 existing rows CANNOT be backfilled — they remain
-- country = NULL and the dashboard renders NULL as "—". Only signups that
-- land after this migration ships will carry a country.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE fiat_waitlist ADD COLUMN IF NOT EXISTS country TEXT;  -- ISO-3166 alpha-2
