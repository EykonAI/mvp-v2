import { NextResponse, type NextRequest } from 'next/server';
import { captureServer } from '@/lib/analytics/server';
import { resolveSocialUrl, type SocialSlug } from '@/lib/social/links';

// One handler, two routes. Both /discord and /x delegate here so the
// redirect semantics, the instrumentation and the cache posture cannot
// drift between them.

// A click is a person LEAVING for a platform we do not control, so
// there is no session to attribute and no funnel step to join. What is
// worth knowing is the COUNT and where the click came from — so every
// anonymous click shares one bucket id rather than minting a throwaway
// person per click, which would make the PostHog person list useless.
// When the visitor already carries a PostHog distinct id we use it, and
// the click joins their timeline properly.
const ANON_BUCKET = 'social-redirect-anonymous';

function distinctIdFrom(req: NextRequest): string {
  // posthog-js writes ph_<projectToken>_posthog as JSON; the cookie is
  // best-effort here. A malformed or absent cookie is normal, not an
  // error — most clicks on a bio link arrive with no prior session.
  const cookie = req.cookies.getAll().find((c) => /^ph_.*_posthog$/.test(c.name));
  if (!cookie?.value) return ANON_BUCKET;
  try {
    const parsed = JSON.parse(decodeURIComponent(cookie.value)) as { distinct_id?: unknown };
    return typeof parsed.distinct_id === 'string' && parsed.distinct_id
      ? parsed.distinct_id
      : ANON_BUCKET;
  } catch {
    return ANON_BUCKET;
  }
}

export function socialRedirect(req: NextRequest, slug: SocialSlug): NextResponse {
  const { url, source } = resolveSocialUrl(slug);
  const params = req.nextUrl.searchParams;

  // Fire and forget: the redirect must not wait on analytics, and an
  // analytics failure must never cost the visitor their click.
  void captureServer(distinctIdFrom(req), {
    event: 'social_link_clicked',
    social: slug,
    destination_source: source,
    // Where the click came FROM. utm on an outbound short link is how
    // we tell a bio click from a post click without being able to tag
    // the destination itself.
    utm_source: params.get('utm_source'),
    utm_medium: params.get('utm_medium'),
    utm_campaign: params.get('utm_campaign'),
    referrer: req.headers.get('referer'),
  }).catch(() => {
    // Swallowed on purpose. Never let PostHog decide whether a
    // marketing link works.
  });

  // 302, NEVER 301.
  //
  // A 301 is cached by browsers and intermediaries indefinitely and is
  // not reliably clearable. Shipping one here would make the
  // re-pointable property a lie: anyone who followed the link once
  // would keep landing on a revoked invite after we rotated it, and we
  // would have no way to reach them. The entire reason this route
  // exists is that the destination is expected to change.
  const res = NextResponse.redirect(url, 302);
  res.headers.set('Cache-Control', 'no-store, max-age=0');
  return res;
}
