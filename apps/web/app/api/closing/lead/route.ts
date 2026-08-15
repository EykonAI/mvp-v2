import { NextResponse, type NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { createServerSupabase } from '@/lib/supabase-server';
import { verifyTurnstileToken } from '@/lib/grow/turnstile';
import { captureServer } from '@/lib/analytics/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/closing/lead — the /start qualification form (Screen 5).
 *
 * The lead is the asset this page exists to capture: a bounce after this
 * point still leaves something in the pipeline. Self-hosted rather than
 * Typeform so the row lands where the digest, bounty and attribution
 * logic can already reach it (closing-LP brief v1.3 §4.5).
 *
 * Behaviour contract (brief §6):
 *   • Turnstile verified before any write.
 *   • Rate-limited per hashed IP (5/hour), like /api/grow/submissions.
 *   • Duplicate email: silent upsert — qualification fields refresh,
 *     utm_* keeps FIRST touch, response is identical to a fresh insert.
 *     "You already signed up" reads as rejection; we never say it.
 *   • lead_captured fires SERVER-side so an ad-blocker cannot hide the
 *     one conversion this page is measured by.
 */

const PERSONAS = new Set([
  'day-trader',
  'osint-analyst',
  'commodities-desk',
  'journalist',
  'corporate-risk',
  'researcher-ngo',
  'other',
]);

const THEATRES = new Set([
  'hormuz-red-sea',
  'russian-refineries',
  'sanctions-shadow-fleet',
  'power-grid',
  'critical-minerals',
  'taiwan-scs',
]);

const RATE_LIMIT_PER_HOUR = 5;

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

export async function POST(request: NextRequest) {
  // Same launch-day kill switch as /api/checkout/* and /api/waitlist.
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

  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase().slice(0, 200) : '';
  const nameOrHandle = str(b.name_or_handle, 120);
  const persona = typeof b.persona === 'string' ? b.persona.trim() : '';
  const theatresRaw = Array.isArray(b.theatres) ? b.theatres : [];
  const theatres = theatresRaw
    .filter((t): t is string => typeof t === 'string' && THEATRES.has(t))
    .slice(0, THEATRES.size);
  const currentTools = str(b.current_tools, 200);
  const wantsDailyBrief = b.wants_daily_brief === true;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
  }
  if (!nameOrHandle) {
    return NextResponse.json({ error: 'A name or handle is required.' }, { status: 400 });
  }
  if (!PERSONAS.has(persona)) {
    return NextResponse.json({ error: 'Pick what describes you.' }, { status: 400 });
  }
  if (theatres.length === 0) {
    return NextResponse.json(
      { error: 'Pick at least one thing you would point eYKON at.' },
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

  const turnstile = await verifyTurnstileToken(
    typeof b.turnstile_token === 'string' ? b.turnstile_token : null,
    ip || null,
  );
  if (!turnstile.ok) {
    return NextResponse.json({ error: 'Verification failed. Please retry.' }, { status: 400 });
  }

  const admin = createServerSupabase();

  // Rate limit BEFORE any write, per hashed IP. Same posture as
  // /api/grow/submissions: cheap COUNT on an indexed column.
  if (ipHash) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await admin
      .from('closing_leads')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)
      .gte('created_at', oneHourAgo);
    if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) {
      return NextResponse.json({ error: 'Too many submissions. Try later.' }, { status: 429 });
    }
  }

  // First-touch attribution: stored on insert, never overwritten on a
  // duplicate — mirrors the $set_once person properties on the client.
  const firstTouch = {
    utm_source: str(b.utm_source, 200),
    utm_medium: str(b.utm_medium, 200),
    utm_campaign: str(b.utm_campaign, 200),
    utm_content: str(b.utm_content, 200),
    referrer: str(b.referrer, 300),
    landing_path: str(b.landing_path, 200),
  };

  const qualification = {
    name_or_handle: nameOrHandle,
    persona,
    theatres,
    current_tools: currentTools,
    wants_daily_brief: wantsDailyBrief,
  };

  const { error: insertError } = await admin
    .from('closing_leads')
    .insert({ email, ...qualification, ...firstTouch, ip_hash: ipHash, user_agent: userAgent });

  if (insertError) {
    if (insertError.code === '23505') {
      // Duplicate: refresh the qualification, keep first-touch utm_*.
      const { error: updateError } = await admin
        .from('closing_leads')
        .update({ ...qualification, updated_at: new Date().toISOString() })
        .eq('email', email);
      if (updateError) {
        console.error('[closing/lead] update failed', updateError.message);
        return NextResponse.json({ error: 'Could not record your details.' }, { status: 500 });
      }
    } else {
      console.error('[closing/lead] insert failed', insertError.message);
      return NextResponse.json({ error: 'Could not record your details.' }, { status: 500 });
    }
  }

  // Server-side capture: the conversion this page is measured by must not
  // depend on the browser client surviving an ad-blocker. Distinct id is
  // a hash of the email — stable across visits, no raw PII in PostHog.
  const distinctId = `lead:${crypto.createHash('sha256').update(email).digest('hex').slice(0, 24)}`;
  void captureServer(distinctId, {
    event: 'lead_captured',
    persona,
    theatres,
    utm_source: firstTouch.utm_source,
    has_tools: currentTools != null,
  });

  // Identical response for insert and update — duplicate status is never
  // revealed to the client.
  return NextResponse.json({ ok: true });
}
