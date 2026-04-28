// ─── GeoJSON Canonical Types ───
export interface EykonFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [lon, lat]
  };
  properties: Record<string, any> & {
    source_id: string;
    data_tier: 'STATIC' | 'DYNAMIC';
    domain_category: string;
    ingested_at: string;
  };
}

// ─── Aircraft ───
export interface Aircraft {
  icao24: string;
  callsign: string;
  longitude: number;
  latitude: number;
  altitude: number; // meters
  velocity: number; // m/s
  heading: number;
  on_ground: boolean;
  country: string;
  squawk?: string;
  last_seen: string;
}

// ─── Vessel ───
export interface Vessel {
  mmsi: string;
  name: string;
  type: number;
  longitude: number;
  latitude: number;
  speed: number; // knots
  heading: number;
  destination: string;
  callsign: string;
  flag?: string;
  last_seen: string;
}

// ─── Conflict Event ───
export interface ConflictEvent {
  event_id: string;
  event_type: string;
  country: string;
  longitude: number;
  latitude: number;
  event_date: string;
  actor1: string;
  actor2: string;
  fatalities: number;
  notes: string;
  source: string;
}

// ─── Energy / Power Plant ───
export interface PowerPlant {
  id: string;
  name: string;
  longitude: number;
  latitude: number;
  country: string;
  fuel_type: string;
  capacity_mw: number;
  status: string;
  owner: string;
}

// ─── Weather Grid Point ───
export interface WeatherPoint {
  longitude: number;
  latitude: number;
  temperature: number;
  wind_speed: number;
  wind_direction: number;
  precipitation: number;
}

// ─── Agent Report ───
export interface AgentReport {
  id: string;
  domain: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  summary: string;
  narrative: string;
  entities: { type: string; id: string; name: string }[];
  sources: string[];
  bounding_box?: { lat_min: number; lat_max: number; lon_min: number; lon_max: number };
  created_at: string;
  user_id?: string;
}

// ─── Watchlist ───
export interface WatchlistItem {
  id: string;
  user_id: string;
  name: string;
  type: 'region' | 'entity' | 'topic';
  config: {
    // region
    bounding_box?: { lat_min: number; lat_max: number; lon_min: number; lon_max: number };
    // entity
    entity_type?: 'vessel' | 'aircraft' | 'facility';
    entity_id?: string;
    // topic
    keywords?: string[];
  };
  alert_enabled: boolean;
  alert_channels: ('email' | 'web_push' | 'in_app')[];
  alert_frequency: 'realtime' | 'hourly' | 'daily';
  created_at: string;
}

// ─── Anomaly Flag ───
export interface AnomalyFlag {
  id: string;
  source: string;
  domain: string;
  flag_type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  payload: Record<string, any>;
  processed: boolean;
  created_at: string;
}

// ─── Per-data-source fetch state ───
// One per /api/* route the globe consumes (aircraft, vessels, conflicts,
// infrastructure). Sub-layer visibility is held separately so a single fetch
// can back multiple sub-layer cards (e.g. infrastructure → 6 sub-layers).
export interface LayerState {
  loading: boolean;
  error: string | null;
  count: number;
  lastFetch: string | null;
}

// ─── Layer hierarchy ───
export type SubLayerStatus = 'live' | 'planned';

export interface SubLayerDef {
  key: string;                // e.g. 'aircraft.civilian'
  label: string;
  status: SubLayerStatus;
  dataKey?: 'aircraft' | 'vessels' | 'conflicts' | 'infrastructure' | 'airports' | 'ports';
  predicate?: (item: any) => boolean;
  comingSoon?: string;        // tooltip text for `planned` sub-layers
}

export interface CategoryDef {
  key: string;                // e.g. 'aircraft', 'conflicts-crisis'
  label: string;
  color: string;              // CSS variable
  icon: string;
  sublayers: SubLayerDef[];
}

// ─── Map Viewport BBox ───
// Emitted by MapView (debounced) and consumed by the page-level fetch loop
// to scope `/api/*` calls to what's actually on screen. `zoom` is included
// for layers that thin themselves at low zoom (e.g. airports/ports show only
// the biggest tier when the whole world is visible).
export interface BBox {
  latmin: number;
  latmax: number;
  lonmin: number;
  lonmax: number;
  zoom?: number;
}

// ─── Chat Message ───
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tool_calls?: any[];
  created_at: string;
}

// ─── User Profile ───
export interface UserProfile {
  id: string;
  email: string;
  display_name: string;
  avatar_url?: string;
  notification_preferences: {
    email_enabled: boolean;
    push_enabled: boolean;
    digest_frequency: 'realtime' | 'hourly' | 'daily';
  };
  created_at: string;
}
