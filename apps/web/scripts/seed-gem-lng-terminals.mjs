#!/usr/bin/env node
/**
 * Local seed for the `lng_terminals` table from a GEM GGIT LNG Terminals
 * GeoJSON file on disk. Lighter than the pipelines seed — points only,
 * no geometry downsampling needed (every feature is a single Point).
 *
 * Usage:
 *   cd apps/web
 *   SUPABASE_URL='https://…supabase.co' \
 *   SUPABASE_SERVICE_ROLE_KEY='eyJ…' \
 *   node scripts/seed-gem-lng-terminals.mjs <path-to-geojson>
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const path = process.argv[2];
if (!path) {
  console.error('Usage: node seed-gem-lng-terminals.mjs <path-to-geojson>');
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

function pickStr(o, key) {
  const v = o[key];
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s !== '' ? s : null;
}
function pickNum(o, key) {
  const v = o[key];
  if (v === undefined || v === null || v === '') return null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}
function pickInt(o, key) {
  const n = pickNum(o, key);
  return n === null ? null : Math.floor(n);
}
function pickBool(o, key) {
  const v = o[key];
  if (v === undefined || v === null || v === '') return null;
  if (v === 1 || v === true || v === 'true' || v === 'yes' || v === '1') return true;
  if (v === 0 || v === false || v === 'false' || v === 'no' || v === '0') return false;
  return null;
}

function rowFromFeature(f) {
  const props = f.properties || {};
  const id = pickStr(props, 'UnitID');
  const name = pickStr(props, 'TerminalName');
  if (!id || !name) return null;
  // Prefer Latitude/Longitude columns; fall back to geometry coords.
  let lat = pickNum(props, 'Latitude');
  let lon = pickNum(props, 'Longitude');
  if ((lat === null || lon === null) && f.geometry?.type === 'Point') {
    [lon, lat] = f.geometry.coordinates;
  }
  if (lat === null || lon === null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  // Pick the most useful start-year from the cascade of date columns.
  const startYear =
    pickInt(props, 'ActualStartYear') ??
    pickInt(props, 'OriginalPlannedStartYear') ??
    pickInt(props, 'LatestPlannedStartYear') ??
    pickInt(props, 'ProposalYear');
  return {
    id,
    project_id: pickStr(props, 'ProjectID'),
    terminal_name: name,
    unit_name: pickStr(props, 'UnitName'),
    wiki_url: pickStr(props, 'Wiki'),
    facility_type: pickStr(props, 'FacilityType'),
    fuel: pickStr(props, 'Fuel'),
    status: pickStr(props, 'Status'),
    country: pickStr(props, 'Country/Area'),
    region: pickStr(props, 'Region'),
    subregion: pickStr(props, 'SubRegion'),
    capacity_mtpa: pickNum(props, 'CapacityinMtpa'),
    capacity_bcm_y: pickNum(props, 'CapacityinBcm/y'),
    owner: pickStr(props, 'Owner'),
    parent: pickStr(props, 'Parent'),
    operator: pickStr(props, 'Operator'),
    start_year: startYear,
    offshore: pickBool(props, 'Offshore'),
    floating: pickBool(props, 'Floating'),
    latitude: lat,
    longitude: lon,
  };
}

console.log(`Reading ${path}…`);
const t0 = Date.now();
const json = JSON.parse(readFileSync(path, 'utf8'));
const features = json.features || [];
console.log(`  ${features.length} features in ${Date.now() - t0}ms`);

const rows = [];
let skipped = 0;
for (const f of features) {
  const row = rowFromFeature(f);
  if (row) rows.push(row);
  else skipped++;
}
console.log(`Mapped ${rows.length} rows  (${skipped} skipped — no id / no coords)`);

const CHUNK = 500;
console.log(`Upserting in chunks of ${CHUNK} to ${SUPABASE_URL}…`);
let upserted = 0;
let lastReport = Date.now();
for (let i = 0; i < rows.length; i += CHUNK) {
  const batch = rows.slice(i, i + CHUNK);
  const { error, count } = await supabase
    .from('lng_terminals')
    .upsert(batch, { onConflict: 'id', count: 'exact' });
  if (error) {
    console.error(`\nUpsert failed at chunk ${i}:`, error.message);
    process.exit(1);
  }
  upserted += count ?? batch.length;
  if (Date.now() - lastReport > 2000) {
    process.stdout.write(`\r  ${upserted}/${rows.length} (${Math.round(100 * upserted / rows.length)}%)`);
    lastReport = Date.now();
  }
}
process.stdout.write(`\r  ${upserted}/${rows.length} (100%)\n`);

const elapsed = Math.round((Date.now() - t0) / 1000);
console.log(`\n✓ Done in ${elapsed}s.`);
console.log(`  parsed:   ${features.length}`);
console.log(`  skipped:  ${skipped}`);
console.log(`  upserted: ${upserted}`);
