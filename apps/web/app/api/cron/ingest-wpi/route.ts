import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

// One-shot ingestion of the NGA World Port Index (~3,700 ports).
//
// NGA does not publish a stable URL for the latest WPI download — the file
// path embeds a version key that rotates each publication. The operator
// supplies the URL on first call:
//
//   1. ?url=<csv-or-json-url> as a query param (one-shot)
//   2. WPI_DOWNLOAD_URL env var (per-environment default)
//   3. (optional) auto-discover via the NGA publications metadata API,
//      attempted only when neither of the above is set.
//
// Auth: Bearer <CRON_SECRET>  OR  ?secret=<CRON_SECRET>.
// Idempotent — uses ON CONFLICT (id) DO UPDATE.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const NGA_METADATA_URL = 'https://msi.nga.mil/api/publications/world-port-index';

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

function parseCsvLine(line: string): string[] {
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
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

type PortRow = {
  id: string;
  port_name: string;
  country_code: string | null;
  unlocode: string | null;
  harbor_size: string | null;
  harbor_type: string | null;
  shelter: string | null;
  channel_depth_m: number | null;
  repairs: string | null;
  latitude: number;
  longitude: number;
};

// Defensive field lookup — WPI publishes under varying camelCase / snake_case
// / SCREAMING_CASE keys depending on which publication branch you fetch.
function pick(obj: any, ...keys: string[]): string {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return String(obj[k]);
  }
  return '';
}
function num(obj: any, ...keys: string[]): number | null {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') {
      const n = parseFloat(String(obj[k]));
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function rowFromObject(o: any): PortRow | null {
  const id = pick(o, 'id', 'INDEX_NO', 'indexNumber', 'PortNumber', 'portNumber');
  const name = pick(o, 'port_name', 'PORT_NAME', 'portName', 'Name', 'NAME');
  const lat = num(o, 'latitude', 'LATITUDE', 'lat', 'Latitude');
  const lon = num(o, 'longitude', 'LONGITUDE', 'lng', 'lon', 'Longitude');
  if (!id || !name || lat === null || lon === null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return {
    id,
    port_name: name,
    country_code: (pick(o, 'country_code', 'COUNTRY', 'countryCode', 'Country') || '').slice(0, 2) || null,
    unlocode: pick(o, 'unlocode', 'UNLOCODE', 'unloCode') || null,
    harbor_size: pick(o, 'harbor_size', 'HARBORSIZE', 'harborSize') || null,
    harbor_type: pick(o, 'harbor_type', 'HARBORTYPE', 'harborType') || null,
    shelter: pick(o, 'shelter', 'SHELTER', 'harborShelter') || null,
    channel_depth_m: num(o, 'channel_depth_m', 'CHDEPTH', 'channelDepth'),
    repairs: pick(o, 'repairs', 'REPAIRS', 'repairCode') || null,
    latitude: lat,
    longitude: lon,
  };
}

function parseJson(text: string): PortRow[] {
  const data = JSON.parse(text);
  // Could be a bare array, or wrapped: { ports: [...] } / { data: [...] } / { features: [...] (GeoJSON) }
  let arr: any[];
  if (Array.isArray(data)) arr = data;
  else if (Array.isArray(data?.ports)) arr = data.ports;
  else if (Array.isArray(data?.data)) arr = data.data;
  else if (Array.isArray(data?.features)) {
    arr = data.features.map((f: any) => ({
      ...f.properties,
      longitude: f.geometry?.coordinates?.[0],
      latitude: f.geometry?.coordinates?.[1],
    }));
  } else {
    throw new Error('JSON: unrecognised shape (expected array, .ports, .data, or GeoJSON FeatureCollection)');
  }
  return arr.map(rowFromObject).filter((r): r is PortRow => r !== null);
}

function parseCsv(csv: string): PortRow[] {
  const lines = csv.split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]);
  const rows: PortRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cells = parseCsvLine(lines[i]);
    const obj: Record<string, string> = {};
    header.forEach((h, j) => { obj[h.trim()] = (cells[j] ?? '').trim(); });
    const row = rowFromObject(obj);
    if (row) rows.push(row);
  }
  return rows;
}

async function discoverWpiUrl(): Promise<string> {
  const res = await fetch(NGA_METADATA_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`NGA metadata HTTP ${res.status}`);
  const json = await res.json();
  // Defensive — try several response shapes.
  const candidates: any[] = [];
  if (Array.isArray(json?.publications)) candidates.push(...json.publications);
  if (Array.isArray(json)) candidates.push(...json);
  for (const pub of candidates) {
    const files = pub?.files || pub?.publications || pub?.downloads || [];
    for (const f of files) {
      const name = String(f?.fileName || f?.name || '').toLowerCase();
      const url = f?.downloadUrl || f?.fullFilename || f?.url || f?.href;
      if (url && (name.includes('pub150') || name.includes('wpi'))) {
        return String(url);
      }
    }
  }
  throw new Error('could not auto-discover WPI download URL — pass ?url=... or set WPI_DOWNLOAD_URL');
}

async function handle(req: NextRequest) {
  if (!checkAuth(req)) return unauthorized();
  const startedAt = Date.now();

  try {
    const queryUrl = req.nextUrl.searchParams.get('url');
    const envUrl = process.env.WPI_DOWNLOAD_URL;
    const url = queryUrl || envUrl || (await discoverWpiUrl());

    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`download HTTP ${res.status} for ${url}`);
    const text = await res.text();
    const trimmed = text.trimStart();
    const isJson = trimmed.startsWith('[') || trimmed.startsWith('{');
    const rows = isJson ? parseJson(text) : parseCsv(text);
    if (rows.length === 0) throw new Error('parsed 0 rows — check source format');

    const supabase = createServerSupabase();
    const CHUNK = 500;
    let upserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const batch = rows.slice(i, i + CHUNK);
      const { error, count } = await supabase
        .from('ports')
        .upsert(batch, { onConflict: 'id', count: 'exact' });
      if (error) throw new Error(`supabase upsert (chunk ${i}): ${error.message}`);
      upserted += count ?? batch.length;
    }

    return NextResponse.json({
      ok: true,
      source_url: url,
      format: isJson ? 'json' : 'csv',
      parsed: rows.length,
      upserted,
      elapsed_ms: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: err.message,
        hint: 'pass ?url=<csv-or-json-url> to bypass auto-discovery, or set WPI_DOWNLOAD_URL',
        elapsed_ms: Date.now() - startedAt,
      },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
