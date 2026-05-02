import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getServerSupabase } from '@/lib/auth/session';
import { getCurrentTier, tierMeetsRequirement } from '@/lib/subscription';
import {
  ChannelType,
  generateVerificationCode,
  isValidHandle,
  sendEmailVerificationCode,
  sendSmsVerificationCode,
  sendWhatsAppVerificationCode,
  verificationExpiresAt,
} from '@/lib/notifications/channel-verification';

// /api/notifications/channels — list and create channel rows.
//
//   GET   → 200 { channels: [...] }   self-rows only (RLS does the work).
//   POST  → 201 { channel: {...} }    creates an unverified row + sends
//                                     a 6-digit verification code through
//                                     the appropriate provider.
//
// Tier gate: Pro / Desk / Enterprise only. Citizens are 403'd.
// WhatsApp creation is rejected here in PR 4 — the opt-in flow + adapter
// land in PR 10.

export const dynamic = 'force-dynamic';

const CREATE_ALLOWED_TYPES: ReadonlySet<ChannelType> = new Set(['email', 'sms', 'whatsapp']);

export async function GET(_req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const tier = await getCurrentTier();
  if (!tierMeetsRequirement(tier, 'pro')) {
    return NextResponse.json({ error: 'forbidden', requiredTier: 'pro' }, { status: 403 });
  }

  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from('user_channels')
    .select('id, channel_type, handle, label, verified_at, active, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ channels: data ?? [] });
}

interface CreateBody {
  channel_type?: string;
  handle?: string;
  label?: string;
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const tier = await getCurrentTier();
  if (!tierMeetsRequirement(tier, 'pro')) {
    return NextResponse.json({ error: 'forbidden', requiredTier: 'pro' }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as CreateBody | null;
  if (!body) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const channelType = body.channel_type as ChannelType | undefined;
  const handle = (body.handle ?? '').trim();
  const label = (body.label ?? '').trim() || null;

  if (!channelType || !CREATE_ALLOWED_TYPES.has(channelType)) {
    return NextResponse.json(
      { error: 'unsupported_channel_type', allowed: Array.from(CREATE_ALLOWED_TYPES) },
      { status: 400 },
    );
  }
  if (!isValidHandle(channelType, handle)) {
    return NextResponse.json(
      {
        error: 'invalid_handle',
        hint:
          channelType === 'email'
            ? 'Expected an email address.'
            : 'Expected an E.164 phone number, e.g. +14155550123.',
      },
      { status: 400 },
    );
  }

  const code = generateVerificationCode();
  const expiresAt = verificationExpiresAt();

  const supabase = getServerSupabase();
  // RLS on user_channels enforces user_id = auth.uid(); inserting
  // user.id explicitly is belt-and-braces.
  const { data, error } = await supabase
    .from('user_channels')
    .insert({
      user_id: user.id,
      channel_type: channelType,
      handle,
      label,
      verification_code: code,
      verification_expires_at: expiresAt.toISOString(),
      active: true,
    })
    .select('id, channel_type, handle, label, verified_at, active, created_at')
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'insert_failed' }, { status: 500 });
  }

  // Fire the verification message. If sending fails we keep the row
  // (the user can hit /resend) but surface the error so the UI can
  // show a useful message instead of a silent stall.
  //
  // WhatsApp specifics: Twilio rejects the code with a 63007/21211
  // error if the recipient hasn't opted in to the sandbox or template
  // yet. The UI shows the opt-in instructions BEFORE the user submits;
  // if Twilio rejects, the user opts in and clicks Resend to retry.
  const send =
    channelType === 'email'
      ? await sendEmailVerificationCode(handle, code)
      : channelType === 'whatsapp'
      ? await sendWhatsAppVerificationCode(handle, code)
      : await sendSmsVerificationCode(handle, code);

  if (!send.ok) {
    return NextResponse.json(
      { channel: data, sendError: send.error },
      { status: 201 },
    );
  }
  return NextResponse.json({ channel: data, provider: send.provider }, { status: 201 });
}
