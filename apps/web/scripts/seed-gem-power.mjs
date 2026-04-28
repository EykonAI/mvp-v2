#!/usr/bin/env node
/**
 * One-shot local seed for the `power_plants` table from a GEM GIPT
 * "Power facilities" CSV on disk. Bypasses the /api/cron/ingest-gem-power
 * web endpoint — useful when you already have the file locally and don't
 * want to upload it anywhere.
 *
 * Usage:
 *   SUPABASE_URL='https://xxxxx.supabase.co' \
 *   SUPABASE_SERVICE_ROLE_KEY='eyJ…' \
 *   node scripts/seed-gem-power.mjs <path-to-csv>
 *
 * Mirrors the parser in apps/web/app/api/cron/ingest-gem-power/route.ts —
 * same delimiter sniffing, same European-decimal handling, same upsert.
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createClient } from '@supabase/supabase-js';

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: node seed-gem-power.mjs <path-to-csv>');
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY env vars.');
  console.error('Find them at: Supabase Dashboard → Project Settings → API.');
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

function euroNum(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().replace(',', '.');
  if (s === '') return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function pick(obj, key) {
  const v = obj[key];
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s !== '' ? s : null;
}

function rowFromObject(o) {
  const id = pick(o, 'GEM unit/phase ID');
  const name = pick(o, 'Plant / Project name');
  const lat = euroNum(o['Latitude']);
  const lon = euroNum(o['Longitude']);
  if (!id || !name || lat === null || lon === null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const startYear = pick(o, 'Start year');
  const retiredYear = pick(o, 'Retired year');
  return {
    id,
    plant_name: name,
    unit_name: pick(o, 'Unit / Phase name'),
    fuel_type: pick(o, 'Type'),
    technology: pick(o, 'Technology'),
    capacity_mw: euroNum(o['Capacity (MW)']),
    status: pick(o, 'Status'),
    start_year: startYear ? parseInt(startYear) || null : null,
    retired_year: retiredYear ? parseInt(retiredYear) || null : null,
    country: pick(o, 'Country/area'),
    region: pick(o, 'Region'),
    subregion: pick(o, 'Subregion'),
    city: pick(o, 'City'),
    subnational_unit: pick(o, 'Subnational unit (state, province)'),
    owner: pick(o, 'Owner(s)'),
    operator: pick(o, 'Operator(s)'),
    parent: pick(o, 'Parent(s)'),
    gem_location_id: pick(o, 'GEM location ID'),
    gem_wiki_url: pick(o, 'GEM.Wiki URL'),
    latitude: lat,
    longitude: lon,
  };
}

console.log(`Reading ${csvPath}…`);
const startedAt = Date.now();

const rl = createInterface({ input: createReadStream(csvPath), crlfDelay: Infinity });
let header = null;
let delim = ';';
const rows = [];
let lineNo = 0;
let skipped = 0;

for await (const line of rl) {
  lineNo++;
  if (lineNo === 1) {
    const semis = (line.match(/;/g) || []).length;
    const commas = (line.match(/,/g) || []).length;
    delim = semis > commas ? ';' : ',';
    header = parseDelimitedLine(line, delim).map(h => h.trim());
    console.log(`  delimiter: '${delim}'  ·  columns: ${header.length}`);
    continue;
  }
  if (!line) continue;
  const cells = parseDelimitedLine(line, delim);
  if (cells.length < 10) { skipped++; continue; }
  const obj = {};
  header.forEach((h, j) => { obj[h] = (cells[j] ?? '').trim(); });
  const row = rowFromObject(obj);
  if (row) rows.push(row);
  else skipped++;
}

console.log(`Parsed ${rows.length} rows  (${skipped} skipped)`);
console.log(`Upserting in chunks of 500 to ${SUPABASE_URL}…`);

const CHUNK = 500;
let upserted = 0;
let lastReportTime = Date.now();
for (let i = 0; i < rows.length; i += CHUNK) {
  const batch = rows.slice(i, i + CHUNK);
  const { error, count } = await supabase
    .from('power_plants')
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
