import { NextResponse, type NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { createServerSupabase } from '@/lib/supabase-server';
import { verifyTurnstileToken } from '@/lib/grow/turnstile';
import { captureServer } from '@/lib/analytics/server';
import { resolveRequestCountry } from '@/lib/geo/request-country';

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

// The five personas of the three-step funnel (brief v1.4 §4.0,
// migration 108). Each keys a pitch, a destination and a lead score.
const PERSONAS = new Set(['trader', 'analyst', 'journalist', 'risk', 'citizen']);

// Theatres are pure geography now — they map to what the sensors
// actually cover, not to topics. Six offered, up to three chosen.
const THEATRES = new Set([
  'hormuz',
  'red-sea',
  'black-sea',
  'taiwan-strait',
  'malacca',
  'gulf-of-guinea',
]);

const MARKETS = new Set([
  'oil-gas',
  'metals',
  'grains',
  'fx',
  'crypto',
  'equities',
  'not-trading',
]);

const NEEDS = new Set([
  'realtime-alerts',
  'daily-brief',
  'ask-analyst',
  'audited-record',
  'community',
]);

const PAY = new Set(['crypto_today', 'fiat_waiting', 'unsure']);
const PUBLISHES = new Set(['no', 'under_10k', 'over_10k']);

/**
 * Where this lead should land after submitting — decided SERVER-side so
 * the page cannot drift from it, and so the rule can change without a
 * deploy of the client. The page keeps a fallback for offline failure,
 * but this response is authoritative.
 *
 * The ordering is deliberate: a large publisher is a Founding Partner
 * conversation before it is a self-serve sale, and a fiat-only answer
 * must never be routed into a crypto checkout it cannot complete.
 */
function destinationFor(input: {
  persona: string;
  pay: string | null;
  publishes: string | null;
}): string {
  if (input.publishes === 'over_10k') {
    return 'mailto:partners@eykon.ai?subject=Founding%20Partner';
  }
  if (input.persona === 'journalist') {
    return 'mailto:verify@eykon.ai?subject=Press%20verification';
  }
  // Fiat-only and undecided prospects go to a free account, not a
  // checkout they cannot pay. We asked the question precisely so we
  // could honour the answer.
  if (input.pay === 'fiat_waiting' || input.pay === 'unsure') {
    return '/auth/signin?next=/app';
  }
  if (input.persona === 'citizen') return '/auth/signin?next=/app';
  if (input.persona === 'risk') return '/pricing?plan=enterprise_founding_annual';
  return '/pricing?plan=pro_founding_annual';
}

const RATE_LIMIT_PER_HOUR = 5;

/**
 * Mirror a fiat-only prospect into `fiat_waitlist`.
 *
 * /start asks "how would you pay" precisely so we can honour the answer.
 * Until now, answering "Fiat — tell me when it opens" recorded the intent on
 * closing_leads.pay and routed the person to a free account — correct, but it
 * left them invisible to the one surface built for exactly this job: the
 * admin Fiat Waitlist page, with its filters, CSV export and broadcast tool.
 * When card billing opens, whoever works that list would not have seen them.
 *
 * So the /start fiat door IS the waitlist form now. The lead row stays the
 * source of truth for qualification; this is a deliberate, narrow duplication
 * of the contactable fields into the table the fiat workflow already reads.
 *
 * Tier mirrors destinationFor()'s existing rule — persona 'risk' is the
 * enterprise path, everyone else is Pro — so no new judgement is invented
 * here; the two stay consistent by construction.
 *
 * FAIL-SOFT. The lead is the asset this endpoint exists to capture. If this
 * secondary write fails, we log and carry on; the prospect is still recorded
 * and the form still succeeds. A waitlist mirror is never worth losing a lead
 * over.
 *
 * No confirmation email is sent: /start renders its own success state, and a
 * second message quoting the old waitlist terms would contradict it.
 */
async function mirrorToFiatWaitlist(
  admin: ReturnType<typeof createServerSupabase>,
  input: {
    email: string;
    persona: string;
    need: string | null;
    theatres: string[];
    ipHash: string | null;
    userAgent: string | null;
    country: string | null;
  },
): Promise<void> {
  const tier = input.persona === 'risk' ? 'enterprise' : 'pro';

  // Context for whoever works this list months from now. Prose, not a token —
  // it also has to survive the bot-note guard on /api/waitlist.
  const noteParts = [`via /start · persona: ${input.persona}`];
  if (input.need) noteParts.push(`needs: ${input.need}`);
  if (input.theatres.length) noteParts.push(`watching: ${input.theatres.join(', ')}`);
  const note = noteParts.join(' · ').slice(0, 500);

  const { error } = await admin.from('fiat_waitlist').insert({
    email: input.email,
    tier,
    note,
    ip_hash: input.ipHash,
    user_agent: input.userAgent,
    country: input.country,
  });

  // 23505 = already on the list for this tier. Re-submitting the form is not
  // an error and must not be surfaced as one.
  if (error && error.code !== '23505') {
    console.error('[closing/lead] fiat_waitlist mirror failed', error.message);
  }
}

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

  const marketsRaw = Array.isArray(b.markets) ? b.markets : [];
  const markets = marketsRaw
    .filter((m): m is string => typeof m === 'string' && MARKETS.has(m))
    .slice(0, 3);
  const need = typeof b.need === 'string' && NEEDS.has(b.need) ? b.need : null;
  const pay = typeof b.pay === 'string' && PAY.has(b.pay) ? b.pay : null;
  const publishes =
    typeof b.publishes === 'string' && PUBLISHES.has(b.publishes) ? b.publishes : null;

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
    markets,
    need,
    pay,
    publishes,
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

  // Fiat-only prospects also land on the waitlist — that door is now the
  // waitlist's only capture surface (the standalone form was retired).
  // 'unsure' is deliberately excluded: it is not choosing fiat.
  if (pay === 'fiat_waiting') {
    await mirrorToFiatWaitlist(admin, {
      email,
      persona,
      need,
      theatres,
      ipHash,
      userAgent,
      country: resolveRequestCountry(request.headers),
    });
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
  // revealed to the client. `destination` is authoritative; the page's
  // own copy of the rule is only an offline fallback.
  return NextResponse.json({
    ok: true,
    destination: destinationFor({ persona, pay, publishes }),
  });
}
