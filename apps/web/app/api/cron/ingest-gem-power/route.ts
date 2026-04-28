import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

// One-shot ingestion of the Global Energy Monitor — Global Integrated Power
// Tracker (GIPT). ~180k unit-level records covering coal, oil/gas, nuclear,
// geothermal, bioenergy, utility-scale solar, wind, and hydropower.
//
// GEM has no public API. Operator workflow:
//  1. Register at globalenergymonitor.org/projects/global-integrated-power-tracker
//  2. Receive XLSX via email; open in Numbers/Excel/LibreOffice; export the
//     "Power facilities" sheet only as CSV (NOT the About or Regions sheets).
//  3. Upload the CSV to a stable URL (Google Drive shared link, S3, or own
//     GitHub fork).
//  4. Pass the URL to this endpoint via ?url=… or set GEM_GIPT_URL on Railway.
//
// Schema quirks (verified against the March 2026-II release):
//  - Delimiter is ';' (semicolon), not ','. The Power facilities sheet
//    contains commas inside quoted owner/parent fields.
//  - Decimal separator is ',' (comma): "14,488" means 14.488. Lat, lon,
//    capacity_mw all use this convention.
//  - Each unit of a multi-unit plant is its own row; rows share lat/lon and
//    plant_name but carry distinct unit_name + capacity.
//  - Primary key is "GEM unit/phase ID" (e.g. G100000104857), unique per row.
//
// Auth: Bearer <CRON_SECRET>  OR  ?secret=<CRON_SECRET>.
// Idempotent — uses ON CONFLICT (id) DO UPDATE so re-runs refresh in place.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600;

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

// RFC 4180 with custom delimiter.
function parseDelimitedLine(line: string, delim: string): string[] {
  const out: string[] = [];
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

// European-locale decimal: "14,488" → 14.488.
function euroNum(v: any): number | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().replace(',', '.');
  if (s === '') return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function pick(obj: Record<string, string>, key: string): string | null {
  const v = obj[key];
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s !== '' ? s : null;
}

type PowerPlantRow = {
  id: string;
  plant_name: string;
  unit_name: string | null;
  fuel_type: string | null;
  technology: string | null;
  capacity_mw: number | null;
  status: string | null;
  start_year: number | null;
  retired_year: number | null;
  country: string | null;
  region: string | null;
  subregion: string | null;
  city: string | null;
  subnational_unit: string | null;
  owner: string | null;
  operator: string | null;
  parent: string | null;
  gem_location_id: string | null;
  gem_wiki_url: string | null;
  latitude: number;
  longitude: number;
};

function rowFromObject(o: Record<string, string>): PowerPlantRow | null {
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

async function handle(req: NextRequest) {
  if (!checkAuth(req)) return unauthorized();
  const startedAt = Date.now();

  try {
    const url = req.nextUrl.searchParams.get('url') || process.env.GEM_GIPT_URL;
    if (!url) {
      return NextResponse.json({
        ok: false,
        error: 'no source URL provided',
        hint: 'pass ?url=<gipt-csv-url> or set GEM_GIPT_URL env var. The CSV is the "Power facilities" sheet exported from the GIPT XLSX.',
      }, { status: 400 });
    }

    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`download HTTP ${res.status} for ${url}`);
    const csv = await res.text();
    const lines = csv.split(/\r?\n/);
    if (lines.length < 2) throw new Error('empty CSV');

    // GEM ships semicolon-delimited; every other CSV we ingest is comma-
    // delimited. Sniff the header: if it has more semicolons than commas,
    // assume `;`. This means the operator can also pre-convert to a normal
    // comma-CSV without breaking the ingest.
    const headerLine = lines[0];
    const semis = (headerLine.match(/;/g) || []).length;
    const commas = (headerLine.match(/,/g) || []).length;
    const delim = semis > commas ? ';' : ',';

    const header = parseDelimitedLine(headerLine, delim).map(h => h.trim());
    const required = ['GEM unit/phase ID', 'Plant / Project name', 'Latitude', 'Longitude', 'Type', 'Status', 'Capacity (MW)'];
    for (const k of required) {
      if (!header.includes(k)) throw new Error(`GIPT CSV missing expected column: "${k}"`);
    }

    const rows: PowerPlantRow[] = [];
    let skipped = 0;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const cells = parseDelimitedLine(line, delim);
      if (cells.length < 10) { skipped++; continue; }
      const obj: Record<string, string> = {};
      header.forEach((h, j) => { obj[h] = (cells[j] ?? '').trim(); });
      const row = rowFromObject(obj);
      if (row) rows.push(row);
      else skipped++;
    }

    if (rows.length === 0) throw new Error('parsed 0 rows from CSV — check delimiter and column names');

    const supabase = createServerSupabase();
    const CHUNK = 500;
    let upserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const batch = rows.slice(i, i + CHUNK);
      const { error, count } = await supabase
        .from('power_plants')
        .upsert(batch, { onConflict: 'id', count: 'exact' });
      if (error) throw new Error(`supabase upsert (chunk ${i}): ${error.message}`);
      upserted += count ?? batch.length;
    }

    return NextResponse.json({
      ok: true,
      source_url: url,
      delimiter: delim,
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
