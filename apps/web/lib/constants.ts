// ─── Data Source Configuration ───
export const DATA_SOURCES = {
  ADSB: {
    id: 'adsb',
    name: 'ADS-B Aircraft',
    endpoint: 'https://api.adsb.lol/v2/lat/20/lon/20/dist/25000',
    interval: 15_000, // 15 seconds
    tier: 'DYNAMIC' as const,
    domain: 'Air Traffic',
    color: [255, 210, 0, 220] as [number, number, number, number],
  },
  OPENSKY: {
    id: 'opensky',
    name: 'OpenSky Network',
    endpoint: 'https://opensky-network.org/api/states/all',
    interval: 30_000,
    tier: 'DYNAMIC' as const,
    domain: 'Air Traffic',
    color: [255, 180, 0, 200] as [number, number, number, number],
  },
  AISHUB: {
    id: 'aishub',
    name: 'AIS Vessels',
    endpoint: 'https://data.aishub.net/ws.php',
    interval: 60_000,
    tier: 'DYNAMIC' as const,
    domain: 'Maritime',
    color: [30, 130, 255, 210] as [number, number, number, number],
  },
  ACLED: {
    id: 'acled',
    name: 'ACLED Conflicts',
    endpoint: 'https://api.acleddata.com/acled/read',
    interval: 3_600_000, // 1 hour
    tier: 'DYNAMIC' as const,
    domain: 'Conflict & Security',
    color: [255, 40, 40, 200] as [number, number, number, number],
  },
  ENTSOE: {
    id: 'entsoe',
    name: 'ENTSO-E Power Generation',
    endpoint: 'https://web-api.tp.entsoe.eu/api',
    interval: 300_000, // 5 minutes
    tier: 'DYNAMIC' as const,
    domain: 'Energy & Utilities',
    color: [0, 255, 136, 200] as [number, number, number, number],
  },
  OPEN_METEO: {
    id: 'openmeteo',
    name: 'Open-Meteo Weather',
    endpoint: 'https://api.open-meteo.com/v1/forecast',
    interval: 1_800_000, // 30 minutes
    tier: 'DYNAMIC' as const,
    domain: 'Surveillance & Observation',
    color: [100, 180, 255, 150] as [number, number, number, number],
  },
  GEM: {
    id: 'gem',
    name: 'Global Energy Monitor',
    endpoint: 'https://globalenergymonitor.org/wp-content/uploads/2024/08/Global-Power-Plants-July-2024.geojson',
    interval: 86_400_000, // 24 hours
    tier: 'STATIC' as const,
    domain: 'Energy & Utilities',
    color: [0, 200, 100, 200] as [number, number, number, number],
  },
} as const;

// ─── Map Configuration ───
export const MAP_CONFIG = {
  INITIAL_VIEW: {
    latitude: 25,
    longitude: 30,
    zoom: 2.2,
    pitch: 0,
    bearing: 0,
  },
  GLOBE_VIEW: {
    latitude: 25,
    longitude: 30,
    zoom: 1.5,
    pitch: 0,
    bearing: 0,
  },
  BASEMAP: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
};

// ─── Agent Domains ───
export const AGENT_DOMAINS = [
  'air_traffic',
  'maritime',
  'conflict_security',
  'energy_infrastructure',
  'satellite_imagery',
] as const;

export type AgentDomain = (typeof AGENT_DOMAINS)[number];

// ─── Refresh intervals for client-side polling (ms) ───
export const POLL_INTERVALS = {
  aircraft: 15_000,
  vessels: 60_000,
  conflicts: 300_000,
  energy: 300_000,
  weather: 600_000,
  infrastructure: null, // static, loaded once
};
