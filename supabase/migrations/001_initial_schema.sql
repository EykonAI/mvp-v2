-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — Supabase Schema (PostGIS + TimescaleDB-compatible)
-- Run this against your Supabase project SQL editor
-- ═══════════════════════════════════════════════════════════════

-- Enable PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;

-- ─── Aircraft Positions (ADS-B) ─────────────────────────────
CREATE TABLE IF NOT EXISTS aircraft_positions (
  id BIGSERIAL PRIMARY KEY,
  icao24 TEXT NOT NULL,
  callsign TEXT,
  longitude DOUBLE PRECISION NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  altitude DOUBLE PRECISION,
  velocity DOUBLE PRECISION,
  heading DOUBLE PRECISION,
  on_ground BOOLEAN DEFAULT FALSE,
  country TEXT,
  squawk TEXT,
  geom GEOGRAPHY(Point, 4326),
  ingested_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_aircraft_geom ON aircraft_positions USING GIST (geom);
CREATE INDEX idx_aircraft_time ON aircraft_positions (ingested_at DESC);
CREATE INDEX idx_aircraft_icao ON aircraft_positions (icao24);

-- ─── Vessel Positions (AIS) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS vessel_positions (
  id BIGSERIAL PRIMARY KEY,
  mmsi TEXT NOT NULL,
  name TEXT,
  vessel_type INTEGER,
  longitude DOUBLE PRECISION NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  speed DOUBLE PRECISION,
  heading DOUBLE PRECISION,
  destination TEXT,
  callsign TEXT,
  flag TEXT,
  geom GEOGRAPHY(Point, 4326),
  ingested_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_vessel_geom ON vessel_positions USING GIST (geom);
CREATE INDEX idx_vessel_time ON vessel_positions (ingested_at DESC);
CREATE INDEX idx_vessel_mmsi ON vessel_positions (mmsi);

-- ─── Conflict Events (ACLED) ────────────────────────────────
CREATE TABLE IF NOT EXISTS conflict_events (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT UNIQUE,
  event_type TEXT NOT NULL,
  country TEXT,
  longitude DOUBLE PRECISION NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  event_date DATE,
  actor1 TEXT,
  actor2 TEXT,
  fatalities INTEGER DEFAULT 0,
  notes TEXT,
  source TEXT DEFAULT 'ACLED',
  geom GEOGRAPHY(Point, 4326),
  ingested_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_conflict_geom ON conflict_events USING GIST (geom);
CREATE INDEX idx_conflict_date ON conflict_events (event_date DESC);
CREATE INDEX idx_conflict_country ON conflict_events (country);

-- ─── Infrastructure (Static: Power Plants, Pipelines, etc.) ─
CREATE TABLE IF NOT EXISTS infrastructure_static (
  id BIGSERIAL PRIMARY KEY,
  source_id TEXT,
  name TEXT NOT NULL,
  infra_type TEXT NOT NULL, -- power_plant, pipeline, refinery, port, airport, rail, mine
  sub_type TEXT,            -- fuel type, mineral, etc.
  longitude DOUBLE PRECISION NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  country TEXT,
  capacity TEXT,            -- MW, bbl/day, etc.
  status TEXT,              -- operating, construction, planned, retired
  owner TEXT,
  metadata JSONB DEFAULT '{}',
  geom GEOGRAPHY(Point, 4326),
  ingested_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_infra_geom ON infrastructure_static USING GIST (geom);
CREATE INDEX idx_infra_type ON infrastructure_static (infra_type);
CREATE INDEX idx_infra_country ON infrastructure_static (country);

-- ─── Energy Flows (ENTSO-E) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS energy_flows (
  id BIGSERIAL PRIMARY KEY,
  country_code TEXT NOT NULL,
  fuel_type TEXT NOT NULL,
  generation_mw DOUBLE PRECISION,
  timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_energy_time ON energy_flows (timestamp DESC);
CREATE INDEX idx_energy_country ON energy_flows (country_code);

-- ─── Weather Grid ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS weather_grid (
  id BIGSERIAL PRIMARY KEY,
  longitude DOUBLE PRECISION NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  temperature DOUBLE PRECISION,
  wind_speed DOUBLE PRECISION,
  wind_direction DOUBLE PRECISION,
  precipitation DOUBLE PRECISION,
  weather_code INTEGER,
  geom GEOGRAPHY(Point, 4326),
  ingested_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_weather_geom ON weather_grid USING GIST (geom);

-- ─── User Profiles (extends Supabase Auth) ──────────────────
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  notification_preferences JSONB DEFAULT '{"email_enabled": true, "push_enabled": false, "digest_frequency": "daily"}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ─── Watchlists ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS watchlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('region', 'entity', 'topic')),
  config JSONB NOT NULL DEFAULT '{}',
  alert_enabled BOOLEAN DEFAULT TRUE,
  alert_channels TEXT[] DEFAULT ARRAY['in_app'],
  alert_frequency TEXT DEFAULT 'daily' CHECK (alert_frequency IN ('realtime', 'hourly', 'daily')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_watchlist_user ON watchlists (user_id);

-- ─── Agent Reports ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  title TEXT NOT NULL,
  summary TEXT,
  narrative TEXT,
  entities JSONB DEFAULT '[]',
  sources TEXT[] DEFAULT '{}',
  bounding_box JSONB,
  user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reports_domain ON agent_reports (domain);
CREATE INDEX idx_reports_severity ON agent_reports (severity);
CREATE INDEX idx_reports_time ON agent_reports (created_at DESC);
CREATE INDEX idx_reports_user ON agent_reports (user_id);

-- ─── Anomaly Flags ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS anomaly_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  domain TEXT NOT NULL,
  flag_type TEXT NOT NULL,
  severity TEXT DEFAULT 'low' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  payload JSONB DEFAULT '{}',
  processed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_flags_processed ON anomaly_flags (processed, created_at DESC);
CREATE INDEX idx_flags_domain ON anomaly_flags (domain);

-- ─── Notification Queue ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'web_push', 'in_app')),
  title TEXT NOT NULL,
  body TEXT,
  payload JSONB DEFAULT '{}',
  sent BOOLEAN DEFAULT FALSE,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notification_queue (user_id, sent, created_at DESC);

-- ─── Agent Execution Log ────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_execution_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_type TEXT NOT NULL, -- supervisor, air_traffic, maritime, etc.
  action TEXT NOT NULL,     -- heartbeat, dispatch, report, error
  payload JSONB DEFAULT '{}',
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agent_log_time ON agent_execution_log (created_at DESC);
CREATE INDEX idx_agent_log_type ON agent_execution_log (agent_type);

-- ─── Row-Level Security ─────────────────────────────────────
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_queue ENABLE ROW LEVEL SECURITY;

-- Users can only read/write their own profile
CREATE POLICY "Users manage own profile" ON user_profiles
  FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Users can only manage their own watchlists
CREATE POLICY "Users manage own watchlists" ON watchlists
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Users can only see their own notifications
CREATE POLICY "Users see own notifications" ON notification_queue
  FOR SELECT USING (auth.uid() = user_id);

-- Agent reports: users see their own + global (user_id IS NULL)
CREATE POLICY "Users see own and global reports" ON agent_reports
  FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);

-- Public read access to geospatial data tables (no auth required for map data)
ALTER TABLE aircraft_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vessel_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE conflict_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE infrastructure_static ENABLE ROW LEVEL SECURITY;
ALTER TABLE weather_grid ENABLE ROW LEVEL SECURITY;
ALTER TABLE energy_flows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read aircraft" ON aircraft_positions FOR SELECT USING (true);
CREATE POLICY "Public read vessels" ON vessel_positions FOR SELECT USING (true);
CREATE POLICY "Public read conflicts" ON conflict_events FOR SELECT USING (true);
CREATE POLICY "Public read infrastructure" ON infrastructure_static FOR SELECT USING (true);
CREATE POLICY "Public read weather" ON weather_grid FOR SELECT USING (true);
CREATE POLICY "Public read energy" ON energy_flows FOR SELECT USING (true);

-- Service role can write to all tables (used by n8n / API routes)
-- (Service role bypasses RLS by default in Supabase)

-- ─── Helper: Auto-populate geom column from lat/lon ─────────
CREATE OR REPLACE FUNCTION set_geom_from_latlon()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.longitude IS NOT NULL AND NEW.latitude IS NOT NULL THEN
    NEW.geom := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auto_geom_aircraft BEFORE INSERT OR UPDATE ON aircraft_positions
  FOR EACH ROW EXECUTE FUNCTION set_geom_from_latlon();
CREATE TRIGGER auto_geom_vessels BEFORE INSERT OR UPDATE ON vessel_positions
  FOR EACH ROW EXECUTE FUNCTION set_geom_from_latlon();
CREATE TRIGGER auto_geom_conflicts BEFORE INSERT OR UPDATE ON conflict_events
  FOR EACH ROW EXECUTE FUNCTION set_geom_from_latlon();
CREATE TRIGGER auto_geom_infra BEFORE INSERT OR UPDATE ON infrastructure_static
  FOR EACH ROW EXECUTE FUNCTION set_geom_from_latlon();
CREATE TRIGGER auto_geom_weather BEFORE INSERT OR UPDATE ON weather_grid
  FOR EACH ROW EXECUTE FUNCTION set_geom_from_latlon();

-- ─── Realtime: enable for live map layers ───────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE aircraft_positions;
ALTER PUBLICATION supabase_realtime ADD TABLE vessel_positions;
ALTER PUBLICATION supabase_realtime ADD TABLE conflict_events;
ALTER PUBLICATION supabase_realtime ADD TABLE agent_reports;
ALTER PUBLICATION supabase_realtime ADD TABLE notification_queue;
