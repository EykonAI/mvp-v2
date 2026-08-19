import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveRequestCountry } from '@/lib/geo/request-country';

/**
 * Attribution stamped onto a purchase row at the moment of checkout
 * (migration 109; Closing LP Build Brief v1.5 §22.4).
 *
 * Three orthogonal signals — none subsumes another:
 *   landing_path  → which PAGE converted them  (/start vs /pricing vs /c)
 *   referral_code → which PARTNER sent them    (who earns the bounty)
 *   utm_*         → which CHANNEL sent them    (reddit, discord, x)
 *
 * Stamped now rather than reconstructed later. The shortcut — matching
 * closing_leads.email against user_profiles.email after the fact — breaks
 * whenever someone fills the lead form with one address and pays with
 * another, and it fails silently in the flattering direction: an unmatched
 * sale reads as organic rather than attributed.
 *
 * Every field is nullable and stays NULL when unknown. Nothing here is
 * inferred, defaulted or guessed — a fabricated attribution is worse than
 * an honest blank, because a blank is visibly a blank.
 */

export type PurchaseAttribution = {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  landing_path: string | null;
  referrer: string | null;
  country: string | null;
  referral_code: string | null;
};

const str = (v: unknown, max = 200): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

/**
 * Partner code in effect at payment time, in precedence order:
 *
 *   1. the live Rewardful click-through — this is the one that determines
 *      commission, so it outranks anything on the profile;
 *   2. `referred_by_pending` — the code the buyer signed up with but which
 *      has not converted into a referral row yet;
 *   3. the referring advocate's own `referral_code`, resolved from the
 *      `referred_by` UUID. This is the case that matters most in practice:
 *      a partner sends someone in March and they pay in August.
 *
 * Denormalised on purpose. `user_profiles.referred_by` can change after the
 * sale; what the ledger needs is who was owed at the time money moved.
 */
async function resolveReferralCode(
  admin: SupabaseClient,
  userId: string,
  rewardfulReferral: string,
): Promise<string | null> {
  const live = str(rewardfulReferral, 64);
  if (live) return live;

  const { data: profile } = await admin
    .from('user_profiles')
    .select('referred_by_pending, referred_by')
    .eq('id', userId)
    .maybeSingle();
  if (!profile) return null;

  const pending = str((profile as Record<string, unknown>).referred_by_pending, 64);
  if (pending) return pending;

  const advocateId = (profile as Record<string, unknown>).referred_by;
  if (typeof advocateId !== 'string' || !advocateId) return null;

  const { data: advocate } = await admin
    .from('user_profiles')
    .select('referral_code')
    .eq('id', advocateId)
    .maybeSingle();
  return str((advocate as Record<string, unknown> | null)?.referral_code, 64);
}

/**
 * Build the attribution bag for a purchase INSERT.
 *
 * `body.attribution` is the first-touch record carried by the browser from
 * the landing page (lib/analytics/first-touch.ts). It is NOT re-derived
 * server-side from the referer header or the request URL: checkout is
 * requested from /pricing, so any URL visible here belongs to the page the
 * visitor was on when they paid, not the page that convinced them. Stamping
 * that would put landing_path='/pricing' on every sale from every channel
 * and quietly report the closing funnel as converting nobody.
 *
 * Client-supplied values are untrusted input — trimmed and length-capped
 * here, never interpolated into SQL (PostgREST parameterises), and used
 * only as reporting labels. Country comes from the edge header instead,
 * because it is the one field the browser has no business asserting.
 */
export async function buildPurchaseAttribution(
  admin: SupabaseClient,
  request: NextRequest,
  body: unknown,
  userId: string,
  rewardfulReferral: string,
): Promise<PurchaseAttribution> {
  const raw =
    body && typeof body === 'object' && 'attribution' in body
      ? (body as { attribution: unknown }).attribution
      : null;
  const a = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  return {
    utm_source: str(a.utm_source),
    utm_medium: str(a.utm_medium),
    utm_campaign: str(a.utm_campaign),
    utm_content: str(a.utm_content),
    landing_path: str(a.landing_path),
    referrer: str(a.referrer, 300),
    country: resolveRequestCountry(request.headers),
    referral_code: await resolveReferralCode(admin, userId, rewardfulReferral),
  };
}
