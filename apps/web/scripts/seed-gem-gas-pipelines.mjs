#!/usr/bin/env node
/**
 * Local seed for the `gas_pipelines` table from a GEM GGIT Pipelines
 * GeoJSON file on disk. Bypasses the /api/cron/ingest-gem-gas-pipelines
 * web endpoint when the file is already on the laptop doing the seeding —
 * 68 MB of GeoJSON is awkward to upload-and-fetch through Drive, but a
 * direct REST upload to Supabase is straightforward.
 *
 * Usage:
 *   cd apps/web
 *   SUPABASE_URL='https://…supabase.co' \
 *   SUPABASE_SERVICE_ROLE_KEY='eyJ…' \
 *   node scripts/seed-gem-gas-pipelines.mjs <path-to-geojson>
 *
 * What it does per feature:
 *  - Skips features without usable geometry (the 712 empty
 *    GeometryCollection rows in the Nov 2025 release — pipelines for
 *    which GEM has no route digitised yet).
 *  - Downsamples LineString / MultiLineString routes to ≤5,000 points
 *    each via uniform sampling. Visually identical at any zoom we'll
 *    reach in the browser; protects the Supabase REST max-row size from
 *    the one outlier route with ~258k points.
 *  - Computes a bounding box per route for index-friendly viewport
 *    filtering on read.
 *  - Stores the (possibly downsampled) GeoJSON geometry as JSONB; the
 *    API route ships it to MapView as-is for PathLayer rendering.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const path = process.argv[2];
if (!path) {
  console.error('Usage: node seed-gem-gas-pipelines.mjs <path-to-geojson>');
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

// Uniform-step downsample preserving the first and last points. Crude but
// preserves topology for viewport-zoom rendering, which is what we care
// about — Douglas-Peucker would be marginally better but adds a dep.
function downsampleLine(coords, maxPoints) {
  if (coords.length <= maxPoints) return coords;
  const step = Math.ceil(coords.length / maxPoints);
  const out = [];
  for (let i = 0; i < coords.length; i += step) out.push(coords[i]);
  if (out[out.length - 1] !== coords[coords.length - 1]) out.push(coords[coords.length - 1]);
  return out;
}

// Recursively downsample a GeoJSON geometry, returning the same shape.
// Two passes for MultiLineString: per-line cap, then a total cap if the
// sum still busts the per-row payload budget (PostgREST max-body-size).
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

// Walk a GeoJSON geometry to compute its bounding box.
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
  // GGIT GeoJSON normalises decimals to '.' so no euro-decimal handling needed.
  const n = parseFloat(String(v));
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
  // Skip pipelines with no usable route — the 712 empty GeometryCollection
  // entries from the Nov 2025 release fall here.
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
    countries: pickStr(props, 'CountriesOrAreas'),
    owner: pickStr(props, 'Owner'),
    parent: pickStr(props, 'Parent'),
    start_year: pickInt(props, 'StartYear1'),
    capacity_bcm_y: pickNum(props, 'CapacityBcm/y'),
    length_km: pickNum(props, 'LengthMergedKm'),
    diameter: pickStr(props, 'Diameter'),
    diameter_units: pickStr(props, 'DiameterUnits'),
    fuel_source: pickStr(props, 'FuelSource'),
    start_country: pickStr(props, 'StartCountryOrArea'),
    end_country: pickStr(props, 'EndCountryOrArea'),
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

// Smaller chunk size than the GIPT seed: each row carries an embedded
// JSONB geometry that can be ~30-100 KB for the largest pipelines, and
// PostgREST has a default request-body cap.
const CHUNK = 25;
console.log(`Upserting in chunks of ${CHUNK} to ${SUPABASE_URL}…`);
let upserted = 0;
let lastReport = Date.now();
for (let i = 0; i < rows.length; i += CHUNK) {
  const batch = rows.slice(i, i + CHUNK);
  const { error, count } = await supabase
    .from('gas_pipelines')
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
