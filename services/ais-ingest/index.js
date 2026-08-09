/**
 * eYKON.ai — AIS Ingestion Worker
 *
 * Subscribes to the AISStream.io WebSocket firehose and upserts the
 * latest position per MMSI into Supabase `vessel_positions`. The
 * Next.js `/api/vessels` route then serves the table to the map.
 *
 * Runs as a standalone Railway service. Reconnects with backoff.
 */

'use strict';

const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');

// ─── Config ────────────────────────────────────────────────────
const AIS_KEY      = process.env.AISSTREAM_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Overridable so the reconnect/backoff behaviour can be exercised against a
// local test server, and so a future endpoint change is config, not a deploy.
const STREAM_URL    = process.env.AIS_STREAM_URL || 'wss://stream.aisstream.io/v0/stream';
const FLUSH_MS      = 30_000;          // upsert buffer every 30s
const MAX_BUFFER    = 100_000;         // safety bound
const BATCH_SIZE    = 500;             // rows per upsert call
const RECONNECT_MIN = 1_000;
const RECONNECT_MAX = 60_000;
// No AIS message in this long ⇒ dead stream, force reconnect. Env-tunable for
// the same reason feed-health.ts exposes its thresholds: retuning a liveness
// threshold should not require a deploy.
const STALE_MS      = Number(process.env.AIS_STALE_MS ?? 90_000);

// ─── Storm cap (the 2026-08-05 lesson) ────────────────────────
// Past this many consecutive DRY connection cycles we stop treating the
// problem as a transient blip. Reconnecting every 60s forever is itself
// what keeps an upstream 429 alive, so the floor escalates to minutes.
//   dryStreak 0..6  → 1s, 2s, 4s, 8s, 16s, 32s, 60s   (transient)
//   dryStreak 7..10 → 5m, 10m, 20m, 30m               (refused / starved)
// A single inbound AIS message resets it to zero, so recovery is automatic
// within 30 minutes of the feed coming back.
const DRY_STREAK_CAP    = 6;
const STARVED_FLOOR_MIN = 300_000;     // 5 minutes
const STARVED_FLOOR_MAX = 1_800_000;   // 30 minutes

// ─── Subscription bounding boxes ──────────────────────────────
// AISStream's free-tier rate limit (~155 msg/s globally) means a
// single global box is sampled and biased toward Europe-dense
// receivers — the Persian Gulf and other strategic chokepoints get
// starved (zero Hormuz vessels observed across 24h with a global
// subscription). Switching to explicit regions tells AISStream how
// to allocate the rate budget instead of letting it pick.
//
// Format: [[bottom_left_lat, bottom_left_lon], [top_right_lat, top_right_lon]]
//
// Four broad regions cover all major shipping lanes; the six
// chokepoint boxes guarantee dense coverage for source='ais'
// Calibration Ledger predictions. Polar oceans and open-ocean
// stretches outside the named regions lose coverage — acceptable
// trade-off for a geopolitical-intelligence product, and easy to
// extend later if a new region matters.
const BOUNDING_BOXES = [
  // Broad regions (replace the previous single global box)
  [[30, -15],     [70, 45]],         // Europe + Mediterranean
  [[-10, -90],    [60, -30]],        // Americas Atlantic
  [[-40, 10],     [40, 60]],         // Africa + Indian Ocean rim
  [[-15, 90],     [50, 180]],        // Asia-Pacific

  // PR-CAL chokepoints — guaranteed priority for the Calibration
  // Ledger AIS-anchored predictions. Wider than the geo_regions
  // polygons so vessels approaching/departing are captured before
  // they enter the strait proper.
  [[24, 54],      [28, 58]],         // Strait of Hormuz
  [[11, 42],      [14, 45]],         // Bab-el-Mandeb
  [[27, 31],      [33, 34]],         // Suez Canal
  [[40.5, 28.5],  [41.5, 29.5]],     // Bosphorus
  [[1, 97],       [7, 105]],         // Strait of Malacca
  [[8, -81],      [10, -79]],        // Panama Canal
];

