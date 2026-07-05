import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { isFounder } from '@/lib/admin/access';
import { createServerSupabase } from '@/lib/supabase-server';
import { EXTENSION_MONTHS } from '@/lib/comm/foundingPartner';

// Founder-gated partner lifecycle actions:
//   gate    active|warned → gated (manual override; the cron also gates
//           automatically past the deadline)
//   extend  warned|gated → active, deadline +3 months, once ever
//   revoke  for cause: deletes the partnership AND its bundled
//           free-50 Creator Pro grant. Spaces/subscribers untouched —
//           the standard calibrated gate simply applies again.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user || !isFounder(user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const admin = createServerSupabase();
  const { data: row } = await admin
    .from('founding_partners')
    .select('user_id, status, extended_once, note_deadline')
    .eq('user_id', params.id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (body.action === 'gate') {
    if (row.status !== 'active' && row.status !== 'warned') {
      return NextResponse.json({ error: `Cannot gate a ${row.status} partner` }, { status: 409 });
    }
    const { error } = await admin
      .from('founding_partners')
      .update({ status: 'gated' })
      .eq('user_id', params.id)
      .eq('status', row.status);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, status: 'gated' });
  }

  if (body.action === 'extend') {
    if (row.extended_once) {
      return NextResponse.json({ error: 'Already extended once — the Terms allow one extension.' }, { status: 409 });
    }
    if (row.status !== 'warned' && row.status !== 'gated') {
      return NextResponse.json({ error: `Cannot extend a ${row.status} partner` }, { status: 409 });
    }
    const base = new Date(Math.max(Date.parse(row.note_deadline), Date.now()));
    base.setUTCMonth(base.getUTCMonth() + EXTENSION_MONTHS);
    const { error } = await admin
      .from('founding_partners')
      .update({ status: 'active', extended_once: true, note_deadline: base.toISOString() })
      .eq('user_id', params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await admin.from('notification_queue').insert({
      user_id: params.id,
      channel: 'email',
      title: 'Your Founding Partner deadline was extended',
      body: `New Reputation-Note deadline: ${base.toISOString().slice(0, 10)}. The First Ten templates get you there in weeks.`,
      payload: { template: 'founding_partner_extended' },
    });
    return NextResponse.json({ ok: true, status: 'active', note_deadline: base.toISOString() });
  }

  if (body.action === 'revoke') {
    const { error } = await admin.from('founding_partners').delete().eq('user_id', params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    // Withdraw the bundled Creator Pro grant only if it came from the
    // free-50 pool (a later PAID grant is the partner's own).
    await admin
      .from('creator_pro_grants')
      .delete()
      .eq('user_id', params.id)
      .eq('source', 'free50');
    return NextResponse.json({ ok: true, revoked: true });
  }

  return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
}
