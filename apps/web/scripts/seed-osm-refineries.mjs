#!/usr/bin/env node
/**
 * Local seed for the `refineries` table from OpenStreetMap via the
 * Overpass API. Same shape as the GEM seed scripts but the source is
 * a live HTTP query, so no local file path is required — the script
 * reaches out, runs an Overpass query for refinery-tagged objects,
 * resolves centroids for ways/relations, then upserts.
 *
 * Usage:
 *   cd apps/web
 *   SUPABASE_URL='https://…supabase.co' \
 *   SUPABASE_SERVICE_ROLE_KEY='eyJ…' \
 *   node scripts/seed-osm-refineries.mjs
 *
 * Optional env:
 *   OVERPASS_URL  override (default: https://overpass.kumi.systems/api/interpreter
 *                 — Austrian non-profit mirror with no rate limits per the
 *                 2026-Q2 provider deltas memo).
 *
 * OSM tagging covered by the query:
 *   - man_made=works   + product=oil  (~250 results)
 *   - industrial=oil   + landuse=industrial
 *   - industrial=oil_refinery
 *   - man_made=petroleum_refinery   (newer tag, growing usage)
 * Total expected: ~1,000–1,500 globally.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY env vars.');
  process.exit(1);
}

const OVERPASS_URL = process.env.OVERPASS_URL || 'https://overpass.kumi.systems/api/interpreter';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Overpass QL — combines four common refinery taggings, returns geometries
// inline (`out center`) so we can compute centroids without a second pass.
const OVERPASS_QUERY = `
[out:json][timeout:180];
(
  nwr["man_made"="petroleum_refinery"];
  nwr["industrial"="oil_refinery"];
  nwr["man_made"="works"]["product"~"oil|petroleum|refined",i];
  nwr["industrial"="oil"];
);
out center tags;
`.trim();

function pickStr(tags, ...keys) {
  for (const k of keys) {
    const v = tags?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}
function pickNum(tags, ...keys) {
  const s = pickStr(tags, ...keys);
  if (s === null) return null;
  const n = parseFloat(String(s).replace(/[^\d.\-eE]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function centroidOf(el) {
  if (el.type === 'node') return [el.lat, el.lon];
  if (el.center) return [el.center.lat, el.center.lon];
  return null;
}

function rowFromElement(el) {
  const tags = el.tags || {};
  const c = centroidOf(el);
  if (!c) return null;
  const [lat, lon] = c;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const id = `${el.type}:${el.id}`;
  const name = pickStr(tags, 'name:en', 'name', 'official_name', 'operator');
  const wikidata = pickStr(tags, 'wikidata');
  const wikipedia = pickStr(tags, 'wikipedia');
  const wiki_url = wikidata
    ? `https://www.wikidata.org/wiki/${wikidata}`
    : wikipedia
      ? `https://${wikipedia.includes(':') ? wikipedia.split(':')[0] : 'en'}.wikipedia.org/wiki/${encodeURIComponent(
          wikipedia.includes(':') ? wikipedia.split(':').slice(1).join(':') : wikipedia,
        )}`
      : null;
  return {
    id,
    osm_type: el.type,
    osm_id: el.id,
    refinery_name: name,
    operator: pickStr(tags, 'operator'),
    owner: pickStr(tags, 'owner'),
    product: pickStr(tags, 'product'),
    capacity_bpd: pickNum(tags, 'capacity:bpd', 'capacity_bpd'),
    start_date: pickStr(tags, 'start_date', 'opening_date'),
    country: pickStr(tags, 'addr:country', 'is_in:country'),
    iso_country: pickStr(tags, 'ISO3166-1', 'addr:country_code'),
    city: pickStr(tags, 'addr:city', 'is_in:city'),
    wiki_url,
    source_tags: tags,
    latitude: lat,
    longitude: lon,
  };
}

console.log(`Querying Overpass at ${OVERPASS_URL}…`);
const t0 = Date.now();

const res = await fetch(OVERPASS_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: `data=${encodeURIComponent(OVERPASS_QUERY)}`,
});
if (!res.ok) {
  console.error(`Overpass HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  process.exit(1);
}
const json = await res.json();
const elements = json.elements || [];
console.log(`  ${elements.length} elements returned in ${Date.now() - t0}ms`);

// Dedupe by id — the multi-tag query can match the same object twice.
const byId = new Map();
let skipped = 0;
for (const el of elements) {
  const row = rowFromElement(el);
  if (!row) { skipped++; continue; }
  byId.set(row.id, row);
}
const rows = Array.from(byId.values());
console.log(`Mapped ${rows.length} rows  (${skipped} skipped — no centroid; ${elements.length - rows.length - skipped} deduped)`);

const CHUNK = 500;
console.log(`Upserting in chunks of ${CHUNK} to ${SUPABASE_URL}…`);
let upserted = 0;
let lastReport = Date.now();
for (let i = 0; i < rows.length; i += CHUNK) {
  const batch = rows.slice(i, i + CHUNK);
  const { error, count } = await supabase
    .from('refineries')
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
console.log(`  fetched:  ${elements.length}`);
console.log(`  skipped:  ${skipped}`);
console.log(`  upserted: ${upserted}`);
