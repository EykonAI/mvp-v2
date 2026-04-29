import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

// One-shot ingestion of the GEM Global Gas Infrastructure Tracker (GGIT)
// LNG terminals GeoJSON (~1,200 features). Same operator-supplied URL
// pattern as the pipelines cron.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

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
function pickBool(o: any, k: string): boolean | null {
  const v = o[k];
  if (v === undefined || v === null || v === '') return null;
  if (v === 1 || v === true || v === 'true' || v === 'yes' || v === '1') return true;
  if (v === 0 || v === false || v === 'false' || v === 'no' || v === '0') return false;
  return null;
}

function rowFromFeature(f: any) {
  const props = f.properties || {};
  const id = pickStr(props, 'UnitID');
  const name = pickStr(props, 'TerminalName');
  if (!id || !name) return null;
  let lat = pickNum(props, 'Latitude');
  let lon = pickNum(props, 'Longitude');
  if ((lat === null || lon === null) && f.geometry?.type === 'Point') {
    [lon, lat] = f.geometry.coordinates;
  }
  if (lat === null || lon === null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
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

async function handle(req: NextRequest) {
  if (!checkAuth(req)) return unauthorized();
  const startedAt = Date.now();
  try {
    const url = req.nextUrl.searchParams.get('url') || process.env.GEM_GGIT_TERMINALS_URL;
    if (!url) {
      return NextResponse.json({
        ok: false,
        error: 'no source URL provided',
        hint: 'pass ?url=<geojson-url> or set GEM_GGIT_TERMINALS_URL env var.',
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
    const CHUNK = 500;
    let upserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const batch = rows.slice(i, i + CHUNK);
      const { error, count } = await supabase
        .from('lng_terminals')
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
