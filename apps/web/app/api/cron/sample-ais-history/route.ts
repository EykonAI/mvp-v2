import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// sample-ais-history · hourly cron (Railway: 5 * * * *).
//
// vessel_positions is a one-row-per-vessel CURRENT snapshot — every
// ingest overwrites the previous fix, so history is thrown away. This
// cron copies the snapshot rows of the profiled shadow-fleet vessels
// (vessel_profiles, ~2,048 mmsi) into ais_position_history (mig 078)
// once an hour, keyed on (mmsi, recorded_at) with recorded_at =
// updated_at ?? ingested_at: a vessel whose position has not refreshed
// since the last run produces a duplicate key and is skipped
// (ignoreDuplicates), so the table stores one row per actual fix.
//
// Retention is enforced by the daily derive-port-calls cron, which
// prunes rows older than 90 days (~4.4M rows / ~2 GB steady state).
// Auth: Bearer <CRON_SECRET>.

const PROFILE_PAGE = 1000;
const POSITION_CHUNK = 400;
const UPSERT_BATCH = 1000;

export async function POST(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const supabase = createServerSupabase();

  // 1. All profiled vessels (paginate — ~2k rows today, may grow).
  const mmsis: string[] = [];
  for (let from = 0; ; from += PROFILE_PAGE) {
    const { data, error } = await supabase
      .from('vessel_profiles')
      .select('mmsi')
      .order('mmsi')
      .range(from, from + PROFILE_PAGE - 1);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    mmsis.push(...data.map(r => r.mmsi));
    if (data.length < PROFILE_PAGE) break;
  }
  if (mmsis.length === 0) {
    return NextResponse.json({ ok: true, profiles: 0, sampled: 0, inserted_estimate: 0, note: 'no profiled vessels' });
  }

  // 2. Their current snapshot rows, in .in() chunks.
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < mmsis.length; i += POSITION_CHUNK) {
    const { data, error } = await supabase
      .from('vessel_positions')
      .select('mmsi, latitude, longitude, speed, heading, nav_status, destination, updated_at, ingested_at')
      .in('mmsi', mmsis.slice(i, i + POSITION_CHUNK));
    if (error) {
      return NextResponse.json({ ok: false, error: error.message, at_chunk: i }, { status: 500 });
    }
    for (const p of data ?? []) {
      const recordedAt = p.updated_at ?? p.ingested_at;
      if (!recordedAt) continue; // no usable position timestamp
      rows.push({
        mmsi: p.mmsi,
        latitude: p.latitude,
        longitude: p.longitude,
        speed: p.speed,
        heading: p.heading,
        nav_status: p.nav_status,
        destination: p.destination,
        recorded_at: recordedAt,
      });
    }
  }

  // 3. Insert, silently skipping fixes we already hold. With
  // ignoreDuplicates (ON CONFLICT DO NOTHING) .select() returns only
  // the rows actually inserted, giving an exact new-fix count.
  let inserted = 0;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const { data, error } = await supabase
      .from('ais_position_history')
      .upsert(rows.slice(i, i + UPSERT_BATCH), {
        onConflict: 'mmsi,recorded_at',
        ignoreDuplicates: true,
      })
      .select('mmsi');
    if (error) {
      return NextResponse.json({ ok: false, error: error.message, sampled: rows.length, inserted_estimate: inserted }, { status: 500 });
    }
    inserted += data?.length ?? 0;
  }

  return NextResponse.json({
    ok: true,
    profiles: mmsis.length,
    sampled: rows.length,
    inserted_estimate: inserted,
  });
}
