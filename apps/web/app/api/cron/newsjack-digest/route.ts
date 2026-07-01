import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { buildDigest, deliverDigest } from '@/lib/newsjack/digest';

// newsjack-digest · weekly cron (Newsjacking SOP layer 6). Summarises the
// pipeline + the newsjack-attributed conversion signal and posts it to the
// digest/alert webhook. Read-only over the newsjack + attribution tables.
// Auth: Bearer <CRON_SECRET>.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const supabase = createServerSupabase();
  const digest = await buildDigest(supabase, 7);
  const delivered = await deliverDigest(digest.text);
  return NextResponse.json({ ranAt: new Date().toISOString(), delivered, ...digest });
}
