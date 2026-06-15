import { NextRequest, NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { createServerSupabase } from '@/lib/supabase-server';
import { ensureEventRoom } from '@/lib/comm/rooms';

// COMM D2 · spawn-event-rooms — opens one discussion room per recent
// high-signal convergence_events row (the curated "anomaly-of-anomalies"
// signal that backs the ConvergenceBadge). Convergences are rare by
// design, so this rooms only a handful at most. Idempotent via
// ensureEventRoom (partial unique index on the source event), so it is
// safe to run on any cadence. Schedule on Railway with header
// `Authorization: Bearer <CRON_SECRET>` (hand-off) — modelled on the
// existing detect-* crons.

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const LOOKBACK_DAYS = 14;
const BATCH = 50;

interface ConvergenceRow {
  id: string;
  synthesis: string | null;
  location: string | null;
}

export async function POST(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const supabase = createServerSupabase();
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();

  const { data, error } = await supabase
    .from('convergence_events')
    .select('id, synthesis, location')
    .gt('created_at', since)
    .order('created_at', { ascending: false })
    .limit(BATCH);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const events = (data as ConvergenceRow[] | null) ?? [];
  let created = 0;
  let existing = 0;
  for (const ev of events) {
    const res = await ensureEventRoom(supabase, 'convergence', ev.id, roomTitle(ev));
    if (!res) continue;
    if (res.created) created += 1;
    else existing += 1;
  }

  return NextResponse.json({ ok: true, scanned: events.length, created, existing });
}

function roomTitle(ev: ConvergenceRow): string {
  const s = (ev.synthesis ?? '').trim();
  if (s) return s.length > 90 ? `${s.slice(0, 88).trimEnd()}…` : s;
  return `Convergence ${ev.location ?? ''}`.trim() || 'Convergence event';
}