if (!AIS_KEY)      { console.error('AISSTREAM_API_KEY missing');      process.exit(1); }
if (!SUPABASE_URL) { console.error('NEXT_PUBLIC_SUPABASE_URL missing'); process.exit(1); }
if (!SUPABASE_KEY) { console.error('SUPABASE_SERVICE_ROLE_KEY missing'); process.exit(1); }

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ─── In-memory buffer keyed by MMSI ────────────────────────────
// We keep the latest known fields per vessel and flush periodically.
// PositionReport overwrites position fields; ShipStaticData overwrites
// metadata. Both sets are merged on the same MMSI key.
const buffer = new Map();

function upsertBuffer(mmsi, patch) {
  const existing = buffer.get(mmsi) || { mmsi };
  buffer.set(mmsi, { ...existing, ...patch });
  if (buffer.size > MAX_BUFFER) {
    // drop oldest 10% if the consumer is somehow falling behind
    const drop = Math.floor(MAX_BUFFER * 0.1);
    const keys = Array.from(buffer.keys()).slice(0, drop);
    for (const k of keys) buffer.delete(k);
  }
}

// AIS MMSI → flag-state derivation (MID = first 3 digits).
function flagFromMmsi(mmsi) {
  const mid = String(mmsi).slice(0, 3);
  return MID_TO_FLAG[mid] || null;
}

// ─── WebSocket lifecycle ───────────────────────────────────────
let ws;
let messagesIn = 0;
let lastLogged = Date.now();
let lastMessageAt = Date.now();        // liveness: bumped on every inbound AIS message

// A connection that OPENS is not a connection that WORKS. dryStreak counts
// consecutive connection cycles that delivered ZERO AIS messages — whether
// refused at the handshake (429) or opened and then starved. It is the only
// input to the backoff, and only a real inbound message clears it.
let dryStreak = 0;

function backoffMs() {
  let d = Math.min(RECONNECT_MAX, RECONNECT_MIN * 2 ** Math.min(dryStreak, DRY_STREAK_CAP));
  if (dryStreak > DRY_STREAK_CAP) {
    d = Math.max(d, Math.min(
      STARVED_FLOOR_MAX,
      STARVED_FLOOR_MIN * 2 ** (dryStreak - DRY_STREAK_CAP - 1),
    ));
  }
  return d;
}

