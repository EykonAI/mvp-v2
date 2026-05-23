// Weather bucket on-demand fetcher (PR 8).
//
// Brief §6.4: "Weather bucket: on-demand Open-Meteo fetch when the
// rule's geo_filter resolves to a lat/lon. Cache 1h in memory. Add
// to the events block as `[Weather] {region}: {summary}` lines so
// cross-data rules with Weather work."
//
// REGION_CENTROIDS hardcodes the centroid of each polygon seeded in
// migration 042 — same bounding boxes, just averaged. Keeping
// centroids in TS (rather than a SQL function) saves one round-trip
// per Weather-rule evaluation; if the polygons are ever re-traced to
// non-rectangular shapes a follow-up PR can replace this map with a
// supabase.rpc('region_centroid') call.
//
// Cache is process-level (Map<slug, { fetchedAt, summary }>) with a
// 1h TTL. Inside a single AI-cron tick processing N rules all
// asking for Weather over Hormuz, this collapses N fetches to 1.
// Across ticks the cache may go cold (serverless instance reuse is
// best-effort), but Open-Meteo's free tier allows 10k calls/day —
// well under what a 1h/rule cap can drive.

interface RegionCentroid {
  lat: number;
  lon: number;
}

/** Centroids match the bounding-box midpoints from migration 042. */
export const REGION_CENTROIDS: ReadonlyMap<string, RegionCentroid> = new Map([
  // Countries
  ['MA', { lat: 28.5, lon:  -9.0 }],
  ['SA', { lat: 24.0, lon:  45.0 }],
  ['IR', { lat: 32.5, lon:  54.0 }],
  ['IQ', { lat: 33.5, lon:  43.5 }],
  ['AE', { lat: 24.5, lon:  54.0 }],
  ['OM', { lat: 21.5, lon:  56.0 }],
  ['YE', { lat: 15.5, lon:  48.0 }],
  ['EG', { lat: 27.0, lon:  30.5 }],
  ['SD', { lat: 15.5, lon:  30.0 }],
  ['TR', { lat: 39.0, lon:  35.5 }],
  ['UA', { lat: 48.5, lon:  31.5 }],
  ['RU', { lat: 61.5, lon:  99.5 }],
  ['IL', { lat: 31.4, lon:  35.05 }],
  ['LB', { lat: 33.85, lon: 35.85 }],
  ['SY', { lat: 34.8, lon:  38.95 }],
  // Chokepoints (smaller — centroid is more meaningful as a weather
  // sample point than for the wider country envelopes above).
  ['hormuz',        { lat: 26.25, lon:  56.25 }],
  ['suez',          { lat: 30.0,  lon:  32.5  }],
  ['bab-el-mandeb', { lat: 12.75, lon:  43.5  }],
  ['bosphorus',     { lat: 41.15, lon:  29.05 }],
  ['malacca',       { lat:  3.75, lon: 101.0  }],
  ['panama',        { lat:  9.15, lon: -79.7  }],
  // Seas
  ['black-sea',     { lat: 43.5,  lon:  34.5  }],
  ['red-sea',       { lat: 21.0,  lon:  38.0  }],
  ['persian-gulf',  { lat: 27.0,  lon:  52.5  }],
  ['mediterranean', { lat: 38.0,  lon:  15.0  }],
]);

interface CachedWeather {
  fetchedAt: number;
  summary: string | null; // null = previous fetch failed; we won't re-fetch within TTL
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1h
const FETCH_TIMEOUT_MS = 5_000;
const cache: Map<string, CachedWeather> = new Map();

interface OpenMeteoResponse {
  current?: {
    time?: string;
    temperature_2m?: number;
    weather_code?: number;
    wind_speed_10m?: number;
    relative_humidity_2m?: number;
  };
}

/**
 * Map a WMO weather code to a short label. Buckets the 100+ codes
 * into ~10 buckets — enough granularity for Claude to reason about
 * weather as a contextual signal without parsing the raw code.
 */
function describeWmoCode(code: number | undefined): string {
  if (code === undefined || code === null) return 'unknown';
  if (code === 0) return 'clear';
  if (code <= 3) return 'mainly clear / partly cloudy';
  if (code <= 48) return 'fog';
  if (code <= 57) return 'drizzle';
  if (code <= 67) return 'rain';
  if (code <= 77) return 'snow';
  if (code <= 82) return 'rain showers';
  if (code <= 86) return 'snow showers';
  if (code <= 99) return 'thunderstorm';
  return 'unspecified';
}

async function fetchOpenMeteo(lat: number, lon: number): Promise<OpenMeteoResponse | null> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set(
    'current',
    'temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m',
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return (await res.json()) as OpenMeteoResponse;
  } catch {
    // Network error, timeout, JSON parse failure — caller treats as
    // a soft miss and the events block omits Weather for this tick.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Get a one-line weather summary for a region slug. Returns null when
 * the slug is unknown, the fetch fails, or Open-Meteo returns no
 * `current` block. Cached for CACHE_TTL_MS per slug — repeat calls
 * inside the TTL hit memory.
 */
export async function fetchWeatherForRegion(slug: string): Promise<string | null> {
  const centroid = REGION_CENTROIDS.get(slug);
  if (!centroid) return null;

  const hit = cache.get(slug);
  const now = Date.now();
  if (hit && now - hit.fetchedAt < CACHE_TTL_MS) {
    return hit.summary;
  }

  const data = await fetchOpenMeteo(centroid.lat, centroid.lon);
  const cur = data?.current;
  let summary: string | null = null;
  if (cur && typeof cur.temperature_2m === 'number') {
    const temp = cur.temperature_2m.toFixed(1);
    const desc = describeWmoCode(cur.weather_code);
    const wind = typeof cur.wind_speed_10m === 'number' ? cur.wind_speed_10m.toFixed(0) : '?';
    const rh = typeof cur.relative_humidity_2m === 'number' ? cur.relative_humidity_2m.toFixed(0) : '?';
    const ts = typeof cur.time === 'string' ? cur.time : new Date().toISOString();
    summary = `[Weather @${ts}] ${slug}: ${temp}°C, ${desc}, wind ${wind} km/h, RH ${rh}%`;
  }
  cache.set(slug, { fetchedAt: now, summary });
  return summary;
}

/** Test hook — clears the in-memory cache. Not exported for runtime. */
export function _resetWeatherCacheForTests(): void {
  cache.clear();
}
