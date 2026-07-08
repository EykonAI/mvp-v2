import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// derive-port-calls · daily cron (Railway: 40 1 * * *).
//
// 1. Calls the derive_port_calls(p_since) SQL function (mig 078) over
//    a 25h window — samples in ais_position_history moving < 0.5 kn
//    within 3 km of a WPI port become port_calls episodes; calls that
//    continue across the window boundary are extended, new ones
//    inserted. The 1h overlap over the 24h cadence means no sample is
//    missed between runs (the function is idempotent on re-derivation).
// 2. Prunes ais_position_history to its 90-day retention window.
//
// Auth: Bearer <CRON_SECRET>.

const WINDOW_HOURS = 25;
const RETENTION_DAYS = 90;

export async function POST(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const supabase = createServerSupabase();
  const since = new Date(Date.now() - WINDOW_HOURS * 3600_000).toISOString();

  const { data: derived, error: rpcErr } = await supabase.rpc('derive_port_calls', { p_since: since });
  if (rpcErr) {
    return NextResponse.json({ ok: false, error: rpcErr.message, step: 'derive_port_calls' }, { status: 500 });
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 3600_000).toISOString();
  const { error: pruneErr } = await supabase
    .from('ais_position_history')
    .delete()
    .lt('recorded_at', cutoff);

  return NextResponse.json({
    ok: true,
    since,
    derived, // { episodes, extended, inserted } from the SQL function
    pruned_before: cutoff,
    prune: pruneErr ? `error: ${pruneErr.message}` : 'ok',
  });
}
