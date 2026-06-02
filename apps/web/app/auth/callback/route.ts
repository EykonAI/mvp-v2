import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { captureServer, identifyServer } from '@/lib/analytics/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { EYKON_REF_COOKIE, isValidPublicId } from '@/lib/referral/attribution';
import { EYKON_CHANNEL_COOKIE, normalizeChannel } from '@/lib/attribution/channels';

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

    // Component A — OAuth signup fallback. Email/password signups carry
    // eykon_ref through raw_user_meta_data and the handle_new_user
    // trigger (migration 026) resolves it at insert time. OAuth
    // signups have no such metadata path, so we resolve the cookie
    // post-exchange here. No-op when the trigger already populated
    // referred_by, or when the cookie is absent / invalid / unknown.
    await resolveEykonRefForOAuthSignup(user.id, request);

    // PAMS — OAuth signup fallback for the marketing channel. OAuth
    // signups bypass the signup page's metadata path, so the
    // handle_new_user trigger never sees eykon_channel. Resolve the
    // cookie post-exchange here, mirroring the referral fallback above.
    await resolveEykonChannelForOAuthSignup(user.id, request);
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

async function resolveEykonRefForOAuthSignup(userId: string, request: NextRequest) {
  const ref = request.cookies.get(EYKON_REF_COOKIE)?.value ?? null;
  if (!ref || !isValidPublicId(ref)) return;

  const admin = createServerSupabase();

  const { data: profile } = await admin
    .from('user_profiles')
    .select('id, referred_by, referred_by_pending, public_id')
    .eq('id', userId)
    .maybeSingle();

  if (!profile) return;
  // Trigger already resolved it (email/password path) — leave alone.
  if (profile.referred_by) return;
  // Self-ref guard: a user signing up via OAuth using a link they
  // themselves shared previously. Discard.
  if (profile.public_id === ref) return;

  const { data: referrer } = await admin
    .from('user_profiles')
    .select('id')
    .eq('public_id', ref)
    .maybeSingle();
  if (!referrer) return;

  await admin
    .from('user_profiles')
    .update({ referred_by: referrer.id, referred_by_pending: null })
    .eq('id', userId)
    .is('referred_by', null);
}

async function resolveEykonChannelForOAuthSignup(userId: string, request: NextRequest) {
  const channel = normalizeChannel(request.cookies.get(EYKON_CHANNEL_COOKIE)?.value ?? null);
  if (!channel) return;

  const admin = createServerSupabase();

  const { data: profile } = await admin
    .from('user_profiles')
    .select('id, acquisition_channel, acquisition_channel_pending')
    .eq('id', userId)
    .maybeSingle();

  // No row, or first-touch already captured/finalised — leave it alone
  // (first-touch wins). Also no-ops gracefully if migration 046 has not
  // been applied yet: the select returns an error, profile is null.
  if (!profile) return;
  if (profile.acquisition_channel || profile.acquisition_channel_pending) return;

  await admin
    .from('user_profiles')
    .update({ acquisition_channel_pending: channel })
    .eq('id', userId)
    // Re-assert the no-overwrite guard at update time to close the race
    // between the SELECT above and this UPDATE.
    .is('acquisition_channel', null)
    .is('acquisition_channel_pending', null);
}
