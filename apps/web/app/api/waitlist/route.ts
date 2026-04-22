import { NextResponse, type NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { createServerSupabase } from '@/lib/supabase-server';
import { isValidReferralCode } from '@/lib/auth/referral';

export const dynamic = 'force-dynamic';

/**
 * POST /api/waitlist
 *
 * Body: { email: string; tier: 'pro' | 'enterprise'; note?: string; consent: boolean }
 *
 * Stores a fiat waitlist signup. Phase C (Resend) will send a confirmation
 * email and mark `confirmed_email=true` via a double-opt-in link. Phase D
 * (Rewardful) will attach the referral cookie.
 *
 * On duplicate (same email + tier already present), returns 200 with
 * `already_on_waitlist: true` so the frontend treats it as a no-op success.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const tier = typeof b.tier === 'string' ? b.tier.trim().toLowerCase() : '';
  const note = typeof b.note === 'string' ? b.note.slice(0, 500) : null;
  const consent = b.consent === true || b.consent === 'on';
  const referralRaw =
    typeof b.referral_code === 'string' ? b.referral_code.trim().toLowerCase() : null;
  const referralCode = isValidReferralCode(referralRaw) ? referralRaw : null;

  // Minimal validation — frontend does the heavy lifting; here we enforce
  // only what the database CHECK constraints also enforce.
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
  }
  if (tier !== 'pro' && tier !== 'enterprise') {
    return NextResponse.json({ error: 'tier must be pro or enterprise.' }, { status: 400 });
  }
  if (!consent) {
    return NextResponse.json(
      { error: 'Consent is required to join the waitlist.' },
      { status: 400 },
    );
  }

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    '';
  const ipHash = ip
    ? crypto.createHash('sha256').update(ip).digest('hex').slice(0, 24)
    : null;
  const userAgent = request.headers.get('user-agent')?.slice(0, 200) ?? null;

  const admin = createServerSupabase();

  const { data, error } = await admin
    .from('fiat_waitlist')
    .insert({
      email,
      tier,
      note,
      referral_code: referralCode,
      ip_hash: ipHash,
      user_agent: userAgent,
    })
    .select('id, created_at')
    .single();

  if (error) {
    // 23505 = unique_violation (email+tier pair already on the list).
    if (error.code === '23505') {
      return NextResponse.json({ already_on_waitlist: true }, { status: 200 });
    }
    console.error('[waitlist] insert failed', error.message);
    return NextResponse.json({ error: 'Could not record waitlist entry.' }, { status: 500 });
  }

  // TODO (Phase C): enqueue a confirmation email via notification_queue.
  return NextResponse.json({
    ok: true,
    id: data.id,
    created_at: data.created_at,
  });
}