function connect() {
  console.log(`[${new Date().toISOString()}] connecting to AISStream…`);

  // Per-connection state, deliberately in the closure: a stale socket's late
  // 'close' must never mutate the CURRENT connection's bookkeeping.
  const socket = new WebSocket(STREAM_URL);
  let settled = false;
  let gotData = false;
  ws = socket;

  // Every terminal path funnels here, exactly once per connection.
  const settle = (reason, floorMs = 0) => {
    if (settled) return;
    settled = true;
    if (!gotData) dryStreak++;
    const delay = Math.max(backoffMs(), floorMs);
    console.log(`  ${reason} — dry=${dryStreak}, reconnecting in ${Math.round(delay / 1000)}s`);
    setTimeout(connect, delay);
  };

  socket.on('open', () => {
    console.log(`  open — subscribing ${BOUNDING_BOXES.length} bboxes (4 regional + 6 chokepoints)`);
    // The backoff is deliberately NOT reset here. A completed handshake is
    // not a delivering stream. Resetting on 'open' is exactly what turned the
    // 2026-08-05 starvation into a permanent 1s-reconnect storm: open (reset
    // to 1s) → 90s silence → watchdog kill → reconnect → 429 → … forever.
    // Only an actual message clears the streak; see the 'message' handler.
    lastMessageAt = Date.now();         // grace window for the fresh connection
    socket.send(JSON.stringify({
      APIKey: AIS_KEY,
      BoundingBoxes: BOUNDING_BOXES,
      FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
    }));
  });

  // ws aborts the handshake and emits a bare `error` reading "Unexpected
  // server response: 429" — the status code and nothing else. The real HTTP
  // response carries Retry-After and usually a body saying WHY (quota spent,
  // concurrent connection, key disabled). Handling this event suppresses both
  // that 'error' AND the 'close' that normally drives the reconnect, so this
  // handler owns destroying the request and settling the cycle.
  socket.on('unexpected-response', (req, res) => {
    const retryAfter = res.headers['retry-after'];
    const floorMs = Number.isFinite(Number(retryAfter)) ? Number(retryAfter) * 1_000 : 0;
    let body = '';
    res.on('data', (c) => { if (body.length < 500) body += c.toString(); });
    const finish = (suffix) => {
      console.error(
        `  handshake rejected: HTTP ${res.statusCode} ${res.statusMessage || ''}`.trimEnd() +
        (retryAfter ? ` · retry-after=${retryAfter}` : '') +
        (body.trim() ? ` · body=${JSON.stringify(body.trim().slice(0, 300))}` : ' · empty body') +
        suffix,
      );
      try { req.destroy(); } catch { /* already gone */ }
      settle(`handshake ${res.statusCode}`, floorMs);
    };
    res.on('end', () => finish(''));
    res.on('error', (e) => finish(` · body read failed: ${e.message}`));
  });

  socket.on('message', (raw) => {
    if (!gotData) {
      gotData = true;
      if (dryStreak > 0) console.log(`  stream is live — clearing dry streak (was ${dryStreak})`);
      dryStreak = 0;
    }
    lastMessageAt = Date.now();
    messagesIn++;
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    const meta = msg.MetaData || {};
    const mmsi = String(meta.MMSI || '');
    if (!mmsi) return;

    if (msg.MessageType === 'PositionReport') {
      const p = msg.Message?.PositionReport;
      if (!p) return;
      const lat = Number(meta.latitude  ?? p.Latitude);
      const lon = Number(meta.longitude ?? p.Longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      upsertBuffer(mmsi, {
        latitude:   lat,
        longitude:  lon,
        speed:      Number(p.Sog),
        course:     Number(p.Cog),
        heading:    p.TrueHeading === 511 ? null : Number(p.TrueHeading),
        nav_status: Number(p.NavigationalStatus),
        name:       (meta.ShipName || '').trim() || undefined,
        flag:       flagFromMmsi(mmsi),
      });
    } else if (msg.MessageType === 'ShipStaticData') {
      const s = msg.Message?.ShipStaticData;
      if (!s) return;
      upsertBuffer(mmsi, {
        name:        (s.Name || meta.ShipName || '').trim() || undefined,
        callsign:    (s.CallSign || '').trim() || undefined,
        vessel_type: Number(s.Type) || undefined,
        destination: (s.Destination || '').trim() || undefined,
        imo:         s.ImoNumber ? String(s.ImoNumber) : undefined,
        flag:        flagFromMmsi(mmsi),
      });
    }
  });

  // 'error' normally precedes 'close', which settles. Settling here too is a
  // guarded no-op in that case, and covers the rare error that never closes —
  // previously that would have hung the worker with no reconnect scheduled.
  socket.on('error', (err) => {
    console.error('ws error:', err.message);
    settle(`error ${err.message}`);
  });

  socket.on('close', (code, reason) => settle(`close ${code} ${reason || ''}`.trimEnd()));
}

// ─── Periodic flush ────────────────────────────────────────────
async function flush() {
  if (buffer.size === 0) return;
  const rows = Array.from(buffer.values()).filter(
    (r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude),
  );
  buffer.clear();
  if (rows.length === 0) return;

  let upserted = 0;
  let errored  = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('vessel_positions')
      .upsert(chunk, { onConflict: 'mmsi', ignoreDuplicates: false });
    if (error) { errored += chunk.length; console.error('upsert error:', error.message); }
    else       { upserted += chunk.length; }
  }

  const now = Date.now();
  const window = (now - lastLogged) / 1000;
  console.log(
    `[${new Date().toISOString()}] flush ` +
    `recv=${messagesIn} (${(messagesIn / window).toFixed(1)}/s) ` +
    `upsert=${upserted} err=${errored} buffered=${buffer.size}`,
  );
  messagesIn = 0;
  lastLogged = now;
}

