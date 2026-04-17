import { NextRequest, NextResponse } from 'next/server';
import AdmZip from 'adm-zip';
import { createServerSupabase } from '@/lib/supabase-server';

// This route pulls the latest 15-minute GDELT 2.0 Events export,
// filters down to conflict-relevant event types (CAMEO root codes
// 14=Protest, 18=Assault, 19=Fight, 20=Use of unconventional mass violence),
// and upserts into Supabase's conflict_events table.
//
// Designed to be called by a scheduled trigger every 15 minutes.
// Auth: Bearer <CRON_SECRET>  OR  ?secret=<CRON_SECRET>.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const LASTUPDATE_URL = 'http://data.gdeltproject.org/gdeltv2/lastupdate.txt';

// CAMEO event root code -> human-readable event_type label
const CONFLICT_ROOT_CODES: Record<string, string> = {
  '14': 'Protest',
  '18': 'Assault',
  '19': 'Fight',
  '20': 'Mass violence',
};

// GDELT 2.0 export.CSV column indexes (0-based), per the v2 codebook.
const COL = {
  GLOBALEVENTID: 0,
  SQLDATE: 1,
  Actor1Name: 6,
  Actor2Name: 16,
  EventRootCode: 28,
  NumMentions: 31,
  AvgTone: 34,
  ActionGeo_CountryCode: 53,
  ActionGeo_Lat: 56,
  ActionGeo_Long: 57,
  SOURCEURL: 60,
} as const;

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

// lastupdate.txt format: three lines, one per file kind (export, mentions, gkg).
// Each line: "<size> <md5> <url>".  We want the export line.
async function resolveLatestExportUrl(): Promise<string> {
  const res = await fetch(LASTUPDATE_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`lastupdate.txt HTTP ${res.status}`);
  const text = await res.text();
  const exportLine = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.includes('.export.CSV.zip'));
  if (!exportLine) throw new Error('no export line in lastupdate.txt');
  const url = exportLine.split(/\s+/).pop();
  if (!url) throw new Error('could not parse export URL');
  return url;
}

async function downloadZip(url: string): Promise<Buffer> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`download HTTP ${res.status} for ${url}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

function extractCsv(zipBuf: Buffer): string {
  const zip = new AdmZip(zipBuf);
  const entries = zip.getEntries();
  const csvEntry = entries.find((e) => e.entryName.endsWith('.CSV') || e.entryName.endsWith('.csv'));
  if (!csvEntry) throw new Error('no CSV entry in zip');
  return csvEntry.getData().toString('utf8');
}

type ConflictRow = {
  event_id: string;
  event_type: string;
  country: string | null;
  latitude: number;
  longitude: number;
  event_date: string; // YYYY-MM-DD
  actor1: string | null;
  actor2: string | null;
  fatalities: number;
  notes: string | null;
  source: 'GDELT';
};

function parseCsv(csv: string): ConflictRow[] {
  const rows: ConflictRow[] = [];
  const lines = csv.split('\n');

  for (const line of lines) {
    if (!line) continue;
    const f = line.split('\t');
    if (f.length < 61) continue;

    const rootCode = f[COL.EventRootCode];
    const eventType = CONFLICT_ROOT_CODES[rootCode];
    if (!eventType) continue;

    const latStr = f[COL.ActionGeo_Lat];
    const lonStr = f[COL.ActionGeo_Long];
    if (!latStr || !lonStr) continue;
    const lat = parseFloat(latStr);
    const lon = parseFloat(lonStr);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat === 0 && lon === 0) continue; // GDELT uses 0,0 for missing

    const sqldate = f[COL.SQLDATE];
    if (!/^\d{8}$/.test(sqldate)) continue;
    const eventDate = `${sqldate.slice(0, 4)}-${sqldate.slice(4, 6)}-${sqldate.slice(6, 8)}`;

    const id = f[COL.GLOBALEVENTID];
    if (!id) continue;

    const mentions = parseInt(f[COL.NumMentions] || '0') || 0;
    const tone = parseFloat(f[COL.AvgTone] || '0') || 0;

    rows.push({
      event_id: `GDELT-${id}`,
      event_type: eventType,
      country: (f[COL.ActionGeo_CountryCode] || '').trim() || null,
      latitude: lat,
      longitude: lon,
      event_date: eventDate,
      actor1: (f[COL.Actor1Name] || '').trim() || null,
      actor2: (f[COL.Actor2Name] || '').trim() || null,
      fatalities: 0, // GDELT doesn't provide casualty counts directly
      notes: f[COL.SOURCEURL] || `mentions=${mentions}, tone=${tone.toFixed(2)}`,
      source: 'GDELT',
    });
  }

  return rows;
}

async function upsertInChunks(rows: ConflictRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const supabase = createServerSupabase();
  const CHUNK = 500;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    const { error, count } = await supabase
      .from('conflict_events')
      .upsert(batch, { onConflict: 'event_id', ignoreDuplicates: true, count: 'exact' });
    if (error) throw new Error(`supabase upsert: ${error.message}`);
    inserted += count ?? 0;
  }
  return inserted;
}

async function handle(req: NextRequest) {
  if (!checkAuth(req)) return unauthorized();

  const startedAt = Date.now();
  try {
    const exportUrl = await resolveLatestExportUrl();
    const zipBuf = await downloadZip(exportUrl);
    const csv = extractCsv(zipBuf);
    const rows = parseCsv(csv);
    const inserted = await upsertInChunks(rows);

    return NextResponse.json({
      ok: true,
      source_url: exportUrl,
      parsed: rows.length,
      inserted,
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

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
