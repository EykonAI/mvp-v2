#!/usr/bin/env node
/**
 * Local seed for the `mines` table from a USGS MRDS bulk export on disk.
 * MRDS is frozen at 2011 — public-domain US Government, 304k records,
 * fine for v1 since most large deposits don't move. Future swap-in
 * candidates: USGS USMIN (US-only, current) or Mindat (contributor-only).
 *
 * Usage:
 *   cd apps/web
 *   SUPABASE_URL='https://…supabase.co' \
 *   SUPABASE_SERVICE_ROLE_KEY='eyJ…' \
 *   node scripts/seed-usgs-mrds-mines.mjs <path-to-csv>
 *
 * Acceptable inputs:
 *   - The CSV from MRDS bulk download (mrds.csv inside mrds-csv.zip).
 *   - Any pipe / comma / tab delimited file with the canonical MRDS
 *     column names: dep_id, site_name, dev_stat, latitude, longitude,
 *     country, state, county, commod1, commod2, commod3, ore, dep_type,
 *     url. Delimiter is auto-sniffed from the header row.
 *
 * The script is permissive on column presence — anything missing falls
 * back to NULL — so a re-cut of MRDS or a USMIN extract with overlapping
 * columns will work without code changes.
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createClient } from '@supabase/supabase-js';

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: node seed-usgs-mrds-mines.mjs <path-to-csv>');
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY env vars.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function parseDelimitedLine(line, delim) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else {
      if (ch === '"') q = true;
      else if (ch === delim) { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function pick(obj, ...keys) {
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s !== '') return s;
  }
  return null;
}
function pickNum(obj, ...keys) {
  const s = pick(obj, ...keys);
  if (s === null) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

// Best-effort country → ISO2 mapping for the most common MRDS values.
// MRDS uses verbose country names; we map the high-frequency ones, leaving
// NULL otherwise — the AI tool layer can still filter by full `country`.
const ISO2 = {
  'United States': 'US', 'USA': 'US', 'U.S.A.': 'US',
  'Canada': 'CA', 'Mexico': 'MX', 'Australia': 'AU', 'Brazil': 'BR',
  'Chile': 'CL', 'Peru': 'PE', 'Argentina': 'AR', 'Bolivia': 'BO',
  'China': 'CN', 'Russia': 'RU', 'India': 'IN', 'Indonesia': 'ID',
  'South Africa': 'ZA', 'Zambia': 'ZM', 'Democratic Republic of the Congo': 'CD',
  'United Kingdom': 'GB', 'Germany': 'DE', 'France': 'FR', 'Spain': 'ES',
  'Sweden': 'SE', 'Norway': 'NO', 'Finland': 'FI', 'Poland': 'PL',
  'Kazakhstan': 'KZ', 'Mongolia': 'MN', 'Iran': 'IR', 'Turkey': 'TR',
  'Saudi Arabia': 'SA', 'Egypt': 'EG', 'Morocco': 'MA',
};

function rowFromObject(o) {
  const id = pick(o, 'dep_id', 'DEP_ID', 'site_id', 'SITE_ID');
  if (!id) return null;
  const lat = pickNum(o, 'latitude', 'LATITUDE', 'lat', 'LAT', 'dec_lat');
  const lon = pickNum(o, 'longitude', 'LONGITUDE', 'lon', 'LON', 'long', 'LONG', 'dec_long');
  if (lat === null || lon === null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const country = pick(o, 'country', 'COUNTRY');
  const commod1 = pick(o, 'commod1', 'COMMOD1', 'commodity_1');
  const commod2 = pick(o, 'commod2', 'COMMOD2', 'commodity_2');
  const commod3 = pick(o, 'commod3', 'COMMOD3', 'commodity_3');
  const commodities = [commod1, commod2, commod3].filter(Boolean);
  return {
    id: String(id),
    site_name: pick(o, 'site_name', 'SITE_NAME', 'name', 'NAME'),
    dev_stat: pick(o, 'dev_stat', 'DEV_STAT', 'development_status'),
    country,
    iso_country: country ? ISO2[country] ?? null : null,
    state: pick(o, 'state', 'STATE'),
    county: pick(o, 'county', 'COUNTY'),
    commod1,
    commod2,
    commod3,
    commodities,
    ore: pick(o, 'ore', 'ORE'),
    dep_type: pick(o, 'dep_type', 'DEP_TYPE', 'deposit_type'),
    url: pick(o, 'url', 'URL', 'href'),
    latitude: lat,
    longitude: lon,
  };
}

console.log(`Reading ${csvPath}…`);
const startedAt = Date.now();

const rl = createInterface({ input: createReadStream(csvPath), crlfDelay: Infinity });
let header = null;
let delim = ',';
const rows = [];
let lineNo = 0;
let skipped = 0;

for await (const line of rl) {
  lineNo++;
  if (lineNo === 1) {
    const tabs = (line.match(/\t/g) || []).length;
    const semis = (line.match(/;/g) || []).length;
    const pipes = (line.match(/\|/g) || []).length;
    const commas = (line.match(/,/g) || []).length;
    delim = [
      ['\t', tabs],
      ['|', pipes],
      [';', semis],
      [',', commas],
    ].sort((a, b) => b[1] - a[1])[0][0];
    header = parseDelimitedLine(line, delim).map(h => h.trim());
    console.log(`  delimiter: '${delim === '\t' ? '\\t' : delim}'  ·  columns: ${header.length}`);
    continue;
  }
  if (!line) continue;
  const cells = parseDelimitedLine(line, delim);
  if (cells.length < 3) { skipped++; continue; }
  const obj = {};
  header.forEach((h, j) => { obj[h] = (cells[j] ?? '').trim(); });
  const row = rowFromObject(obj);
  if (row) rows.push(row);
  else skipped++;
}

console.log(`Parsed ${rows.length} rows  (${skipped} skipped — no id / no coords)`);
console.log(`Upserting in chunks of 1000 to ${SUPABASE_URL}…`);

const CHUNK = 1000;
let upserted = 0;
let lastReportTime = Date.now();
for (let i = 0; i < rows.length; i += CHUNK) {
  const batch = rows.slice(i, i + CHUNK);
  const { error, count } = await supabase
    .from('mines')
    .upsert(batch, { onConflict: 'id', count: 'exact' });
  if (error) {
    console.error(`\nUpsert failed at chunk ${i}:`, error.message);
    process.exit(1);
  }
  upserted += count ?? batch.length;
  if (Date.now() - lastReportTime > 3000) {
    process.stdout.write(`\r  ${upserted}/${rows.length} (${Math.round(100 * upserted / rows.length)}%)`);
    lastReportTime = Date.now();
  }
}
process.stdout.write(`\r  ${upserted}/${rows.length} (100%)\n`);

const elapsed = Math.round((Date.now() - startedAt) / 1000);
console.log(`\n✓ Done in ${elapsed}s.`);
console.log(`  parsed:   ${rows.length}`);
console.log(`  skipped:  ${skipped}`);
console.log(`  upserted: ${upserted}`);
