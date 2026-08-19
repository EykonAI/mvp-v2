import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { isFounder } from '@/lib/admin/access';
import { createServerSupabase } from '@/lib/supabase-server';
import { getFoundingSeats } from '@/lib/founding-seats';
import {
  SubscribersAdminClient,
  type SubscriberRow,
  type SubscriberStats,
} from './SubscribersAdminClient';

/**
 * /admin/subscribers — founder-only view of everyone who has actually paid.
 *
 * WHY purchases IS THE SPINE (brief v1.5 §22.2)
 * ---------------------------------------------
 * The obvious source is `subscriptions`. It is the wrong one: a $9 Week Pass
 * grants a `tier_override` and a Query Pack grants a `usage_bonus`; neither
 * writes a subscriptions row at all. Built on subscriptions, this page would
 * be structurally incapable of showing a pass buyer — and D-1 explicitly
 * asks for them.
 *
 * `purchases` is the only table that sees all three payment shapes, and its
 * `amount_cents` records what actually settled rather than what was listed.
 * The entitlement tables are LEFT JOINed for state (renews / expires), never
 * used to decide who exists.
 *
 * ONE ROW PER CUSTOMER, NOT PER PURCHASE. Someone who buys a pass in March
 * and subscribes in August is one customer with a history; duplicating them
 * corrupts every count on the page.
 *
 * NOTE: the attribution columns (utm_*, landing_path, referrer, country,
 * referral_code) require migration 109. Railway auto-deploys main on merge,
 * so apply 109 in the Supabase SQL Editor BEFORE merging, or this .select()
 * 500s at runtime — the same failure mode the waitlist page hit with 049.
 *
 * Founder gate mirrors /admin/waitlist and /admin/refunds: isFounder()
 * against FOUNDER_EMAILS. Unset env → redirect (admin existence must not
 * leak).
 */

export const metadata = { title: 'Admin · Subscribers — eYKON.ai' };
export const dynamic = 'force-dynamic';

const WEEK_MS = 7 * 86_400_000;

// Kinds that represent a subscription rather than a one-off entitlement.
const SUBSCRIPTION_KINDS = new Set(['subscription_first', 'subscription_renewal', 'lifetime']);
const PASS_KINDS = new Set(['week_pass', 'query_pack']);

type PurchaseRecord = {
  id: string;
  user_id: string | null;
  payment_provider: string | null;
  variant_id: string | null;
  kind: string | null;
  status: string | null;
  amount_cents: number | null;
  currency: string | null;
  pay_currency: string | null;
  created_at: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  landing_path: string | null;
  referrer: string | null;
  country: string | null;
  referral_code: string | null;
};

