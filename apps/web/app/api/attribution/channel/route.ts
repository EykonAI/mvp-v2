import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { normalizeChannel } from '@/lib/attribution/channels';
import { captureChannelTouch } from '@/lib/attribution/capture';
import { hashIpAddress } from '@/lib/referral/capture';
import { safeError } from '@/lib/log';
import { checkChannelTouchIpRate } from '@/lib/rate-limit';

// POST /api/attribution/channel
// Called by <ChannelCapture> (mounted in the root layout) on the first
// tagged landing of a visit. Records one channel_touchpoints row (046)
// for the inbound campaign touch — the top-of-funnel half of PAMS
// (decision D3, full-funnel capture). The user-level first-touch is
// resolved separately at signup via the eykon_channel cookie.
//
// Always returns 204 — attribution is silent (mirrors the referral
// capture route). The caller fires-and-forgets; success/failure is not
// observable client-side. Per-IP rate-limited (60/min) against
// channel_touchpoints; over the limit it silently no-ops, identical to a
// missing/invalid channel.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const IP_RATE_WINDOW_SECONDS = 60;
const IP_RATE_MAX = 60;

type ChannelBody = {
  utm_source?: string;
  ch?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  landing_path?: string;
  referrer_host?: string;
};

const NO_CONTENT = new NextResponse(null, { status: 204 });

export async function POST(req: NextRequest) {
  let body: ChannelBody = {};
  try {
    body = (await req.json()) as ChannelBody;
  } catch {
    return NO_CONTENT;
  }

  // Bail before any DB work if there is no recognised channel — keeps
  // junk/untagged posts cheap and the touch stream clean.
  const channel = normalizeChannel(body.utm_source ?? body.ch);
  if (!channel) return NO_CONTENT;

  const rawIp = extractClientIp(req);

  // Rate-limit by IP before the auth lookup + write. Skipped when the IP
  // can't be extracted (common in local dev); the path is silent either way.
  if (rawIp) {
    const ipHash = hashIpAddress(rawIp);
    const limit = await checkChannelTouchIpRate({
      ipHash,
      windowSeconds: IP_RATE_WINDOW_SECONDS,
      max: IP_RATE_MAX,
    });
    if (limit.exceeded) {
      // Silent drop — no 429, indistinguishable from a no-op (matches
      // the referral capture route's anti-probing behaviour).
      return NO_CONTENT;
    }
  }

  const user = await getCurrentUser();
  const userId = user?.id ?? null;
  const sessionId = req.cookies.get('eykon_session')?.value ?? null;

  try {
    await captureChannelTouch({
      channel,
      utm: {
        source: body.utm_source ?? null,
        medium: body.utm_medium ?? null,
        campaign: body.utm_campaign ?? null,
        content: body.utm_content ?? null,
        term: body.utm_term ?? null,
      },
      sessionId,
      userId,
      landingPath: body.landing_path ?? null,
      referrerHost: body.referrer_host ?? null,
      rawIp,
    });
  } catch (err) {
    // Silent failure — log server-side, never surface. Attribution must
    // never disrupt the page.
    safeError('[attribution.channel] failed', err);
  }

  return NO_CONTENT;
}

function extractClientIp(req: NextRequest): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    // x-forwarded-for can be a comma-separated chain; the leftmost entry
    // is the original client.
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  return null;
}
