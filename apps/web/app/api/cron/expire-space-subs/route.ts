import { NextRequest, NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { createServerSupabase } from '@/lib/supabase-server';

// COMM E2 — expire-space-subs. Flips active space subscriptions past their
// expires_at to 'expired' and revokes the subscriber's room membership, so
// access ends when a subscription lapses. (On-chain key validity is the
// source of truth at access time in E2b; this keeps the DB in step and
// cleans up membership.) Schedule on Railway with Authorization: Bearer
// CRON_SECRET. No-op until subscriptions exist.

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const supabase = createServerSupabase();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('comm_space_subscriptions')
    .select('id, space_id, subscriber_id')
    .eq('status', 'active')
    .not('expires_at', 'is', null)
    .lt('expires_at', now)
    .limit(500);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const rows = (data as { id: string; space_id: string; subscriber_id: string }[] | null) ?? [];
  let expired = 0;
  for (const s of rows) {
    const { error: uErr } = await supabase
      .from('comm_space_subscriptions')
      .update({ status: 'expired' })
      .eq('id', s.id);
    if (uErr) continue;
    await supabase.from('comm_room_members').delete().eq('room_id', s.space_id).eq('user_id', s.subscriber_id);
    expired += 1;
  }

  return NextResponse.json({ ok: true, scanned: rows.length, expired });
}
