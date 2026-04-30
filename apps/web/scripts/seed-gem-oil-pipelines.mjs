#!/usr/bin/env node
/**
 * Local seed for the `oil_pipelines` table from a GEM GOIT Oil & NGL
 * Pipelines GeoJSON file on disk. Mirror of seed-gem-gas-pipelines.mjs —
 * different field names (Countries vs CountriesOrAreas, CapacityBOEd
 * vs CapacityBcm/y, StartCountry vs StartCountryOrArea) but identical
 * geometry handling.
 *
 * Usage:
 *   cd apps/web
 *   SUPABASE_URL='https://…supabase.co' \
 *   SUPABASE_SERVICE_ROLE_KEY='eyJ…' \
 *   node scripts/seed-gem-oil-pipelines.mjs <path-to-geojson>
 *
 * Source file (March 2025 release on disk):
 *   GEM-GOIT-Oil-NGL-Pipelines-2025-03/GEM-GOIT-Oil-NGL-Pipelines-2025-03.geojson
 *   1,874 features → ~1,400 with usable geometry
 *   (456 GeometryCollection rows are empty placeholders without route data).
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const path = process.argv[2];
if (!path) {
  console.error('Usage: node seed-gem-oil-pipelines.mjs <path-to-geojson>');
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

const MAX_POINTS_PER_LINE = 1500;
const MAX_TOTAL_POINTS = 3000;

function downsampleLine(coords, maxPoints) {
  if (coords.length <= maxPoints) return coords;
  const step = Math.ceil(coords.length / maxPoints);
  const out = [];
  for (let i = 0; i < coords.length; i += step) out.push(coords[i]);
  if (out[out.length - 1] !== coords[coords.length - 1]) out.push(coords[coords.length - 1]);
  return out;
}

function downsampleGeometry(geom) {
  if (!geom) return null;
  if (geom.type === 'LineString') {
    return { type: 'LineString', coordinates: downsampleLine(geom.coordinates, MAX_POINTS_PER_LINE) };
  }
  if (geom.type === 'MultiLineString') {
    let lines = geom.coordinates.map((l) => downsampleLine(l, MAX_POINTS_PER_LINE));
    const total = lines.reduce((s, l) => s + l.length, 0);
    if (total > MAX_TOTAL_POINTS) {
      const perLineMax = Math.max(10, Math.floor(MAX_TOTAL_POINTS / lines.length));
      lines = lines.map((l) => downsampleLine(l, perLineMax));
    }
    return { type: 'MultiLineString', coordinates: lines };
  }
  if (geom.type === 'GeometryCollection') {
    const inner = (geom.geometries || []).map(downsampleGeometry).filter(Boolean);
    if (inner.length === 0) return null;
    return { type: 'GeometryCollection', geometries: inner };
  }
  return geom;
}

function geometryBbox(geom) {
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  function visit(coords) {
    if (typeof coords[0] === 'number') {
      const [lon, lat] = coords;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    } else {
      for (const c of coords) visit(c);
    }
  }
  if (!geom) return null;
  if (geom.type === 'GeometryCollection') {
    for (const inner of geom.geometries || []) {
      const b = geometryBbox(inner);
      if (b) {
        if (b.bbox_lat_min < minLat) minLat = b.bbox_lat_min;
        if (b.bbox_lat_max > maxLat) maxLat = b.bbox_lat_max;
        if (b.bbox_lon_min < minLon) minLon = b.bbox_lon_min;
        if (b.bbox_lon_max > maxLon) maxLon = b.bbox_lon_max;
      }
    }
  } else if (geom.coordinates) {
    visit(geom.coordinates);
  }
  if (!Number.isFinite(minLat)) return null;
  return { bbox_lat_min: minLat, bbox_lat_max: maxLat, bbox_lon_min: minLon, bbox_lon_max: maxLon };
}

function pickStr(o, key) {
  const v = o[key];
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s !== '' ? s : null;
}
function pickNum(o, key) {
  const v = o[key];
  if (v === undefined || v === null || v === '') return null;
  // GOIT writes "450,000.00" with US thousand separators — strip commas before parse.
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}
function pickInt(o, key) {
  const n = pickNum(o, key);
  return n === null ? null : Math.floor(n);
}

function rowFromFeature(f) {
  const props = f.properties || {};
  const id = pickStr(props, 'ProjectID');
  const name = pickStr(props, 'PipelineName');
  if (!id || !name) return null;
  const downsampled = downsampleGeometry(f.geometry);
  if (!downsampled) return null;
  const bbox = geometryBbox(downsampled);
  if (!bbox) return null;
  return {
    id,
    pipeline_name: name,
    segment_name: pickStr(props, 'SegmentName'),
    wiki_url: pickStr(props, 'Wiki'),
    status: pickStr(props, 'Status'),
    fuel: pickStr(props, 'Fuel'),
    countries: pickStr(props, 'Countries'),
    owner: pickStr(props, 'Owner'),
    parent: pickStr(props, 'Parent'),
    start_year: pickInt(props, 'StartYear1'),
    capacity_boed: pickNum(props, 'CapacityBOEd'),
    capacity_raw: pickStr(props, 'Capacity'),
    capacity_units: pickStr(props, 'CapacityUnits'),
    length_km: pickNum(props, 'LengthMergedKm'),
    diameter: pickStr(props, 'Diameter'),
    diameter_units: pickStr(props, 'DiameterUnits'),
    fuel_source: pickStr(props, 'FuelSource'),
    start_country: pickStr(props, 'StartCountry'),
    end_country: pickStr(props, 'EndCountry'),
    route_accuracy: pickStr(props, 'RouteAccuracy'),
    ...bbox,
    route_geojson: downsampled,
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
console.log(`Mapped ${rows.length} rows  (${skipped} skipped — no geometry / no id)`);

const CHUNK = 25;
console.log(`Upserting in chunks of ${CHUNK} to ${SUPABASE_URL}…`);
let upserted = 0;
let lastReport = Date.now();
for (let i = 0; i < rows.length; i += CHUNK) {
  const batch = rows.slice(i, i + CHUNK);
  const { error, count } = await supabase
    .from('oil_pipelines')
    .upsert(batch, { onConflict: 'id', count: 'exact' });
  if (error) {
    console.error(`\nUpsert failed at chunk ${i}:`, error.message);
    process.exit(1);
  }
  upserted += count ?? batch.length;
  if (Date.now() - lastReport > 3000) {
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
