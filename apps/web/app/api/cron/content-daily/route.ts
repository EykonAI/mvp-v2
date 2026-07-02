import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { runProactiveTick } from '@/lib/content/engine';

// content-daily · weekday cron (Proactive Content Layer). Picks one cross-feed
// angle, grounds it via the AI Analyst's live tools, drafts an X post with an
// engageable ending + a public /q link, gates it, and queues to /admin/newsjack.
// Never publishes. Gated by NEWSJACK_PROACTIVE_ENABLED; Bearer CRON_SECRET.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function enabled(): boolean {
  const v = (process.env.NEWSJACK_PROACTIVE_ENABLED ?? '').toLowerCase();
  return v === 'on' || v === 'true' || v === '1';
}

export async function POST(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;
  if (!enabled()) return NextResponse.json({ skipped: 'NEWSJACK_PROACTIVE_ENABLED is off' });

  const supabase = createServerSupabase();
  const result = await runProactiveTick(supabase);
  return NextResponse.json({ ranAt: new Date().toISOString(), ...result });
}
