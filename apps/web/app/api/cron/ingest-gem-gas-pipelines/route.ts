import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

// One-shot ingestion of the GEM Global Gas Infrastructure Tracker (GGIT)
// pipelines GeoJSON (~4,200 features, ~70 MB). Operator-supplied URL —
// GEM has no public API. Use the local script
// (apps/web/scripts/seed-gem-gas-pipelines.mjs) for the initial seed when
// the file is on the laptop; this endpoint is for any future automated
// quarterly refresh from a stable URL.
//
// Auth: Bearer <CRON_SECRET>  OR  ?secret=<CRON_SECRET>.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600;

const MAX_POINTS_PER_LINE = 1500;
const MAX_TOTAL_POINTS = 3000;

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}
function checkAuth(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const auth = req.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const qs = req.nextUrl.searchParams.get('secret') || '';
  return bearer === expected || qs === expected;
}

function downsampleLine(coords: number[][], maxPoints: number): number[][] {
  if (coords.length <= maxPoints) return coords;
  const step = Math.ceil(coords.length / maxPoints);
  const out: number[][] = [];
  for (let i = 0; i < coords.length; i += step) out.push(coords[i]);
  if (out[out.length - 1] !== coords[coords.length - 1]) out.push(coords[coords.length - 1]);
  return out;
}
function downsampleGeometry(geom: any): any {
  if (!geom) return null;
  if (geom.type === 'LineString') {
    return { type: 'LineString', coordinates: downsampleLine(geom.coordinates, MAX_POINTS_PER_LINE) };
  }
  if (geom.type === 'MultiLineString') {
    let lines = geom.coordinates.map((l: number[][]) => downsampleLine(l, MAX_POINTS_PER_LINE));
    const total = lines.reduce((s: number, l: number[][]) => s + l.length, 0);
    if (total > MAX_TOTAL_POINTS) {
      const perLineMax = Math.max(10, Math.floor(MAX_TOTAL_POINTS / lines.length));
      lines = lines.map((l: number[][]) => downsampleLine(l, perLineMax));
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
function geometryBbox(geom: any) {
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  function visit(coords: any) {
    if (typeof coords[0] === 'number') {
      const [lon, lat] = coords;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    } else for (const c of coords) visit(c);
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
  } else if (geom.coordinates) visit(geom.coordinates);
  if (!Number.isFinite(minLat)) return null;
  return { bbox_lat_min: minLat, bbox_lat_max: maxLat, bbox_lon_min: minLon, bbox_lon_max: maxLon };
}

function pickStr(o: any, k: string): string | null {
  const v = o[k];
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s !== '' ? s : null;
}
function pickNum(o: any, k: string): number | null {
  const v = o[k];
  if (v === undefined || v === null || v === '') return null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}
function pickInt(o: any, k: string): number | null {
  const n = pickNum(o, k);
  return n === null ? null : Math.floor(n);
}

function rowFromFeature(f: any) {
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

async function handle(req: NextRequest) {
  if (!checkAuth(req)) return unauthorized();
  const startedAt = Date.now();
  try {
    const url = req.nextUrl.searchParams.get('url') || process.env.GEM_GGIT_PIPELINES_URL;
    if (!url) {
      return NextResponse.json({
        ok: false,
        error: 'no source URL provided',
        hint: 'pass ?url=<geojson-url> or set GEM_GGIT_PIPELINES_URL env var. The file is the GeoJSON from GEM\'s "zip file with GIS formats" download.',
      }, { status: 400 });
    }
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`download HTTP ${res.status} for ${url}`);
    const json = await res.json();
    const features = json.features || [];
    if (features.length === 0) throw new Error('no features in GeoJSON');

    const rows: any[] = [];
    let skipped = 0;
    for (const f of features) {
      const r = rowFromFeature(f);
      if (r) rows.push(r); else skipped++;
    }

    const supabase = createServerSupabase();
    const CHUNK = 25;
    let upserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const batch = rows.slice(i, i + CHUNK);
      const { error, count } = await supabase
        .from('gas_pipelines')
        .upsert(batch, { onConflict: 'id', count: 'exact' });
      if (error) throw new Error(`supabase upsert (chunk ${i}): ${error.message}`);
      upserted += count ?? batch.length;
    }

    return NextResponse.json({
      ok: true,
      source_url: url,
      parsed: rows.length,
      skipped,
      upserted,
      elapsed_ms: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message, elapsed_ms: Date.now() - startedAt },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
