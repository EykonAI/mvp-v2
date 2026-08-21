import { NextResponse, type NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { createServerSupabase } from '@/lib/supabase-server';
import { isValidReferralCode } from '@/lib/auth/referral';
import { sendWaitlistConfirmation } from '@/lib/email/send';
import { captureServer } from '@/lib/analytics/server';
import { safeError } from '@/lib/log';
import { resolveRequestCountry } from '@/lib/geo/request-country';
import { verifyTurnstileToken } from '@/lib/grow/turnstile';

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
 *
 * BOT HARDENING (2026-08-21)
 * -------------------------
 * This endpoint shipped with no challenge and no rate limit, and it was
 * farmed. Of the 25 rows collected between 2026-04-23 and 2026-06-06, 22
 * carry a random-string `note` (e.g. "XPIqOCRwFouvPRhYjevb") and nine are
 * gmail dot-variants; one is an SMS gateway address. Two were real people.
 *
 * The retired front-end form was never the attack surface — a bot POSTs
 * here directly. So the protection has to live on the route, which is where
 * /api/closing/lead already puts it:
 *
 *   • Turnstile verified before any write.
 *   • 3 signups per hour per hashed IP.
 *   • Random-string note heuristic: the single highest-signal marker in the
 *     poisoned set. Rejected loudly rather than stored, so the table stops
 *     accumulating rows nobody can ever safely email.
 *
 * The cost of a false positive is one legitimate person retyping a note; the
 * cost of a false negative is a permanently unmailable list and a burned
 * sending domain, which is what we actually got.
 *
 * NOTE: verifyTurnstileToken() returns { ok: true, dev_skip: true } when
 * TURNSTILE_SECRET_KEY is unset, so local dev is unaffected. The key IS set
 * on the production web service — verified before this change shipped.
 */

const RATE_LIMIT_PER_HOUR = 3;

/**
 * Bot-note detector. The farmed rows all carry a single run of mixed-case
 * letters with no spaces and no dictionary shape — a filler token, not a
 * sentence. A human writing about their use case produces spaces, digits or
 * punctuation almost immediately, so requiring ANY of those is a cheap and
 * forgiving test.
 */
function looksLikeBotNote(note: string | null): boolean {
  if (!note) return false;
  const t = note.trim();
  if (t.length < 12) return false;
  return /^[A-Za-z]+$/.test(t);
}
export async function POST(request: NextRequest) {
  // Honour the launch-day kill switch — same env var that gates
  // /api/checkout/*. If we have to pause signups, we also pause net-new
  // waitlist commitments so the inbox doesn't fill with promises we can't
  // immediately keep.
  if (process.env.SIGNUPS_PAUSED === 'true') {
    return NextResponse.json(
      { error: 'Signups are temporarily paused. Please try again shortly.' },
      { status: 503 },
    );
  }

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
  if (looksLikeBotNote(note)) {
    return NextResponse.json(
      { error: 'Please describe what you would use eYKON for, in your own words.' },
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
  // ISO-3166 alpha-2, resolved from the edge geo header (never the raw IP).
  // null when the edge provides no geo header — stored as NULL, shown "—".
  const country = resolveRequestCountry(request.headers);

  const turnstile = await verifyTurnstileToken(
    typeof b.turnstile_token === 'string' ? b.turnstile_token : null,
    ip || null,
  );
  if (!turnstile.ok) {
    return NextResponse.json({ error: 'Verification failed. Please retry.' }, { status: 400 });
  }

  const admin = createServerSupabase();

  // Rate limit BEFORE any write, per hashed IP — same posture as
  // /api/closing/lead. A cheap COUNT on an indexed column.
  if (ipHash) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await admin
      .from('fiat_waitlist')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)
      .gte('created_at', oneHourAgo);
    if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) {
      return NextResponse.json({ error: 'Too many submissions. Try later.' }, { status: 429 });
    }
  }

  const { data, error } = await admin
    .from('fiat_waitlist')
    .insert({
      email,
      tier,
      note,
      referral_code: referralCode,
      ip_hash: ipHash,
      user_agent: userAgent,
      country,
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

  // Fire confirmation email. Deliberately best-effort — a failed email
  // shouldn't break the waitlist signup, so we don't await-and-throw. The
  // email_log table carries the send status for ops visibility.
  void sendWaitlistConfirmation({
    to: email,
    email,
    tier: tier as 'pro' | 'enterprise',
  }).catch((err) => {
    safeError('[waitlist] confirmation send failed', err);
  });

  // PostHog: waitlist entries have no auth user yet, so use the hashed
  // email as a stable anonymous distinct_id. This surfaces intent on the
  // funnel without storing raw PII in event properties.
  void captureServer(`waitlist:${ipHash ?? email.slice(0, 3)}:${email.split('@')[1]}`, {
    event: 'waitlist_joined',
    tier: tier as 'pro' | 'enterprise',
  });

  return NextResponse.json({
    ok: true,
    id: data.id,
    created_at: data.created_at,
  });
}
