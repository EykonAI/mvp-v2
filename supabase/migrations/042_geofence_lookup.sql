-- ─── 042: geofence lookup ──────────────────────────────────────
-- Adds a small registry of country / chokepoint / sea polygons and
-- two RPCs that filter aircraft_positions / vessel_positions by
-- ST_Intersects(geom, region.geom) — fixing the "registration
-- country ≠ overflight country" semantic bug flagged in §2 of the
-- engineering brief.
--
-- PostGIS is already enabled (migration 001) and both
-- aircraft_positions + vessel_positions already carry a
-- geom GEOGRAPHY(Point, 4326) column with a GIST index. This
-- migration only adds the polygon table + the RPCs that JOIN against
-- it — no schema changes to the existing position tables.
--
-- Seed coverage is intentionally narrow (25 regions): the canonical
-- §11 acceptance test (Moroccan airspace) + the six §10 chokepoints
-- + the major surrounding countries and seas. Polygons are
-- bounding-box approximations — accurate enough for "is this point
-- roughly in country X" filtering, lossy at coastline detail. A
-- future PR can replace any region with a hand-traced polygon or
-- import Natural Earth.

CREATE TABLE IF NOT EXISTS geo_regions (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug      TEXT NOT NULL UNIQUE,
  label     TEXT NOT NULL,
  kind      TEXT NOT NULL CHECK (kind IN ('country', 'chokepoint', 'sea')),
  geom      GEOGRAPHY(MULTIPOLYGON, 4326) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_geo_regions_geom ON geo_regions USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_geo_regions_kind ON geo_regions (kind);

-- ─── Seed: countries ──────────────────────────────────────────
-- ISO-2 slugs. Bounding-box approximations. Coastlines are wrong by
-- design — these polygons are for "is this lat/lon roughly in X",
-- not for cartographic display.

INSERT INTO geo_regions (slug, label, kind, geom) VALUES
  ('MA', 'Morocco',       'country', ST_Multi(ST_MakeEnvelope(-17.0, 21.0,  -1.0, 36.0, 4326))::geography),
  ('SA', 'Saudi Arabia',  'country', ST_Multi(ST_MakeEnvelope( 34.0, 16.0,  56.0, 32.0, 4326))::geography),
  ('IR', 'Iran',          'country', ST_Multi(ST_MakeEnvelope( 44.0, 25.0,  64.0, 40.0, 4326))::geography),
  ('IQ', 'Iraq',          'country', ST_Multi(ST_MakeEnvelope( 38.0, 29.0,  49.0, 38.0, 4326))::geography),
  ('AE', 'UAE',           'country', ST_Multi(ST_MakeEnvelope( 51.0, 22.0,  57.0, 27.0, 4326))::geography),
  ('OM', 'Oman',          'country', ST_Multi(ST_MakeEnvelope( 52.0, 16.0,  60.0, 27.0, 4326))::geography),
  ('YE', 'Yemen',         'country', ST_Multi(ST_MakeEnvelope( 42.0, 12.0,  54.0, 19.0, 4326))::geography),
  ('EG', 'Egypt',         'country', ST_Multi(ST_MakeEnvelope( 24.0, 22.0,  37.0, 32.0, 4326))::geography),
  ('SD', 'Sudan',         'country', ST_Multi(ST_MakeEnvelope( 21.0,  9.0,  39.0, 22.0, 4326))::geography),
  ('TR', 'Turkey',        'country', ST_Multi(ST_MakeEnvelope( 26.0, 36.0,  45.0, 42.0, 4326))::geography),
  ('UA', 'Ukraine',       'country', ST_Multi(ST_MakeEnvelope( 22.0, 44.0,  41.0, 53.0, 4326))::geography),
  ('RU', 'Russia',        'country', ST_Multi(ST_MakeEnvelope( 19.0, 41.0, 180.0, 82.0, 4326))::geography),
  ('IL', 'Israel',        'country', ST_Multi(ST_MakeEnvelope( 34.2, 29.4,  35.9, 33.4, 4326))::geography),
  ('LB', 'Lebanon',       'country', ST_Multi(ST_MakeEnvelope( 35.0, 33.0,  36.7, 34.7, 4326))::geography),
  ('SY', 'Syria',         'country', ST_Multi(ST_MakeEnvelope( 35.5, 32.3,  42.4, 37.3, 4326))::geography);

-- ─── Seed: chokepoints (narrow, more specific) ───────────────
-- These overlap geographically with country polygons but
-- resolve_region_slug() prefers them via the kind ordering.

INSERT INTO geo_regions (slug, label, kind, geom) VALUES
  ('hormuz',        'Strait of Hormuz',  'chokepoint', ST_Multi(ST_MakeEnvelope( 55.5, 25.5,  57.0, 27.0, 4326))::geography),
  ('suez',          'Suez Canal',        'chokepoint', ST_Multi(ST_MakeEnvelope( 32.0, 28.0,  33.0, 32.0, 4326))::geography),
  ('bab-el-mandeb', 'Bab-el-Mandeb',     'chokepoint', ST_Multi(ST_MakeEnvelope( 43.0, 12.0,  44.0, 13.5, 4326))::geography),
  ('bosphorus',     'Bosphorus',         'chokepoint', ST_Multi(ST_MakeEnvelope( 28.9, 41.0,  29.2, 41.3, 4326))::geography),
  ('malacca',       'Strait of Malacca', 'chokepoint', ST_Multi(ST_MakeEnvelope( 98.0,  1.5, 104.0,  6.0, 4326))::geography),
  ('panama',        'Panama Canal',      'chokepoint', ST_Multi(ST_MakeEnvelope(-80.0,  8.8, -79.4,  9.5, 4326))::geography);

-- ─── Seed: seas / regional bodies of water ───────────────────

INSERT INTO geo_regions (slug, label, kind, geom) VALUES
  ('black-sea',     'Black Sea',     'sea', ST_Multi(ST_MakeEnvelope( 27.0, 40.0,  42.0, 47.0, 4326))::geography),
  ('red-sea',       'Red Sea',       'sea', ST_Multi(ST_MakeEnvelope( 32.0, 12.0,  44.0, 30.0, 4326))::geography),
  ('persian-gulf',  'Persian Gulf',  'sea', ST_Multi(ST_MakeEnvelope( 48.0, 24.0,  57.0, 30.0, 4326))::geography),
  ('mediterranean', 'Mediterranean', 'sea', ST_Multi(ST_MakeEnvelope( -6.0, 30.0,  36.0, 46.0, 4326))::geography);

-- ─── resolve_region_slug ──────────────────────────────────────
-- Given a point (as geography), return the slug of the most-specific
-- matching region. Chokepoints win over seas, seas over countries,
-- so a point in the Strait of Hormuz returns 'hormuz' not 'IR' or
-- 'persian-gulf'. STABLE + PARALLEL SAFE → planner is free to push
-- the call into a join or batch it across rows.

CREATE OR REPLACE FUNCTION resolve_region_slug(p_geom geography)
RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT slug
  FROM geo_regions
  WHERE ST_Intersects(geom, p_geom)
  ORDER BY CASE kind
    WHEN 'chokepoint' THEN 0
    WHEN 'sea'        THEN 1
    WHEN 'country'    THEN 2
    ELSE 3
  END
  LIMIT 1;
$$;

-- ─── recent_aircraft_in_region ────────────────────────────────
-- Returns the most-recent N aircraft_positions rows whose geom
-- falls inside the region identified by p_region_slug. Replaces the
-- naive ILIKE on country (registration country) for the AI evaluator
-- — the geometric resolution gives overflight country, which is
-- what users actually want.

CREATE OR REPLACE FUNCTION recent_aircraft_in_region(
  p_region_slug text,
  p_limit       int DEFAULT 50
)
RETURNS SETOF aircraft_positions
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT ap.*
  FROM aircraft_positions ap
  JOIN geo_regions gr ON gr.slug = p_region_slug
  WHERE ST_Intersects(gr.geom, ap.geom)
  ORDER BY ap.ingested_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 500));
$$;

-- ─── recent_vessels_in_region ─────────────────────────────────
-- Same shape for vessel_positions. The flag column on vessels is
-- flag-of-registration, NOT operational country; geometric
-- resolution is the only honest way to narrow Maritime to a
-- theatre. PR 5's aggregate evaluator skipped Maritime country
-- filtering for this same reason — a follow-up PR can wire this
-- RPC into the aggregate path.

CREATE OR REPLACE FUNCTION recent_vessels_in_region(
  p_region_slug text,
  p_limit       int DEFAULT 50
)
RETURNS SETOF vessel_positions
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT vp.*
  FROM vessel_positions vp
  JOIN geo_regions gr ON gr.slug = p_region_slug
  WHERE ST_Intersects(gr.geom, vp.geom)
  ORDER BY vp.ingested_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 500));
$$;

-- ─── RLS ──────────────────────────────────────────────────────
-- geo_regions is reference data — readable by everyone, writable
-- only via migrations. Same shape as conflict_events, refineries,
-- etc.

ALTER TABLE geo_regions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS geo_regions_public_read ON geo_regions;
CREATE POLICY geo_regions_public_read ON geo_regions
  FOR SELECT USING (true);
