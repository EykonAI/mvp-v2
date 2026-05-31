/**
 * eYKON.ai — ADS-B Ingestion Worker
 *
 * Polls adsb.lol (free, no key) for live aircraft and upserts the
 * latest position per icao24 into Supabase `aircraft_positions`. The
 * Air DataBucket / geofence RPCs then see live rows and the
 * Notification Center's Air-bucket suggestions self-heal (PR #149).
 *
 * Sibling of services/ais-ingest (vessels). That worker streams from a
 * WebSocket; adsb.lol is a REST API, so this one POLLs the same set of
 * regions/chokepoints on an interval instead. Runs as a standalone
 * Railway service.
 *
 * geom is set by the auto_geom_aircraft trigger (migration 001) from
 * lat/lon — we only write the scalar columns. icao24 upsert relies on
 * the UNIQUE constraint added in migration 044.
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');

// ─── Config ────────────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ADSB_BASE        = 'https://api.adsb.lol/v2';
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 60_000; // full cycle cadence
const REQUEST_SPACING_MS = Number(process.env.REQUEST_SPACING_MS) || 1_000; // gap between point requests (adsb.lol ~1 req/s)
const FETCH_TIMEOUT_MS = 15_000;
const BATCH_SIZE       = 500;            // rows per upsert call
const MIN_DIST_NM      = 50;             // floor so chokepoint boxes still catch approaching traffic
const MAX_DIST_NM      = 250;            // adsb.lol radius cap

// ─── Poll regions ──────────────────────────────────────────────
// Same 4 broad regions + 6 chokepoints as services/ais-ingest
// (PR #143). adsb.lol queries are point+radius, not bbox, so each box
// becomes its centre point and a radius that covers it (capped at
// MAX_DIST_NM). The broad regions are larger than the cap, so they are
// sampled at their centre — partial coverage, easy to extend by adding
// more points later. The six chokepoints are small enough to be fully
// covered and are the priority (Hormuz must not be starved).
const BOXES = [
  // Broad regions
  { label: 'Europe + Mediterranean', lat_min: 30,   lat_max: 70,   lon_min: -15,  lon_max: 45 },
  { label: 'Americas Atlantic',      lat_min: -10,  lat_max: 60,   lon_min: -90,  lon_max: -30 },
  { label: 'Africa + Indian Ocean',  lat_min: -40,  lat_max: 40,   lon_min: 10,   lon_max: 60 },
  { label: 'Asia-Pacific',           lat_min: -15,  lat_max: 50,   lon_min: 90,   lon_max: 180 },
  // Chokepoints
  { label: 'Strait of Hormuz',       lat_min: 24,   lat_max: 28,   lon_min: 54,   lon_max: 58 },
  { label: 'Bab-el-Mandeb',          lat_min: 11,   lat_max: 14,   lon_min: 42,   lon_max: 45 },
  { label: 'Suez Canal',             lat_min: 27,   lat_max: 33,   lon_min: 31,   lon_max: 34 },
  { label: 'Bosphorus',              lat_min: 40.5, lat_max: 41.5, lon_min: 28.5, lon_max: 29.5 },
  { label: 'Strait of Malacca',      lat_min: 1,    lat_max: 7,    lon_min: 97,   lon_max: 105 },
  { label: 'Panama Canal',           lat_min: 8,    lat_max: 10,   lon_min: -81,  lon_max: -79 },
];

function toPollPoint(box) {
  const lat = (box.lat_min + box.lat_max) / 2;
  const lon = (box.lon_min + box.lon_max) / 2;
  const dLatNm = (box.lat_max - box.lat_min) * 60;
  const dLonNm = (box.lon_max - box.lon_min) * 60 * Math.cos((lat * Math.PI) / 180);
  const halfDiagNm = 0.5 * Math.sqrt(dLatNm * dLatNm + dLonNm * dLonNm);
  const dist = Math.min(MAX_DIST_NM, Math.max(MIN_DIST_NM, Math.round(halfDiagNm)));
  return { label: box.label, lat: Number(lat.toFixed(4)), lon: Number(lon.toFixed(4)), dist };
}

const POLL_POINTS = BOXES.map(toPollPoint);

if (!SUPABASE_URL) { console.error('NEXT_PUBLIC_SUPABASE_URL missing'); process.exit(1); }
if (!SUPABASE_KEY) { console.error('SUPABASE_SERVICE_ROLE_KEY missing'); process.exit(1); }

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── adsb.lol → aircraft_positions row ─────────────────────────
// Field mapping mirrors apps/web/app/api/aircraft/route.ts so the
// ingested rows match what the live proxy already serves the Globe.
// `country` carries adsb.lol's registration string `r` — the
// documented Air registration-country caveat (PR #132), not a true
// origin country.
function toRow(a, nowIso) {
  const lat = Number(a.lat);
  const lon = Number(a.lon);
  if (!a.hex || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const onGround = a.alt_baro === 'ground';
  const altitude = onGround ? 0 : (Number.isFinite(Number(a.alt_baro)) ? Number(a.alt_baro) : null);
  return {
    icao24: String(a.hex),
    callsign: (a.flight || '').trim() || null,
    latitude: lat,
    longitude: lon,
    altitude,
    velocity: Number.isFinite(Number(a.gs)) ? Number(a.gs) : null,
    heading: Number.isFinite(Number(a.track)) ? Number(a.track) : null,
    on_ground: onGround,
    country: a.r || null,
    squawk: a.squawk || null,
    ingested_at: nowIso, // refresh recency on every upsert so feed-health sees Air as hot
  };
}

async function fetchPoint(pt) {
  const url = `${ADSB_BASE}/lat/${pt.lat}/lon/${pt.lon}/dist/${pt.dist}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json.ac || json.aircraft || [];
  } finally {
    clearTimeout(timer);
  }
}

// ─── One poll cycle ────────────────────────────────────────────
async function cycle() {
  const startedAt = Date.now();
  const nowIso = new Date().toISOString();
  const byIcao = new Map(); // dedupe across overlapping boxes; last write wins
  const perPoint = [];

  for (const pt of POLL_POINTS) {
    try {
      const aircraft = await fetchPoint(pt);
      let kept = 0;
      for (const a of aircraft) {
        const row = toRow(a, nowIso);
        if (row) { byIcao.set(row.icao24, row); kept++; }
      }
      perPoint.push(`${pt.label}=${kept}`);
    } catch (err) {
      perPoint.push(`${pt.label}=ERR(${err.message})`);
    }
    if (REQUEST_SPACING_MS > 0) await sleep(REQUEST_SPACING_MS);
  }

  const rows = Array.from(byIcao.values());
  let upserted = 0;
  let errored = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('aircraft_positions')
      .upsert(chunk, { onConflict: 'icao24', ignoreDuplicates: false });
    if (error) { errored += chunk.length; console.error('upsert error:', error.message); }
    else       { upserted += chunk.length; }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[${new Date().toISOString()}] cycle ${elapsed}s ` +
    `distinct=${rows.length} upsert=${upserted} err=${errored} | ${perPoint.join(' ')}`,
  );
}

// ─── Boot — self-scheduling loop (no overlap) ──────────────────
let stopped = false;

async function loop() {
  while (!stopped) {
    const started = Date.now();
    try {
      await cycle();
    } catch (err) {
      console.error('cycle threw:', err.message);
    }
    const wait = Math.max(0, POLL_INTERVAL_MS - (Date.now() - started));
    if (wait > 0) await sleep(wait);
  }
}

console.log('eYKON ADS-B ingest starting…');
console.log(`  ${POLL_POINTS.length} points (4 regional + 6 chokepoints), cycle every ${POLL_INTERVAL_MS / 1000}s`);
console.log('  ' + POLL_POINTS.map((p) => `${p.label}@${p.dist}nm`).join(', '));
loop();

process.on('SIGTERM', () => {
  console.log('SIGTERM — stopping after current cycle…');
  stopped = true;
  setTimeout(() => process.exit(0), 1_000);
});
