import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase-server';
import { isFounder } from '@/lib/admin/access';
import {
  canTransition,
  timestampUpdatesFor,
} from '@/lib/admin/advocate-transitions';
import { sendAdvocateInvitation, sendAdvocateWelcome } from '@/lib/email/send';
import type { AdvocateState } from '@/lib/auth/session';

// POST /api/admin/advocates/transition
// Founder-only. Moves a user along the advocate state machine and
// fires the corresponding side effects (templated email on
// none→invited and on invited→active; nothing on the other transitions).
//
// Body: { user_id: <uuid>, to: 'invited' | 'active' | 'paused' | 'terminated' | 'none' }
// Response: { ok: true, advocate_state: <new state> }
//
// Rewardful affiliate creation is intentionally NOT done here — that
// is PR 7's territory and gates on Rewardful campaign config. This
// route only changes eYKON-side state and sends emails.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VALID_TARGETS: ReadonlyArray<AdvocateState> = [
  'none',
  'invited',
  'active',
  'paused',
  'terminated',
];

type Body = { user_id?: string; to?: string };

export async function POST(req: NextRequest) {
  const caller = await getCurrentUser();
  if (!caller || !isFounder(caller)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!body.user_id || !body.to || !(VALID_TARGETS as readonly string[]).includes(body.to)) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const to = body.to as AdvocateState;

  const admin = createServerSupabase();

  const { data: target, error: lookupErr } = await admin
    .from('user_profiles')
    .select('id, email, display_name, advocate_state')
    .eq('id', body.user_id)
    .maybeSingle();

  if (lookupErr) {
    return NextResponse.json({ error: lookupErr.message }, { status: 500 });
  }
  if (!target) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const from = (target as { advocate_state: AdvocateState }).advocate_state;
  if (!canTransition(from, to)) {
    return NextResponse.json(
      { error: 'invalid_transition', from, to },
      { status: 400 },
    );
  }

  const nowIso = new Date().toISOString();
  const update: Record<string, string | null> = {
    advocate_state: to,
    ...timestampUpdatesFor(to, nowIso),
  };

  const { error: updateErr } = await admin
    .from('user_profiles')
    .update(update)
    .eq('id', body.user_id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // Side-effect: invitation email on none→invited; welcome on
  // invited→active. The other transitions (paused/terminated/etc.)
  // are silent — the founder communicates those out-of-band.
  const targetEmail = (target as { email: string | null }).email;
  const targetName = (target as { display_name: string | null }).display_name;
  if (targetEmail) {
    if (from === 'none' && to === 'invited') {
      await sendAdvocateInvitation({
        to: targetEmail,
        userId: body.user_id,
        displayName: targetName,
        partnershipDocUrl: process.env.PARTNERSHIP_DOC_URL ?? null,
      }).catch((err) => console.error('[advocate.invitation.email]', err));
    } else if (from === 'invited' && to === 'active') {
      await sendAdvocateWelcome({
        to: targetEmail,
        userId: body.user_id,
        displayName: targetName,
        // Rewardful payout-setup link is generated in PR 7 alongside
        // the affiliate-creation API call. Until then, the welcome
        // email points at a placeholder when configured, or omits
        // the link entirely.
        rewardfulPayoutSetupUrl: process.env.REWARDFUL_PAYOUT_SETUP_URL ?? null,
        channelUrl: process.env.ADVOCATE_CHANNEL_URL ?? null,
      }).catch((err) => console.error('[advocate.welcome.email]', err));
    }
  }

  return NextResponse.json({ ok: true, advocate_state: to });
}