// ─── Boot ──────────────────────────────────────────────────────
console.log('eYKON AIS ingest starting…');
console.log(`  flush every ${FLUSH_MS / 1000}s, batches of ${BATCH_SIZE}`);
console.log(`  stale after ${STALE_MS / 1000}s · storm cap after ${DRY_STREAK_CAP} dry cycles ` +
            `(floor ${STARVED_FLOOR_MIN / 60_000}m → ${STARVED_FLOOR_MAX / 60_000}m)`);
connect();
setInterval(() => { flush().catch((e) => console.error('flush threw:', e.message)); }, FLUSH_MS);

// Liveness watchdog. AISStream pushes a steady message flow when healthy, but a
// half-open / silently-dropped socket emits no 'close' or 'error' — so the
// reconnect path never fires and the worker stalls with data frozen (the
// 2026-06-21 stall). If nothing has arrived within STALE_MS, force the socket
// closed; terminate() is immediate (close() can hang on a dead socket) and
// fires 'close', which reconnects with backoff.
//
// NOTE (2026-08-05): this watchdog is also an amplifier when the stream is
// STARVED rather than half-open — it manufactures a fresh connection attempt
// every ~90s, which is what sustains an upstream 429. That is now bounded by
// dryStreak/backoffMs(): a kill here counts as a dry cycle, so repeated
// starvation walks the reconnect interval out to 30 minutes instead of
// hammering. The watchdog stays; the storm it could cause does not.
setInterval(() => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return; // CONNECTING/CLOSING handled by the normal lifecycle
  const silentMs = Date.now() - lastMessageAt;
  if (silentMs > STALE_MS) {
    console.warn(`[${new Date().toISOString()}] no AIS messages for ${Math.round(silentMs / 1000)}s — forcing reconnect`);
    lastMessageAt = Date.now();        // grace so we don't re-fire while the new socket comes up
    try { ws.terminate(); } catch (e) { console.error('terminate failed:', e.message); }
  }
  // Tick derived from the threshold rather than a flat 30s, so detection
  // latency stays proportional when STALE_MS is retuned. (At the 90s default
  // the old flat tick meant a stall was caught anywhere from 90-120s later —
  // which is why the 2026-08-05 logs read "no AIS messages for 105s".)
}, Math.max(1_000, Math.min(30_000, Math.floor(STALE_MS / 3))));

process.on('SIGTERM', async () => {
  console.log('SIGTERM — flushing and exiting…');
  await flush().catch(() => {});
  process.exit(0);
});