export default async function SubscribersAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/signin?next=/admin/subscribers');
  if (!isFounder(user)) redirect('/app');

  const admin = createServerSupabase();

  const { data: purchaseData } = await admin
    .from('purchases')
    .select(
      'id, user_id, payment_provider, variant_id, kind, status, amount_cents, currency, pay_currency, created_at, ' +
        'utm_source, utm_medium, utm_campaign, utm_content, landing_path, referrer, country, referral_code',
    )
    .order('created_at', { ascending: false })
    .limit(5000);

  const purchases = ((purchaseData ?? []) as unknown as PurchaseRecord[]).filter(p => p.user_id);

  const userIds = Array.from(new Set(purchases.map(p => p.user_id as string)));

  // LEFT JOINs, done as separate reads: PostgREST embedding across three
  // optional relations produces a shape that is harder to reason about than
  // three flat lookups, and these sets are small.
  const [profilesRes, subsRes, overridesRes] = await Promise.all([
    userIds.length
      ? admin
          .from('user_profiles')
          .select('id, email, display_name, tier, founding_rate_locked')
          .in('id', userIds)
      : Promise.resolve({ data: [] }),
    userIds.length
      ? admin
          .from('subscriptions')
          .select('user_id, tier, billing_cycle, status, current_period_end, variant_id')
          .in('user_id', userIds)
      : Promise.resolve({ data: [] }),
    userIds.length
      ? admin
          .from('tier_overrides')
          .select('user_id, tier, source, expires_at, purchase_id')
          .in('user_id', userIds)
      : Promise.resolve({ data: [] }),
  ]);

  const profiles = new Map<string, Record<string, unknown>>();
  for (const p of (profilesRes.data ?? []) as Array<Record<string, unknown>>) {
    profiles.set(String(p.id), p);
  }

  // Most recent subscription per user wins — a renewal supersedes.
  const subs = new Map<string, Record<string, unknown>>();
  for (const s of (subsRes.data ?? []) as Array<Record<string, unknown>>) {
    const uid = String(s.user_id);
    const prev = subs.get(uid);
    if (!prev || String(s.current_period_end ?? '') > String(prev.current_period_end ?? '')) {
      subs.set(uid, s);
    }
  }

  // Latest pass expiry per user. `source: 'fp_test'` grants are NOT purchases
  // and must not make a non-paying account look like a customer — they are
  // only ever read here to answer "is this buyer's pass still live".
  const passExpiry = new Map<string, string>();
  for (const o of (overridesRes.data ?? []) as Array<Record<string, unknown>>) {
    const uid = String(o.user_id);
    const exp = o.expires_at ? String(o.expires_at) : '';
    if (!exp) continue;
    if (!passExpiry.has(uid) || exp > (passExpiry.get(uid) as string)) passExpiry.set(uid, exp);
  }

  const now = Date.now();
  const byUser = new Map<string, PurchaseRecord[]>();
  for (const p of purchases) {
    const uid = p.user_id as string;
    const list = byUser.get(uid);
    if (list) list.push(p);
    else byUser.set(uid, [p]);
  }

  const rows: SubscriberRow[] = [];
  let startedNotCompleted = 0;

  for (const [uid, all] of byUser) {
    // A customer is someone whose money actually arrived. Pending rows are
    // abandoned checkouts; counting them as customers would inflate every
    // number on this page by an order of magnitude at current volumes.
    const settled = all.filter(p => p.status === 'completed' && p.kind !== 'refund');
    if (settled.length === 0) {
      startedNotCompleted += 1;
      continue;
    }

    const profile = profiles.get(uid) ?? {};
    const sub = subs.get(uid);

    const hasSubscription = settled.some(p => SUBSCRIPTION_KINDS.has(p.kind ?? ''));
    const hasPass = settled.some(p => PASS_KINDS.has(p.kind ?? ''));
    const type: SubscriberRow['type'] =
      hasSubscription && hasPass ? 'both' : hasSubscription ? 'subscription' : 'pass';

    // Attribution is FIRST-touch: the purchase that opened the relationship.
    // Reading the latest one would re-attribute a customer to whatever
    // channel they happened to renew through, which is not what any of these
    // three columns claim to answer.
    const chronological = [...settled].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const first = chronological[0];

    const periodEnd = sub?.current_period_end ? String(sub.current_period_end) : null;
    const passEnd = passExpiry.get(uid) ?? null;

    let status: SubscriberRow['status'];
    if (hasSubscription) {
      const endMs = periodEnd ? new Date(periodEnd).getTime() : NaN;
      const active = String(sub?.status ?? '') === 'active';
      if (!active || !Number.isFinite(endMs) || endMs <= now) status = 'lapsed';
      else if (endMs - now <= WEEK_MS) status = 'expiring';
      else status = 'active';
    } else {
      const endMs = passEnd ? new Date(passEnd).getTime() : NaN;
      status = Number.isFinite(endMs) && endMs > now ? 'pass_active' : 'pass_expired';
    }

    const refundedCents = all
      .filter(p => p.status === 'refunded' || p.kind === 'refund')
      .reduce((n, p) => n + (p.amount_cents ?? 0), 0);

    rows.push({
      user_id: uid,
      email: (profile.email as string | null) ?? null,
      display_name: (profile.display_name as string | null) ?? null,
      type,
      tier: (sub?.tier as string | null) ?? (profile.tier as string | null) ?? null,
      cadence: (sub?.billing_cycle as string | null) ?? null,
      status,
      country: first.country,
      landing_path: first.landing_path,
      referral_code: first.referral_code,
      utm_source: first.utm_source,
      utm_campaign: first.utm_campaign,
      joined_at: first.created_at,
      settled_cents: settled.reduce((n, p) => n + (p.amount_cents ?? 0), 0),
      refunded_cents: refundedCents,
      currency: first.currency ?? 'USD',
      variant_id: first.variant_id,
      variants: Array.from(new Set(settled.map(p => p.variant_id).filter(Boolean))) as string[],
      payment_provider: first.payment_provider,
      pay_currency:
        chronological.map(p => p.pay_currency).filter(Boolean).slice(-1)[0] ?? null,
      founding: Boolean(profile.founding_rate_locked),
      renews_at: periodEnd,
      pass_expires_at: passEnd,
      purchase_count: settled.length,
    });
  }

  rows.sort((a, b) => b.joined_at.localeCompare(a.joined_at));

  // Per-SUBSCRIBER metrics exclude pass-only customers explicitly (§22.6).
  // An aggregate over two populations hides the smaller one, and the label is
  // what turns that into a lie — so every tile below names its population.
  const subscribers = rows.filter(r => r.type !== 'pass');
  const seats = await getFoundingSeats();

  const stats: SubscriberStats = {
    customers: rows.length,
    subscribers: subscribers.length,
    passOnly: rows.filter(r => r.type === 'pass').length,
    annual: subscribers.filter(r => r.cadence === 'annual').length,
    monthly: subscribers.filter(r => r.cadence === 'monthly').length,
    lapsed: subscribers.filter(r => r.status === 'lapsed').length,
    expiring: subscribers.filter(r => r.status === 'expiring').length,
    settledCents: rows.reduce((n, r) => n + r.settled_cents, 0),
    refundedCents: rows.reduce((n, r) => n + r.refunded_cents, 0),
    fromStart: rows.filter(r => (r.landing_path ?? '').startsWith('/start')).length,
    fromPartner: rows.filter(r => r.referral_code !== null).length,
    attributed: rows.filter(r => r.utm_source !== null || r.landing_path !== null).length,
    startedNotCompleted,
    cap: seats.cap,
    claimed: seats.claimed,
    paidFounders: seats.paidFounders,
    spotsLeft: seats.spotsLeft,
  };

  return <SubscribersAdminClient rows={rows} stats={stats} />;
}
