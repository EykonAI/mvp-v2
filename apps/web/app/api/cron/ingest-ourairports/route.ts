import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

// One-shot ingestion of the OurAirports CSV (~67k rows). Free, no auth.
// CSV is regenerated daily from a community-maintained data set.
//
// Auth: Bearer <CRON_SECRET>  OR  ?secret=<CRON_SECRET>.
// Override source URL via ?url=... or OURAIRPORTS_URL env var (e.g. for
// pinning to a specific git ref during incident).
//
// Idempotent — uses ON CONFLICT (id) DO UPDATE so re-runs refresh in place.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DEFAULT_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';

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

// RFC 4180 CSV parser — handles quoted fields, embedded commas/quotes via "".
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

type AirportRow = {
  id: string;
  ident: string;
  type: string;
  name: string;
  latitude: number;
  longitude: number;
  elevation_ft: number | null;
  iso_country: string | null;
  municipality: string | null;
  scheduled_service: boolean;
  iata_code: string | null;
  icao_code: string | null;
};

async function handle(req: NextRequest) {
  if (!checkAuth(req)) return unauthorized();
  const startedAt = Date.now();

  try {
    const url =
      req.nextUrl.searchParams.get('url') ||
      process.env.OURAIRPORTS_URL ||
      DEFAULT_URL;

    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`download HTTP ${res.status} for ${url}`);
    const csv = await res.text();
    const lines = csv.split('\n');
    if (lines.length < 2) throw new Error('CSV body has no rows');

    const header = parseCsvLine(lines[0]);
    const idx: Record<string, number> = {};
    header.forEach((h, i) => { idx[h.trim()] = i; });
    const need = [
      'id', 'ident', 'type', 'name',
      'latitude_deg', 'longitude_deg', 'elevation_ft',
      'iso_country', 'municipality', 'scheduled_service',
      'iata_code', 'gps_code',
    ];
    for (const k of need) {
      if (!(k in idx)) throw new Error(`OurAirports CSV missing expected column: ${k}`);
    }

    const rows: AirportRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const c = parseCsvLine(line);
      const lat = parseFloat(c[idx.latitude_deg]);
      const lon = parseFloat(c[idx.longitude_deg]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
      const id = (c[idx.id] || '').trim();
      if (!id) continue;
      const elev = parseInt(c[idx.elevation_ft]);
      const iso = (c[idx.iso_country] || '').trim().slice(0, 2);
      rows.push({
        id,
        ident: (c[idx.ident] || '').trim(),
        type: (c[idx.type] || '').trim(),
        name: (c[idx.name] || '').trim(),
        latitude: lat,
        longitude: lon,
        elevation_ft: Number.isFinite(elev) ? elev : null,
        iso_country: iso || null,
        municipality: (c[idx.municipality] || '').trim() || null,
        scheduled_service: c[idx.scheduled_service] === 'yes',
        iata_code: (c[idx.iata_code] || '').trim() || null,
        icao_code: (c[idx.gps_code] || '').trim() || null,
      });
    }

    if (rows.length === 0) throw new Error('parsed 0 rows from CSV');

    const supabase = createServerSupabase();
    const CHUNK = 500;
    let upserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const batch = rows.slice(i, i + CHUNK);
      const { error, count } = await supabase
        .from('airports')
        .upsert(batch, { onConflict: 'id', count: 'exact' });
      if (error) throw new Error(`supabase upsert (chunk ${i}): ${error.message}`);
      upserted += count ?? batch.length;
    }

    return NextResponse.json({
      ok: true,
      source_url: url,
      parsed: rows.length,
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