// ─── ITU MID → flag-state lookup (compact subset; extend as needed) ──
const MID_TO_FLAG = {
  201:'AL',202:'AD',203:'AT',204:'PT',205:'BE',206:'BY',207:'BG',208:'VA',209:'CY',210:'CY',
  211:'DE',212:'CY',213:'GE',214:'MD',215:'MT',216:'AM',218:'DE',219:'DK',220:'DK',224:'ES',
  225:'ES',226:'FR',227:'FR',228:'FR',229:'MT',230:'FI',231:'FO',232:'GB',233:'GB',234:'GB',
  235:'GB',236:'GI',237:'GR',238:'HR',239:'GR',240:'GR',241:'GR',242:'MA',243:'HU',244:'NL',
  245:'NL',246:'NL',247:'IT',248:'MT',249:'MT',250:'IE',251:'IS',252:'LI',253:'LU',254:'MC',
  255:'PT',256:'MT',257:'NO',258:'NO',259:'NO',261:'PL',262:'ME',263:'PT',264:'RO',265:'SE',
  266:'SE',267:'SK',268:'SM',269:'CH',270:'CZ',271:'TR',272:'UA',273:'RU',274:'MK',275:'LV',
  276:'EE',277:'LT',278:'SI',279:'RS',301:'AI',303:'US',304:'AG',305:'AG',306:'CW',307:'AW',
  308:'BS',309:'BS',310:'BM',311:'BS',312:'BZ',314:'BB',316:'CA',319:'KY',321:'CR',323:'CU',
  325:'DM',327:'DO',329:'GP',330:'GD',331:'GL',332:'GT',334:'HN',336:'HT',338:'US',339:'JM',
  341:'KN',343:'LC',345:'MX',347:'MQ',348:'MS',350:'NI',351:'PA',352:'PA',353:'PA',354:'PA',
  355:'PA',356:'PA',357:'PA',358:'PR',359:'SV',361:'PM',362:'TT',364:'TC',366:'US',367:'US',
  368:'US',369:'US',370:'PA',371:'PA',372:'PA',373:'PA',374:'PA',375:'VC',376:'VC',377:'VC',
  378:'VG',379:'VI',401:'AF',403:'SA',405:'BD',408:'BH',410:'BT',412:'CN',413:'CN',414:'CN',
  416:'TW',417:'LK',419:'IN',422:'IR',423:'AZ',425:'IQ',428:'IL',431:'JP',432:'JP',434:'TM',
  436:'KZ',437:'UZ',438:'JO',440:'KR',441:'KR',443:'PS',445:'KP',447:'KW',450:'LB',451:'KG',
  453:'MO',455:'MV',457:'MN',459:'NP',461:'OM',463:'PK',466:'QA',468:'SY',470:'AE',471:'AE',
  472:'TJ',473:'YE',475:'YE',477:'HK',478:'BA',501:'AQ',503:'AU',506:'MM',508:'BN',510:'FM',
  511:'PW',512:'NZ',514:'KH',515:'KH',516:'CX',518:'CK',520:'FJ',523:'CC',525:'ID',529:'KI',
  531:'LA',533:'MY',536:'MP',538:'MH',540:'NC',542:'NU',544:'NR',546:'PF',548:'PH',550:'TL',
  553:'PG',555:'PN',557:'SB',559:'AS',561:'WS',563:'SG',564:'SG',565:'SG',566:'SG',567:'TH',
  570:'TO',572:'TV',574:'VN',576:'VU',577:'VU',578:'WF',601:'ZA',603:'AO',605:'DZ',607:'TF',
  608:'IO',609:'BI',610:'BJ',611:'BW',612:'CF',613:'CM',615:'CG',616:'KM',617:'CV',618:'TF',
  619:'CI',620:'KM',621:'DJ',622:'EG',624:'ET',625:'ER',626:'GA',627:'GH',629:'GM',630:'GW',
  631:'GQ',633:'BF',634:'GW',635:'TF',636:'LR',637:'LR',638:'SS',642:'LY',644:'LS',645:'MU',
  647:'MG',649:'ML',650:'MZ',654:'MR',655:'MW',656:'NE',657:'NG',659:'NA',660:'RE',661:'RW',
  662:'SD',663:'ST',664:'SC',665:'SH',666:'SO',667:'SL',668:'TZ',669:'ZA',670:'TG',671:'TN',
  672:'TZ',674:'UG',675:'CD',676:'TZ',677:'TZ',678:'ZM',679:'ZW',701:'AR',710:'BR',720:'BO',
  725:'CL',730:'CO',735:'EC',740:'FK',745:'GF',750:'GY',755:'PY',760:'PE',765:'SR',770:'UY',
  775:'VE',
};
