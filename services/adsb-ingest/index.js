/**
 * eYKON.ai — ADS-B Ingestion Worker (ADSBexchange via RapidAPI)
 *
 * Polls ADSBexchange (RapidAPI) for live aircraft and upserts the
 * latest position per icao24 into Supabase `aircraft_positions`. The
 * Air DataBucket / geofence RPCs then see live rows and the
 * Notification Center's Air-bucket suggestions self-heal (PR #149).
 * /api/aircraft READs that table (PR #180) rather than proxying live,
 * so this worker is the ONLY thing that hits the external API — cost
 * is governed purely by the poll cadence below.
 *
 * PROVIDER HISTORY: adsb.lol (free) and OpenSky (free, OAuth2) were
 * both tried and BOTH are blocked from Railway's datacenter egress —
 * adsb.lol returns HTTP 451, OpenSky's API host drops the SYN
 * (UND_ERR_CONNECT_TIMEOUT), confirmed from Railway EU-West AND
 * US-West (so it's an IP-level block, not a routing fluke). The fix is
 * a server-friendly paid feed: ADSBexchange on RapidAPI (flat fee,
 * answers datacenter clients). Its v2 API is the one adsb.lol cloned,
 * so the response shape ({ ac: [...] }) and field names are identical
 * to the adsb.lol era — the point+radius query (toPollPoint) and field
 * mapping (toRow) below are restored from the pre-#178 worker.
 *
 * AUTH: a static RapidAPI key, no token dance. Subscribe to
 * adsbexchange-com1 (https://rapidapi.com/adsbx/api/adsbexchange-com1/
 * pricing) and set RAPIDAPI_KEY on this Railway service.
 *
 * COST BUDGET (RapidAPI entry tier = $10/mo / 10,000 requests/mo):
 * each cycle costs exactly POLL_POINTS.length (=10) requests — one per
 * poll point. At the default 45-min cadence:
 *   10 points × (1440 ÷ 45 = 32) cycles/day × 30 days ≈ 9,600 req/mo
 * — inside the 10k cap with headroom. Do NOT lower POLL_INTERVAL_MS
 * below ~2_700_000 (45 min) or add poll points without redoing this
 * arithmetic: at the old 10-min cadence the same 10 points would burn
 * ~43,200/mo (4× over budget). On HTTP 429 the remaining points of the
 * cycle are skipped (the monthly quota is already spent).
 *
 * UNITS: ADSBexchange v2 reports ADS-B-native units — alt_baro in feet
 * ('ground' on the deck), gs in knots, track in degrees — which is
 * exactly what downstream consumers expect, so (unlike the OpenSky
 * era) NO unit conversion happens at ingest.
 *
 * MILITARY / TYPE: aircraft_positions has no `type` / `military`
 * column, so — exactly as in the adsb.lol and OpenSky eras — only the
 * scalar columns in toRow are written (ADSBexchange's `t` / `dbFlags`
 * are dropped). /api/aircraft (apps/web/app/api/aircraft/route.ts)
 * returns type:''/military:false; reviving military highlighting needs
 * a migration + a read-path change, not just this worker.
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
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;

const ADSBX_HOST = 'adsbexchange-com1.p.rapidapi.com';
const ADSBX_BASE = `https://${ADSBX_HOST}/v2`;

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 2_700_000; // 45 min — see COST BUDGET above
const REQUEST_SPACING_MS = Number(process.env.REQUEST_SPACING_MS) || 1_000;  // gap between point requests
const FETCH_TIMEOUT_MS = 20_000;
const BATCH_SIZE = 500;   // rows per upsert call
const MIN_DIST_NM = 50;   // floor so chokepoint boxes still catch approaching traffic
const MAX_DIST_NM = 250;  // ADSBexchange radius cap (same as the adsb.lol v2 API it clones)

// ─── Poll regions ──────────────────────────────────────────────
// Same 4 broad regions + 6 chokepoints as services/ais-ingest
// (PR #143). The ADSBexchange v2 API is point+radius (not bbox), so
// each box becomes its centre point and a radius that covers it
// (capped at MAX_DIST_NM). The broad regions are larger than the cap,
// so they are sampled at their centre — partial coverage, easy to
// extend by adding more points later. The six chokepoints are small
// enough to be fully covered and are the priority (Hormuz must not be
// starved).
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

// adsb.lol / ADSBexchange v2 query is point+radius, not bbox: collapse
// each box to its centre and a radius (nm) that covers it, clamped to
// [MIN_DIST_NM, MAX_DIST_NM].
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
if (!RAPIDAPI_KEY) {
  console.error(
    'RAPIDAPI_KEY missing — subscribe to adsbexchange-com1 on RapidAPI and set RAPIDAPI_KEY on this Railway service',
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── ADSBexchange aircraft → aircraft_positions row ────────────
// Field mapping mirrors apps/web/app/api/aircraft/route.ts (the
// adsb.lol proxy branch) so ingested rows match the Globe contract.
// `country` carries the registration string `r` — the documented Air
// registration-country caveat (PR #132), not a true origin country.
// `t` (type) and `dbFlags` (military) are intentionally NOT written:
// aircraft_positions has no column for them (see header).
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

class RateLimitedError extends Error {}

// Node's fetch reports every network-layer failure as the opaque
// "fetch failed" TypeError; the real story (DNS vs connect-timeout vs
// reset) lives in err.cause. Surface it so the Railway logs stay
// actionable — UND_ERR_CONNECT_TIMEOUT = SYNs dropped (IP-level block
// or broken routing), ENOTFOUND/EAI_AGAIN = DNS, ECONNRESET = peer
// closed mid-handshake.
function describeError(err) {
  const code = err?.cause?.code || err?.cause?.name || err?.code || '';
  return code ? `${code}: ${err.message}` : err.message;
}

// One-shot boot diagnostic (kept from the OpenSky-era saga, PR #179):
// log in-container DNS for the ADSBexchange host plus a key-free
// reachability probe to api.github.com as a known-good control. We do
// NOT probe the RapidAPI host here — it requires the paid key and would
// cost a request; the first cycle's `err=` count validates auth and
// reachability for real.
async function bootDiagnostics() {
  const dns = require('node:dns').promises;
  console.log('  network diagnostics:');
  for (const host of [ADSBX_HOST, 'api.github.com']) {
    try {
      const addrs = await dns.lookup(host, { all: true });
      console.log(`    dns ${host} → ${addrs.map((a) => a.address).join(', ')}`);
    } catch (e) {
      console.log(`    dns ${host} → ERR ${e.code || e.message}`);
    }
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch('https://api.github.com', { signal: ctrl.signal });
    console.log(`    probe api.github.com → HTTP ${res.status}`);
    try { await res.body?.cancel(); } catch { /* drained or absent */ }
  } catch (e) {
    console.log(`    probe api.github.com → ERR ${describeError(e)}`);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPoint(pt) {
  const url = `${ADSBX_BASE}/lat/${pt.lat}/lon/${pt.lon}/dist/${pt.dist}/`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'X-RapidAPI-Key': RAPIDAPI_KEY,
        'X-RapidAPI-Host': ADSBX_HOST,
      },
      signal: ctrl.signal,
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `HTTP ${res.status} (RapidAPI key rejected — check RAPIDAPI_KEY and the adsbexchange-com1 subscription)`,
      );
    }
    if (res.status === 429) throw new RateLimitedError('HTTP 429 (monthly request quota exhausted)');
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
  const byIcao = new Map(); // dedupe across overlapping points; last write wins
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
      perPoint.push(`${pt.label}=ERR(${describeError(err)})`);
      if (err instanceof RateLimitedError) {
        perPoint.push('(skipping rest of cycle — monthly request quota exhausted)');
        break;
      }
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

console.log('eYKON ADS-B ingest starting… (provider: ADSBexchange / RapidAPI)');
console.log(
  `  ${POLL_POINTS.length} points (4 regional + 6 chokepoints), cycle every ${POLL_INTERVAL_MS / 1000}s ` +
  `(~${POLL_POINTS.length} req/cycle vs 10k/mo budget)`,
);
console.log('  ' + POLL_POINTS.map((p) => `${p.label}@${p.dist}nm`).join(', '));
bootDiagnostics()
  .catch((e) => console.error('boot diagnostics threw:', describeError(e)))
  .finally(() => loop());

process.on('SIGTERM', () => {
  console.log('SIGTERM — stopping after current cycle…');
  stopped = true;
  setTimeout(() => process.exit(0), 1_000);
});
