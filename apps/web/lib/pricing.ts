// Canonical pricing constants — derived from
// `Marketing & Sales/Road to Market/2026 04 22_ eYKON_landing page v2.html`.
// Currency is USD; tiers are Citizen (free) / Pro / Enterprise (3-seat min).
// Phase 4 (crypto) consumes the CRYPTO_VARIANTS subset (annual-only).
// Phase 5 (fiat, deferred) will add monthly + annual via Lemon Squeezy.

// Crypto discount is decoupled by cohort (decision 2026-06-06):
//   • Founding members keep the deep −30% offer — it's part of the
//     "first 1,000 · locked for life" founding deal and is never re-priced.
//   • Standard (post-founding) crypto buyers get −15%.
// Both are off the respective annual fiat price for the same tier.
export const FOUNDING_CRYPTO_DISCOUNT = 0.30; // founding crypto: 30% off founding annual fiat
export const STANDARD_CRYPTO_DISCOUNT = 0.15; // standard crypto: 15% off standard annual fiat
export const ENTERPRISE_MIN_SEATS = 3;

export type Tier = 'citizen' | 'member' | 'pro' | 'desk' | 'enterprise';
export type BillingCycle = 'monthly' | 'annual' | 'lifetime';

// Client-safe tier label map. Lives here (not in lib/subscription.ts) so
// client components can import it without pulling in the server-only
// Supabase SSR helpers via lib/auth/session.
export const TIER_LABELS: Record<Tier, string> = {
  citizen: 'Citizen',
  member: 'Member',
  pro: 'Pro',
  desk: 'Desk',
  enterprise: 'Enterprise',
};

// Variant id format: <tier>_<founding|standard>_<cycle>
// Crypto is annual-only, so only the four _annual variants are crypto-eligible.
export type CryptoVariantId =
  | 'member_standard_annual'
  | 'pro_founding_annual'
  | 'pro_standard_annual'
  | 'enterprise_founding_annual'
  | 'enterprise_standard_annual';

export type CryptoVariant = {
  id: CryptoVariantId;
  tier: Tier;
  billing_cycle: 'annual';
  is_founding: boolean;
  seats: number;
  label: string;
  // Per-seat annual fiat price (headline on the pricing page).
  fiat_per_seat_annual_usd_cents: number;
  // Total crypto charge in USD cents = fiat_per_seat × seats × (1 - DISCOUNT), rounded.
  crypto_total_usd_cents: number;
  crypto_price_currency: 'usd';
};

const round = (x: number) => Math.round(x);

// Pricing source of truth (founding crypto −30%, standard crypto −15%):
// Member standard      = $12/mo   → annual $99   → crypto $84.15   (= $99 × 0.85)
// Pro founding monthly = $29/mo   → annual $348  → crypto $243.60  (= $348 × 0.70)
// Pro standard monthly = $99/mo   → annual $1188 → crypto $1009.80 (= $1188 × 0.85)
// Enterprise founding  = $99/seat/mo  → annual $1188/seat → crypto $831.60/seat  → total $2494.80 for 3 seats
// Enterprise standard  = $199/seat/mo → annual $2388/seat → crypto $2029.80/seat → total $6089.40 for 3 seats

export const CRYPTO_VARIANTS: Record<CryptoVariantId, CryptoVariant> = {
  // Member has no founding cohort — the "first 1,000 · locked for life"
  // deal stays unique to Pro. $12/mo headline → annual $99 (a deliberate
  // ~2-months-free anchor vs 12×$12), standard crypto −15% → $84.15.
  member_standard_annual: {
    id: 'member_standard_annual',
    tier: 'member',
    billing_cycle: 'annual',
    is_founding: false,
    seats: 1,
    label: 'Member · Annual (crypto)',
    fiat_per_seat_annual_usd_cents: 9_900,
    crypto_total_usd_cents: round(9_900 * (1 - STANDARD_CRYPTO_DISCOUNT)), // 8415 → $84.15
    crypto_price_currency: 'usd',
  },
  pro_founding_annual: {
    id: 'pro_founding_annual',
    tier: 'pro',
    billing_cycle: 'annual',
    is_founding: true,
    seats: 1,
    label: 'Pro · Founding Member · Annual (crypto)',
    fiat_per_seat_annual_usd_cents: 34_800,
    crypto_total_usd_cents: round(34_800 * (1 - FOUNDING_CRYPTO_DISCOUNT)), // 24360 → $243.60
    crypto_price_currency: 'usd',
  },
  pro_standard_annual: {
    id: 'pro_standard_annual',
    tier: 'pro',
    billing_cycle: 'annual',
    is_founding: false,
    seats: 1,
    label: 'Pro · Standard · Annual (crypto)',
    fiat_per_seat_annual_usd_cents: 118_800,
    crypto_total_usd_cents: round(118_800 * (1 - STANDARD_CRYPTO_DISCOUNT)), // 100980 → $1009.80
    crypto_price_currency: 'usd',
  },
  enterprise_founding_annual: {
    id: 'enterprise_founding_annual',
    tier: 'enterprise',
    billing_cycle: 'annual',
    is_founding: true,
    seats: ENTERPRISE_MIN_SEATS,
    label: `Enterprise · Founding · Annual · ${ENTERPRISE_MIN_SEATS} seats (crypto)`,
    fiat_per_seat_annual_usd_cents: 118_800,
    crypto_total_usd_cents: round(
      118_800 * ENTERPRISE_MIN_SEATS * (1 - FOUNDING_CRYPTO_DISCOUNT),
    ), // 249480 → $2494.80
    crypto_price_currency: 'usd',
  },
  enterprise_standard_annual: {
    id: 'enterprise_standard_annual',
    tier: 'enterprise',
    billing_cycle: 'annual',
    is_founding: false,
    seats: ENTERPRISE_MIN_SEATS,
    label: `Enterprise · Standard · Annual · ${ENTERPRISE_MIN_SEATS} seats (crypto)`,
    fiat_per_seat_annual_usd_cents: 238_800,
    crypto_total_usd_cents: round(
      238_800 * ENTERPRISE_MIN_SEATS * (1 - STANDARD_CRYPTO_DISCOUNT),
    ), // 608940 → $6089.40
    crypto_price_currency: 'usd',
  },
};

export function getCryptoVariant(id: string): CryptoVariant | null {
  const map = CRYPTO_VARIANTS as Record<string, CryptoVariant>;
  return map[id] ?? null;
}

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
