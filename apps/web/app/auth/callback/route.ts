import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { captureServer, identifyServer } from '@/lib/analytics/server';

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * OAuth / magic-link / email-confirmation callback.
 *
 * Supabase Auth redirects here with `?code=<pkce>` (or `?error=...`) after an
 * OAuth round-trip, a magic-link click, or an email verification. We exchange
 * the code for a session (cookies are written by the SSR client), then
 * redirect to `next` (defaults to /app) — preserving `plan` so the signup
 * flow can hand off to a checkout variant.
 *
 * Note: /api/auth/callback is NOT this route. Supabase's dashboard must be
 * configured to redirect to /auth/callback (no /api prefix), matching
 * middleware.ts's exclusion list.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  // Trust NEXT_PUBLIC_APP_URL over request.nextUrl.origin: the web service
  // binds to 0.0.0.0:3000 (`next start -H 0.0.0.0`), and on Railway that
  // internal address leaks into request-derived origins, producing redirects
  // to http://0.0.0.0:3000 that the user's browser cannot reach.
  const origin = (process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin).replace(/\/$/, '');
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/app';
  const plan = searchParams.get('plan');
  const authError = searchParams.get('error_description') ?? searchParams.get('error');

  if (authError) {
    const redirect = new URL('/auth/signin', origin);
    redirect.searchParams.set('error', authError);
    return NextResponse.redirect(redirect);
  }

  if (!code) {
    return NextResponse.redirect(new URL('/auth/signin', origin));
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnon) {
    return NextResponse.redirect(new URL('/auth/signin?error=config', origin));
  }

  let response = NextResponse.redirect(new URL(next, origin));

  const supabase = createServerClient(supabaseUrl, supabaseAnon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }: CookieToSet) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.redirect(new URL(next, origin));
        cookiesToSet.forEach(({ name, value, options }: CookieToSet) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const { data: sessionData, error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    const redirect = new URL('/auth/signin', origin);
    redirect.searchParams.set('error', exchangeError.message);
    return NextResponse.redirect(redirect);
  }

  // Attribute the signup in PostHog using the Supabase user id as the
  // canonical distinct_id. The browser client's anonymous distinct_id is
  // merged via the identify call when the next page_viewed fires in the
  // browser after redirect.
  const user = sessionData?.user;
  if (user) {
    const referralCode =
      (user.user_metadata as Record<string, unknown> | undefined)?.referral_code;
    await identifyServer(user.id, {
      email: user.email,
      created_at: user.created_at,
      has_referrer: typeof referralCode === 'string' && referralCode.length > 0,
    });
    await captureServer(user.id, {
      event: 'signup_completed',
      plan: plan ?? null,
      has_referrer: typeof referralCode === 'string' && referralCode.length > 0,
    });
  }

  // Preserve ?plan for downstream checkout handoff (Phase 4/5).
  if (plan) {
    const target = new URL(next, origin);
    target.searchParams.set('plan', plan);
    const withPlan = NextResponse.redirect(target);
    response.cookies.getAll().forEach((c) => withPlan.cookies.set(c));
    return withPlan;
  }

  return response;
}
