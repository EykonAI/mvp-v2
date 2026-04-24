import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

type CookieToSet = { name: string; value: string; options: CookieOptions };

// Paths that belong to the (app) route group. Route groups are URL-transparent
// in the Next.js App Router, so the matcher lives in userland — not the filesystem.
const APP_PATHS = ['/app', '/intel', '/dashboard', '/settings', '/billing'];

function isAppPath(pathname: string): boolean {
  return APP_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(request: NextRequest) {
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

export const config = {
  // Run on everything except API routes, auth pages, Next.js internals, and
  // static asset requests. The matcher purposely excludes /api/* so the
  // Supervisor service and cron endpoints (authenticated with CRON_SECRET,
  // not a session cookie) are never 302'd into auth.
  matcher: [
    '/((?!api|auth|_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml|opengraph-image|.*\\..*).*)',
  ],
};
