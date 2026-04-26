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

const STREAM_URL    = 'wss://stream.aisstream.io/v0/stream';
const FLUSH_MS      = 30_000;          // upsert buffer every 30s
const MAX_BUFFER    = 100_000;         // safety bound
const BATCH_SIZE    = 500;             // rows per upsert call
const RECONNECT_MIN = 1_000;
const RECONNECT_MAX = 60_000;

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
let reconnectDelay = RECONNECT_MIN;
let messagesIn = 0;
let lastLogged = Date.now();

function connect() {
  console.log(`[${new Date().toISOString()}] connecting to AISStream…`);
  ws = new WebSocket(STREAM_URL);

  ws.on('open', () => {
    console.log('  open — subscribing global bbox');
    reconnectDelay = RECONNECT_MIN;
    ws.send(JSON.stringify({
      APIKey: AIS_KEY,
      BoundingBoxes: [[[-90, -180], [90, 180]]],
      FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
    }));
  });

  ws.on('message', (raw) => {
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

  ws.on('error', (err) => console.error('ws error:', err.message));

  ws.on('close', (code, reason) => {
    console.log(`  close ${code} ${reason || ''} — reconnecting in ${reconnectDelay}ms`);
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(RECONNECT_MAX, reconnectDelay * 2);
  });
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
connect();
setInterval(() => { flush().catch((e) => console.error('flush threw:', e.message)); }, FLUSH_MS);

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
