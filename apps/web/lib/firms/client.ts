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

  // ─── Asia + North America (added 2026-07-18) ─────────────────
  //
  // Coverage before these five boxes was 1,817 of 13,262 monitored
  // facilities — 13.7%. Every facility outside a box has no data at
  // all (085 makes that honest rather than a false zero), so the
  // globe showed China, India, Japan and the US as empty because
  // nobody was looking, not because nothing was burning.
  //
  // With these, coverage is 10,556 / 13,262 = 79.6%.
  //
  // Boxes are split for SHARDING, not for geography: each is a
  // separate `?region=` target so one heavy region cannot starve the
  // others inside the client's 110s curl budget. Sizes are chosen
  // from the actual facility distribution (counts measured against
  // production 2026-07-18), not drawn around countries.
  //
  // Volume note: asia-south and asia-southeast cover the world's
  // heaviest agricultural-burning belts, which is precisely the
  // noise the founder scoped OUT. The ingest-side proximity filter
  // (086, 8 km) is what makes them affordable — on the existing
  // three regions it already discards ~91% of detections before
  // they reach the analytical pipeline. Expect these two shards to
  // fetch large and retain little; that is the design working, not
  // a fault. Watch them for a week before adding the remaining gaps
  // (South America, Africa, Oceania — ~2,700 facilities).

  // China, Korea, Japan, Taiwan — 4,471 facilities, the single
  // largest gap and the one that unlocks the SEA/CN prospect cell.
  { slug: 'asia-east', label: 'East Asia', bbox: { west: 100, south: 18, east: 146, north: 46 } },

  // India, Pakistan, Bangladesh, Sri Lanka — 1,817 facilities.
  // Heaviest crop-burning belt on Earth in Oct-Nov and Apr-May.
  { slug: 'asia-south', label: 'South Asia', bbox: { west: 60, south: 5, east: 100, north: 37 } },

  // Mainland SE Asia + maritime SE Asia — 828 facilities. Overlaps
  // asia-east slightly; harmless, the detection upsert is keyed on
  // (satellite, acq_date, acq_time, lat, lon) and is idempotent.
  { slug: 'asia-southeast', label: 'Southeast Asia', bbox: { west: 95, south: -11, east: 142, north: 20 } },

  // US Gulf Coast, Midwest, Eastern Canada — 1,307 facilities,
  // including the Gulf Coast refining complex.
  { slug: 'na-east', label: 'North America (east)', bbox: { west: -100, south: 24, east: -52, north: 55 } },

  // US West, Rockies, Western Canada — 443 facilities. Lowest
  // facility density of the five, but high wildfire season volume;
  // a good early test of whether the proximity filter holds up.
  { slug: 'na-west', label: 'North America (west)', bbox: { west: -130, south: 25, east: -100, north: 55 } },
];

/**
 * Resolve a `?region=` shard selector to the regions it names.
 *
 * Accepts a comma-separated list of slugs. Empty/absent selects
 * EVERY region, which is what keeps the existing Railway cron command
 * (`curl ... /api/cron/ingest-firms`, no query string) behaving
 * exactly as before.
 *
 * Unknown slugs are returned in `unknown` rather than ignored. A typo
 * in a Railway cron command must fail loudly — silently ingesting
 * nothing would write a green run record for a region nobody is
 * actually covering, which is the same class of lie the coverage
 * ledger exists to prevent.
 */
export function resolveFirmsRegions(param: string | null | undefined): {
  regions: FirmsRegion[];
  unknown: string[];
} {
  const raw = (param ?? '').trim();
  if (!raw) return { regions: FIRMS_REGIONS, unknown: [] };

  const wanted = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const bySlug = new Map(FIRMS_REGIONS.map((r) => [r.slug, r]));
  const regions: FirmsRegion[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();

  for (const slug of wanted) {
    const region = bySlug.get(slug);
    if (!region) {
      unknown.push(slug);
    } else if (!seen.has(slug)) {
      seen.add(slug);
      regions.push(region);
    }
  }
  return { regions, unknown };
}

/**
 * The bboxes as passed to SQL. TypeScript stays the single source of
 * truth (same contract as 084/085) — widening FIRMS_REGIONS widens
 * coverage with no migration.
 */
export function firmsRegionsAsJsonb(regions: FirmsRegion[] = FIRMS_REGIONS): FirmsBbox[] {
  return regions.map((r) => r.bbox);
}

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
