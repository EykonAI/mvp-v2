// NASA FIRMS (Fire Information for Resource Management System) client.
//
// Free API — register a map key at:
//   https://firms.modaps.eosdis.nasa.gov/api/map_key/
// Env var: FIRMS_MAP_KEY
//
// We use the CSV "area" endpoint, which returns active-fire detections
// inside a bounding box for a day range:
//
//   /api/area/csv/<MAP_KEY>/<SOURCE>/<west,south,east,north>/<days>/<start>
//
// NRT latency is ~3h. FIRMS caps `days` at 10 per request.
//
// HONESTY NOTE: a detection is a thermal anomaly — a hot pixel. It is
// NOT a confirmed fire, and certainly not a confirmed strike. Cloud
// cover and overpass timing mean a missed detection does not imply
// absence. Callers must preserve that distinction in user-facing text.

const FIRMS_BASE = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';

// NRT products. VIIRS 375m is the primary (finer resolution, better
// small-fire detection); MODIS 1km is kept as a cross-check source.
export const FIRMS_SOURCES = [
  'VIIRS_SNPP_NRT',
  'VIIRS_NOAA20_NRT',
  'MODIS_NRT',
] as const;
export type FirmsSource = (typeof FIRMS_SOURCES)[number];

export const FIRMS_MAX_DAYS = 10;

export interface FirmsBbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

// Regions of interest. Deliberately scoped rather than global: the
// facility rollup only monitors these, and a smaller box keeps each
// request well inside FIRMS' response limits.
export interface FirmsRegion {
  slug: string;
  label: string;
  bbox: FirmsBbox;
}

export const FIRMS_REGIONS: FirmsRegion[] = [
  // Russian/Ukrainian refinery + grid belt — the long-range-strike beat.
  { slug: 'ru-ua', label: 'Russia / Ukraine', bbox: { west: 22, south: 44, east: 60, north: 62 } },
  // Gulf refining + export complex.
  { slug: 'gulf', label: 'Arabian Gulf', bbox: { west: 44, south: 22, east: 60, north: 34 } },
  // European refining.
  { slug: 'europe', label: 'Europe', bbox: { west: -10, south: 35, east: 22, north: 60 } },
];

export interface FirmsDetection {
  satellite: string;
  acq_date: string;
  acq_time: string;
  latitude: number;
  longitude: number;
  brightness: number | null;
  bright_ti5: number | null;
  frp: number | null;
  confidence: string | null;
  daynight: string | null;
  scan: number | null;
  track: number | null;
}

function num(v: string | undefined): number | null {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse the FIRMS CSV payload.
 *
 * Column order differs between VIIRS and MODIS products, so we index
 * by header name rather than position. Rows missing a usable lat/lon
 * or acquisition date are dropped rather than coerced.
 */
export function parseFirmsCsv(csv: string, source: FirmsSource): FirmsDetection[] {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];

  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);

  const iLat = idx('latitude');
  const iLon = idx('longitude');
  const iDate = idx('acq_date');
  const iTime = idx('acq_time');
  if (iLat < 0 || iLon < 0 || iDate < 0) return [];

  // VIIRS reports bright_ti4/bright_ti5; MODIS reports brightness.
  const iBright = idx('brightness') >= 0 ? idx('brightness') : idx('bright_ti4');
  const iTi5 = idx('bright_ti5');
  const iFrp = idx('frp');
  const iConf = idx('confidence');
  const iDayNight = idx('daynight');
  const iScan = idx('scan');
  const iTrack = idx('track');

  const out: FirmsDetection[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    if (c.length < header.length) continue;

    const lat = num(c[iLat]);
    const lon = num(c[iLon]);
    const date = (c[iDate] ?? '').trim();
    if (lat === null || lon === null || !date) continue;

    out.push({
      satellite: source,
      acq_date: date,
      // FIRMS publishes acq_time as HHMM, sometimes without the
      // leading zero ("45" = 00:45) — pad so the uniqueness key is
      // stable across ingests.
      acq_time: (c[iTime] ?? '').trim().padStart(4, '0') || '0000',
      latitude: lat,
      longitude: lon,
      brightness: iBright >= 0 ? num(c[iBright]) : null,
      bright_ti5: iTi5 >= 0 ? num(c[iTi5]) : null,
      frp: iFrp >= 0 ? num(c[iFrp]) : null,
      confidence: iConf >= 0 ? (c[iConf] ?? '').trim() || null : null,
      daynight: iDayNight >= 0 ? (c[iDayNight] ?? '').trim() || null : null,
      scan: iScan >= 0 ? num(c[iScan]) : null,
      track: iTrack >= 0 ? num(c[iTrack]) : null,
    });
  }
  return out;
}

/**
 * Fetch detections for one region × source over `days` ending today.
 *
 * Throws on transport/HTTP failure so the caller can record the
 * failure in firms_ingest_runs — a silent empty array would be
 * indistinguishable from "no fires", which is exactly the ambiguity
 * the coverage ledger exists to prevent.
 */
export async function fetchFirmsArea(
  mapKey: string,
  source: FirmsSource,
  region: FirmsRegion,
  days: number,
  startDate?: string,
): Promise<FirmsDetection[]> {
  const d = Math.min(Math.max(Math.trunc(days), 1), FIRMS_MAX_DAYS);
  const { west, south, east, north } = region.bbox;
  const area = `${west},${south},${east},${north}`;
  const url =
    `${FIRMS_BASE}/${mapKey}/${source}/${area}/${d}` +
    (startDate ? `/${startDate}` : '');

  const res = await fetch(url, {
    headers: { Accept: 'text/csv' },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`FIRMS ${source}/${region.slug} HTTP ${res.status}`);
  }

  const body = await res.text();
  // FIRMS returns a plain-text error body (HTTP 200) for an invalid or
  // rate-limited key — detect it rather than parsing it as a header row.
  if (/invalid|error|exceeded/i.test(body.slice(0, 120)) && !/latitude/i.test(body.slice(0, 200))) {
    throw new Error(`FIRMS ${source}/${region.slug} rejected: ${body.slice(0, 120).trim()}`);
  }
  return parseFirmsCsv(body, source);
}
