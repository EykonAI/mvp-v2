import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getServerSupabase } from '@/lib/auth/session';
import {
  ChannelType,
  generateVerificationCode,
  sendEmailVerificationCode,
  sendSmsVerificationCode,
  verificationExpiresAt,
} from '@/lib/notifications/channel-verification';

// POST /api/notifications/channels/[id]/resend
//
// Regenerates a fresh verification code, replaces the existing one
// on the row, and re-sends through the same provider. Server-side
// rate limit: at most one resend every 60 seconds per row, so a user
// who hammers the button can't burn Twilio / Resend send budget.

export const dynamic = 'force-dynamic';

const RESEND_THROTTLE_SECONDS = 60;

export async function POST(_req: NextRequest, ctx: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const supabase = getServerSupabase();
  const { data: channel, error: readError } = await supabase
    .from('user_channels')
    .select('id, channel_type, handle, verified_at, verification_expires_at')
    .eq('id', ctx.params.id)
    .single();
  if (readError || !channel) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (channel.verified_at) {
    return NextResponse.json({ error: 'already_verified' }, { status: 409 });
  }

  // Throttle: a brand-new code was issued less than RESEND_THROTTLE_SECONDS
  // ago. The existing expires_at is "now + 10 min" at issue time, so
  // anything within 9 min of that is a recent code.
  if (channel.verification_expires_at) {
    const issuedAtMs =
      new Date(channel.verification_expires_at).getTime() - 10 * 60_000;
    const elapsedSec = (Date.now() - issuedAtMs) / 1000;
    if (elapsedSec < RESEND_THROTTLE_SECONDS) {
      const retryAfter = Math.ceil(RESEND_THROTTLE_SECONDS - elapsedSec);
      return NextResponse.json(
        { error: 'rate_limited', retryAfterSeconds: retryAfter },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } },
      );
    }
  }

  const code = generateVerificationCode();
  const { error: updateError } = await supabase
    .from('user_channels')
    .update({
      verification_code: code,
      verification_expires_at: verificationExpiresAt().toISOString(),
    })
    .eq('id', channel.id);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const send =
    (channel.channel_type as ChannelType) === 'email'
      ? await sendEmailVerificationCode(channel.handle, code)
      : await sendSmsVerificationCode(channel.handle, code);

  if (!send.ok) {
    return NextResponse.json({ ok: false, sendError: send.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true, provider: send.provider });
}
