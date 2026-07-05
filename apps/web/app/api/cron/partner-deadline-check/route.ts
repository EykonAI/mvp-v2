import { NextRequest, NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { createServerSupabase } from '@/lib/supabase-server';
import { hasShownNote, WARN_AT_MONTHS } from '@/lib/comm/foundingPartner';

// Founding Partner lifecycle (mig 076, build-prompt §6). Weekly on
// Railway with Authorization: Bearer CRON_SECRET. Per partner, in
// priority order:
//   1. shown Note exists           → 'graduated' (terminal) + congrats
//   2. past deadline, no Note      → 'gated' + email (Discover +
//      new-subscriber pause take effect immediately via the reads)
//   3. past month 4, still active  → 'warned' + email
// Everything the cron does is reversible by graduation on a later
// pass; nothing here touches subscribers, revenue, or badges.

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const admin = createServerSupabase();
  const { data, error } = await admin
    .from('founding_partners')
    .select('user_id, granted_at, note_deadline, status')
    .neq('status', 'graduated');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const now = Date.now();
  let graduated = 0;
  let gated = 0;
  let warned = 0;

  for (const p of data ?? []) {
    if (await hasShownNote(admin, p.user_id)) {
      await admin.from('founding_partners').update({ status: 'graduated' }).eq('user_id', p.user_id);
      await admin.from('notification_queue').insert({
        user_id: p.user_id,
        channel: 'email',
        title: 'Your Reputation Note is live — Founding Partner graduated',
        body: 'Ten resolved calls, non-negative skill: your Note now speaks for itself. Nothing else changes — your Space, subscribers and badges are exactly as they were.',
        payload: { template: 'founding_partner_graduated' },
      });
      graduated++;
      continue;
    }

    const deadline = Date.parse(p.note_deadline);
    if (now > deadline && p.status !== 'gated') {
      await admin.from('founding_partners').update({ status: 'gated' }).eq('user_id', p.user_id);
      await admin.from('notification_queue').insert({
        user_id: p.user_id,
        channel: 'email',
        title: 'Founding Partner deadline passed — Space paused for new subscribers',
        body: 'Your Reputation Note deadline has passed. Your Space keeps every existing subscriber and all revenue; it pauses for NEW subscribers and leaves Discover until your Note is live (10 resolved calls, skill ≥ 0). The First Ten templates are the fastest path back.',
        payload: { template: 'founding_partner_gated' },
      });
      gated++;
      continue;
    }

    const warnAt = new Date(p.granted_at);
    warnAt.setUTCMonth(warnAt.getUTCMonth() + WARN_AT_MONTHS);
    if (now > warnAt.getTime() && p.status === 'active') {
      const daysLeft = Math.max(Math.ceil((deadline - now) / 86_400_000), 0);
      await admin.from('founding_partners').update({ status: 'warned' }).eq('user_id', p.user_id);
      await admin.from('notification_queue').insert({
        user_id: p.user_id,
        channel: 'email',
        title: `Founding Partner check-in — ${daysLeft} days to your Reputation Note`,
        body: 'A reminder from the Terms: ten resolved sealed calls with non-negative skill unlock your Note. The First Ten templates resolve in days, not months — you can still make this comfortably.',
        payload: { template: 'founding_partner_warned', days_left: daysLeft },
      });
      warned++;
    }
  }

  return NextResponse.json({ checked: data?.length ?? 0, graduated, gated, warned });
}
