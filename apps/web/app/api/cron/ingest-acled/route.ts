import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { fetchAcledEvents, type AcledRawEvent } from '@/lib/acled/client';

// ACLED conflict-event ingest → conflict_events (source='ACLED').
//
// The trusted-ground-truth counterpart to ingest-gdelt. ACLED is
// human-curated and precisely geocoded, carries REAL fatality counts,
// and writes FULL country names ("Ukraine", not GDELT's FIPS "UP") —
// so query_conflicts(country="Ukraine") starts matching the moment
// these rows land.
//
// PR1 is ADDITIVE and DARK: it writes ACLED rows alongside GDELT into
// the same table, source-tagged, and changes NO consumer. Nothing that
// reads conflict_events is repointed here — the detector, baselines and
// proximity ranking keep behaving exactly as before. This is the safe,
// reversible first landing; the trust cutover (surfaces filtering
// source='ACLED', detector/baseline windowing on event_date) is PR2.
//
// Cadence: ACLED is weekly-curated (some regions near-real-time), NOT a
// live feed — schedule this daily and do not label it "real-time". A
// trailing lookback re-fetches late-coded events; the upsert de-dupes
// on event_id.
//
// Auth: Bearer <CRON_SECRET>  OR  ?secret=<CRON_SECRET>.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Trailing window (days) to re-fetch on each run, so late-coded events
// backfilled into earlier days are still picked up. Env-overridable.
const INGEST_DAYS = Number(process.env.ACLED_INGEST_DAYS ?? 8);

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
  source: 'ACLED';
};

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Map an ACLED event to a conflict_events row. Returns null for rows we
// cannot place on the map (no usable coordinates or id) rather than
// writing a degenerate point.
function toRow(e: AcledRawEvent): ConflictRow | null {
  const id = e.event_id_cnty ?? (e.data_id != null ? String(e.data_id) : '');
  if (!id) return null;

  const lat = typeof e.latitude === 'number' ? e.latitude : parseFloat(e.latitude ?? '');
  const lon = typeof e.longitude === 'number' ? e.longitude : parseFloat(e.longitude ?? '');
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat === 0 && lon === 0) return null;

  const eventDate = (e.event_date ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return null;

  const fatalities =
    typeof e.fatalities === 'number' ? e.fatalities : parseInt(e.fatalities ?? '0', 10) || 0;

  // event_type is ACLED's already-human-readable label; keep the finer
  // sub_event_type in notes so nothing is lost by the coarser column.
  const notesParts = [
    e.sub_event_type ? `[${e.sub_event_type}]` : null,
    (e.notes ?? '').trim() || null,
  ].filter(Boolean);

  return {
    event_id: `ACLED-${id}`,
    event_type: (e.event_type ?? '').trim() || 'Conflict',
    country: (e.country ?? '').trim() || null, // FULL name — this is the country-filter fix
    latitude: lat,
    longitude: lon,
    event_date: eventDate,
    actor1: (e.actor1 ?? '').trim() || null,
    actor2: (e.actor2 ?? '').trim() || null,
    fatalities,
    notes: notesParts.join(' ') || null,
    source: 'ACLED',
  };
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
  const since = ymd(new Date(startedAt - INGEST_DAYS * 86_400_000));
  try {
    const { events, mode, pages } = await fetchAcledEvents(since);
    const rows: ConflictRow[] = [];
    let skipped = 0;
    for (const e of events) {
      const row = toRow(e);
      if (row) rows.push(row);
      else skipped++;
    }
    const inserted = await upsertInChunks(rows);

    return NextResponse.json({
      ok: true,
      auth_mode: mode, // 'oauth2' | 'legacy' — confirms which credential path worked
      since,
      pages,
      fetched: events.length,
      mapped: rows.length,
      skipped_no_geo_or_id: skipped,
      inserted, // NEW rows only; re-runs over the window → 0 (upsert de-dupes)
      elapsed_ms: Date.now() - startedAt,
      timestamp: new Date(startedAt).toISOString(),
    });
  } catch (err: any) {
    // Fail loud (non-2xx) so `curl -fsS` marks the Railway run red rather
    // than reporting green on a broken pipeline.
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err), since, elapsed_ms: Date.now() - startedAt },
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
