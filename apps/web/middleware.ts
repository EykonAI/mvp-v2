import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import {
  EYKON_REF_COOKIE,
  EYKON_REF_COOKIE_MAX_AGE_SECONDS,
  parseEykonRefFromSearchParams,
} from '@/lib/referral/attribution';
import {
  EYKON_CHANNEL_COOKIE,
  EYKON_CHANNEL_COOKIE_MAX_AGE_SECONDS,
  parseChannelFromSearchParams,
} from '@/lib/attribution/channels';

type CookieToSet = { name: string; value: string; options: CookieOptions };

// Paths that belong to the (app) route group. Route groups are URL-transparent
// in the Next.js App Router, so the matcher lives in userland — not the filesystem.
const APP_PATHS = ['/app', '/intel', '/dashboard', '/settings', '/billing', '/admin'];

function isAppPath(pathname: string): boolean {
  return APP_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(request: NextRequest) {
  const response = await runAuthFlow(request);
  // Two independent first-touch captures, both edge-cheap (cookie only,
  // no DB): ?ref= referral (lib/referral) and utm_source/?ch marketing
  // channel (PAMS, lib/attribution). They read different params into
  // different cookies and never clobber each other.
  return applyChannelCookie(request, applyAttributionCookie(request, response));
}

async function runAuthFlow(request: NextRequest): Promise<NextResponse> {
  const authEnabled = process.env.NEXT_PUBLIC_AUTH_ENABLED === 'true';

  // Phase 1 default: auth disabled — middleware is a pass-through so the
  // restructure can land before Supabase Auth is wired in Phase 2.
  if (!authEnabled) return NextResponse.next();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnon) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseAnon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }: CookieToSet) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }: CookieToSet) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Refresh the session on EVERY matched route — not only gated (app) paths.
  // Supabase ROTATES the refresh token on refresh, and ONLY middleware can
  // persist the rotated cookie: server components use a no-op cookie writer
  // (getServerSupabase in lib/auth/session). So if a non-app page that reads
  // the session — COMM (/me, /radar, /leaderboard, /rooms, /spaces, /messages,
  // /u/<handle>), NOTIF (/notif), or /pricing — is the first to call getUser()
  // after the access token expired, the rotation is lost and the NEXT request
  // is silently logged out. Running getUser() here persists the rotation for
  // the whole authenticated surface, fixing that logout.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Gate only the protected (app) surfaces. Other pages are public (/u, /pricing)
  // or self-gate in-page (the COMM/NOTIF pages redirect to signin themselves) —
  // all still benefit from the cookie refresh above.
  if (!user && isAppPath(request.nextUrl.pathname)) {
    // Build the redirect against NEXT_PUBLIC_APP_URL, not a clone of
    // request.nextUrl — the web service binds to 0.0.0.0:3000 and that leaks
    // into request-derived origins on Railway, producing redirects the
    // browser cannot follow. Same root cause as the auth/callback fix.
    const base = (process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin).replace(/\/$/, '');
    const url = new URL('/auth/signin', base);
    url.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return response;
}

/**
 * Component A — silent attribution capture. Runs on every request that
 * reaches the matcher (i.e. any non-API, non-static, non-auth path).
 * If the URL carries ?ref=u_<10 hex> and the recipient does not already
 * have an eykon_ref cookie, we set it (90 d, samesite=lax, httpOnly,
 * secure in production). First-touch wins — never overwrite (spec §1.4).
 *
 * The DB-side log into attribution_events happens later, from a client
 * component on the public artifact page (PRs 4–5) → /api/attribution/capture.
 * Middleware deliberately does no DB work to keep the edge fast.
 */
function applyAttributionCookie(request: NextRequest, response: NextResponse): NextResponse {
  if (request.cookies.has(EYKON_REF_COOKIE)) return response;

  const ref = parseEykonRefFromSearchParams(request.nextUrl.searchParams);
  if (!ref) return response;

  // Not httpOnly — the signup page reads this cookie client-side to
  // forward into raw_user_meta_data so the handle_new_user trigger
  // (migration 026) can resolve it via public_id at insert time. The
  // cookie value is itself a public identifier (the referrer's
  // public_id appears in URLs) so there is no secret to protect.
  response.cookies.set(EYKON_REF_COOKIE, ref, {
    maxAge: EYKON_REF_COOKIE_MAX_AGE_SECONDS,
    sameSite: 'lax',
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });

  return response;
}

/**
 * PAMS first-touch channel capture. The marketing-channel analogue of
 * applyAttributionCookie: if the URL carries utm_source (or the ?ch=
 * alias) for a recognised channel and the visitor has no eykon_channel
 * cookie yet, set it (90 d, sameSite=lax, secure in prod). First-touch
 * wins — never overwrite, so a later untagged or differently-tagged
 * visit cannot steal attribution from the original channel.
 *
 * Not httpOnly — the signup page reads it client-side to forward into
 * raw_user_meta_data, where the handle_new_user trigger (migration 047)
 * parks it on acquisition_channel_pending. The value is a non-secret
 * marketing tag (it literally appears in the campaign URL), so there is
 * nothing to protect by hiding it from JS.
 *
 * Distinct from ?ref= (referral): different param, different cookie. The
 * DB-side touch log happens later from <ChannelCapture> →
 * /api/attribution/channel; middleware does no DB work to keep the edge fast.
 */
function applyChannelCookie(request: NextRequest, response: NextResponse): NextResponse {
  if (request.cookies.has(EYKON_CHANNEL_COOKIE)) return response;

  const channel = parseChannelFromSearchParams(request.nextUrl.searchParams);
  if (!channel) return response;

  response.cookies.set(EYKON_CHANNEL_COOKIE, channel, {
    maxAge: EYKON_CHANNEL_COOKIE_MAX_AGE_SECONDS,
    sameSite: 'lax',
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });

  return response;
}

export const config = {
  // Run on everything except API routes, auth pages, Next.js internals, and
  // static asset requests. The matcher purposely excludes /api/* so the
  // Supervisor service and cron endpoints (authenticated with CRON_SECRET,
  // not a session cookie) are never 302'd into auth.
  matcher: [
    '/((?!api|auth|_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml|opengraph-image|.*\\..*).*)',
  ],
};
