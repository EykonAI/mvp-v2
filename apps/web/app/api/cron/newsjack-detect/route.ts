import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { runDetectTick } from '@/lib/newsjack/engine';

// newsjack-detect · hourly cron (Newsjacking SOP layers 1–3 + alert).
// Detect a fresh, high-enough anomaly_flag → package the evidence (one sourced
// analyst line) → draft the X thread → lint + value-test → store, then alert
// the founder for any draft that passes. This route NEVER publishes; approval
// is one tap in /admin/newsjack.
//
// Kill switch: NEWSJACK_ENABLED must be on/true/1, else the tick no-ops.
// Auth: Bearer <CRON_SECRET>.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function enabled(): boolean {
  const v = (process.env.NEWSJACK_ENABLED ?? '').toLowerCase();
  return v === 'on' || v === 'true' || v === '1';
}

export async function POST(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  if (!enabled()) {
    return NextResponse.json({ skipped: 'NEWSJACK_ENABLED is off' });
  }

  const supabase = createServerSupabase();
  const result = await runDetectTick(supabase);
  return NextResponse.json({ ranAt: new Date().toISOString(), ...result });
}
