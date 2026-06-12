/**
 * eYKON.ai — ADS-B Ingestion Worker (OpenSky Network)
 *
 * Polls the OpenSky Network REST API for live aircraft and upserts the
 * latest position per icao24 into Supabase `aircraft_positions`. The
 * Air DataBucket / geofence RPCs then see live rows and the
 * Notification Center's Air-bucket suggestions self-heal (PR #149).
 *
 * PROVIDER HISTORY: v1 polled adsb.lol (free, no key) — but adsb.lol
 * blocks datacenter/cloud egress IPs (verified 2026-06-12: HTTP 451 /
 * dropped connections from Railway on every request, while the same
 * endpoint returns 200 from a residential IP). It can never work from
 * Railway. OpenSky is the brief's sanctioned free upstream, serves
 * server-side clients officially, and its bbox query covers our BOXES
 * natively (full-region coverage instead of point+radius sampling).
 *
 * AUTH: OAuth2 client-credentials only since 2026-03-18 (basic auth
 * retired). Set OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET on the
 * Railway service. Tokens last ~30 min and are cached/refreshed here.
 *
 * CREDIT BUDGET (free tier = 4,000 credits/day, resets daily):
 * cost per /states/all bbox query is area-tiered —
 *   ≤25 deg² → 1 · ≤100 → 2 · ≤400 → 3 · >400 → 4
 * Our cycle: 4 regional boxes (all >400 deg²) = 16 credits + six
 * chokepoints (16, 9, 18, 1, 48→2, 4 deg²) = 7 credits ⇒ ~23
 * credits/cycle. Default cadence 10 min ⇒ 144 cycles/day ⇒ ~3,312
 * credits — inside budget with margin. A 60s cadence would burn ~33k/
 * day: do NOT lower POLL_INTERVAL_MS below ~480s without re-doing this
 * arithmetic. On HTTP 429 the remaining boxes of the cycle are skipped
 * (further calls would also 429 and waste nothing).
 *
 * UNITS: OpenSky reports metric (baro_altitude m, velocity m/s); the
 * adsb.lol era stored feet/knots and downstream consumers assume that,
 * so we convert at ingest to keep row semantics unchanged.
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
const OPENSKY_CLIENT_ID = process.env.OPENSKY_CLIENT_ID;
const OPENSKY_CLIENT_SECRET = process.env.OPENSKY_CLIENT_SECRET;

const OPENSKY_TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const OPENSKY_STATES_URL = 'https://opensky-network.org/api/states/all';

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 600_000; // 10 min — see credit budget above
const REQUEST_SPACING_MS = Number(process.env.REQUEST_SPACING_MS) || 1_000;
const FETCH_TIMEOUT_MS = 20_000;
const BATCH_SIZE = 500; // rows per upsert call

const M_TO_FT = 3.28084;
const MS_TO_KT = 1.94384;

// ─── Poll regions ──────────────────────────────────────────────
// Same 4 broad regions + 6 chokepoints as services/ais-ingest
// (PR #143). OpenSky /states/all takes a bbox directly (lamin/lomin/
// lamax/lomax), so unlike the adsb.lol point+radius API these boxes
// are covered in FULL — no centre-sampling.
const BOXES = [
  // Broad regions (cost 4 credits each)
  { label: 'Europe + Mediterranean', lat_min: 30,   lat_max: 70,   lon_min: -15,  lon_max: 45 },
  { label: 'Americas Atlantic',      lat_min: -10,  lat_max: 60,   lon_min: -90,  lon_max: -30 },
  { label: 'Africa + Indian Ocean',  lat_min: -40,  lat_max: 40,   lon_min: 10,   lon_max: 60 },
  { label: 'Asia-Pacific',           lat_min: -15,  lat_max: 50,   lon_min: 90,   lon_max: 180 },
  // Chokepoints (cost 1–2 credits each)
  { label: 'Strait of Hormuz',       lat_min: 24,   lat_max: 28,   lon_min: 54,   lon_max: 58 },
  { label: 'Bab-el-Mandeb',          lat_min: 11,   lat_max: 14,   lon_min: 42,   lon_max: 45 },
  { label: 'Suez Canal',             lat_min: 27,   lat_max: 33,   lon_min: 31,   lon_max: 34 },
  { label: 'Bosphorus',              lat_min: 40.5, lat_max: 41.5, lon_min: 28.5, lon_max: 29.5 },
  { label: 'Strait of Malacca',      lat_min: 1,    lat_max: 7,    lon_min: 97,   lon_max: 105 },
  { label: 'Panama Canal',           lat_min: 8,    lat_max: 10,   lon_min: -81,  lon_max: -79 },
];

if (!SUPABASE_URL) { console.error('NEXT_PUBLIC_SUPABASE_URL missing'); process.exit(1); }
if (!SUPABASE_KEY) { console.error('SUPABASE_SERVICE_ROLE_KEY missing'); process.exit(1); }
if (!OPENSKY_CLIENT_ID || !OPENSKY_CLIENT_SECRET) {
  console.error(
    'OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET missing — create an API client at opensky-network.org and set both on this Railway service',
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── OAuth2 token cache ────────────────────────────────────────
let cachedToken = null; // { value: string, expiresAtMs: number }

async function getToken() {
  if (cachedToken && Date.now() < cachedToken.expiresAtMs - 60_000) {
    return cachedToken.value;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(OPENSKY_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: OPENSKY_CLIENT_ID,
        client_secret: OPENSKY_CLIENT_SECRET,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`token HTTP ${res.status}`);
    const json = await res.json();
    if (!json.access_token) throw new Error('token response missing access_token');
    cachedToken = {
      value: json.access_token,
      expiresAtMs: Date.now() + (Number(json.expires_in) || 1800) * 1000,
    };
    return cachedToken.value;
  } finally {
    clearTimeout(timer);
  }
}

// ─── OpenSky state vector → aircraft_positions row ─────────────
// /states/all returns { time, states: [[...17 cols...]] | null }.
// Indices per the OpenSky REST docs:
//   0 icao24 · 1 callsign · 2 origin_country · 5 longitude ·
//   6 latitude · 7 baro_altitude(m) · 8 on_ground · 9 velocity(m/s) ·
//   10 true_track(deg) · 14 squawk
// `country` now carries OpenSky's origin_country (a real country
// name) — an upgrade over the adsb.lol era, which stored the
// registration string (the documented PR #132 caveat).
function toRow(s, nowIso) {
  const icao24 = typeof s[0] === 'string' ? s[0].trim() : '';
  const lon = Number(s[5]);
  const lat = Number(s[6]);
  if (!icao24 || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const onGround = s[8] === true;
  const baroAltM = Number(s[7]);
  const velocityMs = Number(s[9]);
  const track = Number(s[10]);
  return {
    icao24,
    callsign: (typeof s[1] === 'string' ? s[1].trim() : '') || null,
    latitude: lat,
    longitude: lon,
    altitude: onGround ? 0 : (Number.isFinite(baroAltM) ? Math.round(baroAltM * M_TO_FT) : null),
    velocity: Number.isFinite(velocityMs) ? Math.round(velocityMs * MS_TO_KT * 10) / 10 : null,
    heading: Number.isFinite(track) ? track : null,
    on_ground: onGround,
    country: (typeof s[2] === 'string' ? s[2].trim() : '') || null,
    squawk: (typeof s[14] === 'string' ? s[14].trim() : '') || null,
    ingested_at: nowIso, // refresh recency on every upsert so feed-health sees Air as hot
  };
}

class RateLimitedError extends Error {}

async function fetchBox(box) {
  const token = await getToken();
  const params = new URLSearchParams({
    lamin: String(box.lat_min),
    lomin: String(box.lon_min),
    lamax: String(box.lat_max),
    lomax: String(box.lon_max),
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${OPENSKY_STATES_URL}?${params}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });
    if (res.status === 401) {
      cachedToken = null; // token revoked/expired early — re-auth on next call
      throw new Error('HTTP 401 (token invalidated, will re-auth)');
    }
    if (res.status === 429) throw new RateLimitedError('HTTP 429 (daily credits exhausted)');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return Array.isArray(json.states) ? json.states : [];
  } finally {
    clearTimeout(timer);
  }
}

// ─── One poll cycle ────────────────────────────────────────────
async function cycle() {
  const startedAt = Date.now();
  const nowIso = new Date().toISOString();
  const byIcao = new Map(); // dedupe across overlapping boxes; last write wins
  const perBox = [];

  for (const box of BOXES) {
    try {
      const states = await fetchBox(box);
      let kept = 0;
      for (const s of states) {
        const row = toRow(s, nowIso);
        if (row) { byIcao.set(row.icao24, row); kept++; }
      }
      perBox.push(`${box.label}=${kept}`);
    } catch (err) {
      perBox.push(`${box.label}=ERR(${err.message})`);
      if (err instanceof RateLimitedError) {
        perBox.push('(skipping rest of cycle — credit budget exhausted until daily reset)');
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
    `distinct=${rows.length} upsert=${upserted} err=${errored} | ${perBox.join(' ')}`,
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

console.log('eYKON ADS-B ingest starting… (provider: OpenSky Network, OAuth2)');
console.log(
  `  ${BOXES.length} bboxes (4 regional + 6 chokepoints), cycle every ${POLL_INTERVAL_MS / 1000}s (~23 credits/cycle vs 4k/day budget)`,
);
console.log('  ' + BOXES.map((b) => b.label).join(', '));
loop();

process.on('SIGTERM', () => {
  console.log('SIGTERM — stopping after current cycle…');
  stopped = true;
  setTimeout(() => process.exit(0), 1_000);
});
