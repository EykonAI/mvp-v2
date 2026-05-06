import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { User, SupabaseClient } from '@supabase/supabase-js';

type CookieToSet = { name: string; value: string; options: CookieOptions };

export type Tier = 'citizen' | 'pro' | 'desk' | 'enterprise';
export type BillingCycle = 'monthly' | 'annual' | 'lifetime';
export type VerifiedDiscount = 'journalist' | 'nonprofit' | 'academic';
export type AdvocateState = 'none' | 'invited' | 'active' | 'paused' | 'terminated';

export type UserProfile = {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  tier: Tier;
  billing_cycle: BillingCycle | null;
  founding_rate_locked: boolean;
  referral_code: string | null;
  referred_by: string | null;
  ls_customer_id: string | null;
  ls_subscription_id: string | null;
  nowpayments_customer_ref: string | null;
  lifetime_purchased_at: string | null;
  verified_discount_type: VerifiedDiscount | null;
  // Referral program (migration 025).
  public_id: string;
  referred_by_pending: string | null;
  advocate_state: AdvocateState;
  advocate_invited_at: string | null;
  advocate_onboarded_at: string | null;
  advocate_terminated_at: string | null;
  rewardful_affiliate_id: string | null;
  first_paid_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Supabase SSR client bound to the current request's cookies. Safe to use in
 * Server Components, Server Actions, and Route Handlers. Cookie mutation is a
 * no-op here — middleware.ts is responsible for refreshing the session cookie.
 */
export function getServerSupabase(): SupabaseClient {
  const cookieStore = cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(_cookiesToSet: CookieToSet[]) {
        // Layouts and pages cannot mutate cookies; middleware handles refresh.
      },
    },
  });
}

/**
 * Returns the authenticated Supabase auth user, or null. Uses auth.getUser()
 * (not getSession()) so the token is verified against the Supabase Auth server
 * instead of just trusting the cookie payload.
 */
export async function getCurrentUser(): Promise<User | null> {
  const supabase = getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * Returns the current user's extended profile (tier, billing state, referral
 * code, etc.) or null if unauthenticated. Joins auth.getUser() with the
 * user_profiles row via RLS — relies on the "Users manage own profile" policy.
 */
export async function getUserProfile(): Promise<UserProfile | null> {
  const supabase = getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (error || !data) return null;
  return data as UserProfile;
}
