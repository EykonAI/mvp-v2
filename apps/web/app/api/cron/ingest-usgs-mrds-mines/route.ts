import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

// One-shot ingestion of USGS MRDS mines. The dataset is frozen at 2011 so
// this runs rarely — usually once at seed time via the local script
// (apps/web/scripts/seed-usgs-mrds-mines.mjs). This endpoint exists for
// parity with the other infra crons and lets us refresh from a stable
// URL without re-deploying.
//
// MRDS does not publish a single canonical bulk-CSV URL — the standard
// flow is: visit https://mrdata.usgs.gov/mrds/, choose a region, click
// "CSV". For automated ingestion we accept either:
//   - ?url=<csv-or-json-url>      (one-off override)
//   - USGS_MRDS_URL env var       (Railway scheduled refresh)
// The format is auto-sniffed: JSON if the body parses as JSON, otherwise
// it's treated as delimited text with delimiter inference.
//
// Auth: Bearer <CRON_SECRET>  OR  ?secret=<CRON_SECRET>.

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

function sniffDelim(headerLine: string): string {
  const tabs = (headerLine.match(/\t/g) || []).length;
  const semis = (headerLine.match(/;/g) || []).length;
  const pipes = (headerLine.match(/\|/g) || []).length;
  const commas = (headerLine.match(/,/g) || []).length;
  return [
    ['\t', tabs],
    ['|', pipes],
    [';', semis],
    [',', commas],
  ].sort((a: any, b: any) => b[1] - a[1])[0][0] as string;
}

function pick(obj: any, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s !== '') return s;
  }
  return null;
}
function pickNum(obj: any, ...keys: string[]): number | null {
  const s = pick(obj, ...keys);
  if (s === null) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

const ISO2: Record<string, string> = {
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

function rowFromObject(o: any) {
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
  const commodities = [commod1, commod2, commod3].filter(Boolean) as string[];
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

async function handle(req: NextRequest) {
  if (!checkAuth(req)) return unauthorized();
  const startedAt = Date.now();
  try {
    const url = req.nextUrl.searchParams.get('url') || process.env.USGS_MRDS_URL;
    if (!url) {
      return NextResponse.json({
        ok: false,
        error: 'no source URL provided',
        hint: 'pass ?url=<csv-or-json-url> or set USGS_MRDS_URL env var. Use the "CSV" download from https://mrdata.usgs.gov/mrds/.',
      }, { status: 400 });
    }
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`download HTTP ${res.status} for ${url}`);
    const text = await res.text();

    let objects: any[];
    // Try JSON first (some MRDS endpoints return JSON envelopes).
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) objects = parsed;
      else if (Array.isArray(parsed?.features)) objects = parsed.features.map((f: any) => ({
        ...f.properties,
        latitude: f.geometry?.coordinates?.[1],
        longitude: f.geometry?.coordinates?.[0],
      }));
      else if (Array.isArray(parsed?.records)) objects = parsed.records;
      else throw new Error('json shape');
    } catch {
      // Fall through to delimited text.
      const lines = text.split(/\r?\n/);
      if (lines.length < 2) throw new Error('not enough lines in response');
      const delim = sniffDelim(lines[0]);
      const header = parseDelimitedLine(lines[0], delim).map(h => h.trim());
      objects = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        const cells = parseDelimitedLine(line, delim);
        if (cells.length < 3) continue;
        const obj: any = {};
        header.forEach((h, j) => { obj[h] = (cells[j] ?? '').trim(); });
        objects.push(obj);
      }
    }

    const rows: any[] = [];
    let skipped = 0;
    for (const o of objects) {
      const r = rowFromObject(o);
      if (r) rows.push(r); else skipped++;
    }

    const supabase = createServerSupabase();
    const CHUNK = 1000;
    let upserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const batch = rows.slice(i, i + CHUNK);
      const { error, count } = await supabase
        .from('mines')
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
