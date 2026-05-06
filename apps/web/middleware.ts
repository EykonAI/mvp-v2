import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import {
  EYKON_REF_COOKIE,
  EYKON_REF_COOKIE_MAX_AGE_SECONDS,
  parseEykonRefFromSearchParams,
} from '@/lib/referral/attribution';

type CookieToSet = { name: string; value: string; options: CookieOptions };

// Paths that belong to the (app) route group. Route groups are URL-transparent
// in the Next.js App Router, so the matcher lives in userland — not the filesystem.
const APP_PATHS = ['/app', '/intel', '/dashboard', '/settings', '/billing'];

function isAppPath(pathname: string): boolean {
  return APP_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(request: NextRequest) {
  const response = await runAuthFlow(request);
  return applyAttributionCookie(request, response);
}

async function runAuthFlow(request: NextRequest): Promise<NextResponse> {
  const authEnabled = process.env.NEXT_PUBLIC_AUTH_ENABLED === 'true';

  // Phase 1 default: auth disabled — middleware is a pass-through so the
  // restructure can land before Supabase Auth is wired in Phase 2.
  if (!authEnabled) return NextResponse.next();

  // Only gate (app) paths. Marketing, auth, and static routes are public.
  if (!isAppPath(request.nextUrl.pathname)) return NextResponse.next();

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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
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

  response.cookies.set(EYKON_REF_COOKIE, ref, {
    maxAge: EYKON_REF_COOKIE_MAX_AGE_SECONDS,
    sameSite: 'lax',
    httpOnly: true,
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
