// Canonical pricing constants — derived from
// `Marketing & Sales/Road to Market/2026 04 22_ eYKON_landing page v2.html`.
// Currency is USD; tiers are Citizen (free) / Pro / Enterprise (3-seat min).
// Phase 4 (crypto) consumes the CRYPTO_VARIANTS subset (annual-only).
// Phase 5 (fiat, deferred) will add monthly + annual via Lemon Squeezy.

export const CRYPTO_DISCOUNT = 0.30; // 30% off annual fiat price
export const ENTERPRISE_MIN_SEATS = 3;

export type Tier = 'citizen' | 'pro' | 'desk' | 'enterprise';
export type BillingCycle = 'monthly' | 'annual' | 'lifetime';

// Client-safe tier label map. Lives here (not in lib/subscription.ts) so
// client components can import it without pulling in the server-only
// Supabase SSR helpers via lib/auth/session.
export const TIER_LABELS: Record<Tier, string> = {
  citizen: 'Citizen',
  pro: 'Pro',
  desk: 'Desk',
  enterprise: 'Enterprise',
};

// Variant id format: <tier>_<founding|standard>_<cycle>
// Crypto is annual-only, so only the four _annual variants are crypto-eligible.
export type CryptoVariantId =
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

// Pricing source of truth:
// Pro founding monthly = $29/mo   → annual $348  → crypto $244  (= $348 × 0.70 rounded)
// Pro standard monthly = $99/mo   → annual $1188 → crypto $832
// Enterprise founding  = $99/seat/mo → annual $1188/seat → crypto $832/seat → total $2496 for 3 seats
// Enterprise standard  = $199/seat/mo → annual $2388/seat → crypto $1671/seat → total $5013 for 3 seats

export const CRYPTO_VARIANTS: Record<CryptoVariantId, CryptoVariant> = {
  pro_founding_annual: {
    id: 'pro_founding_annual',
    tier: 'pro',
    billing_cycle: 'annual',
    is_founding: true,
    seats: 1,
    label: 'Pro · Founding Member · Annual (crypto)',
    fiat_per_seat_annual_usd_cents: 34_800,
    crypto_total_usd_cents: round(34_800 * (1 - CRYPTO_DISCOUNT)), // 24360 → $243.60
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
    crypto_total_usd_cents: round(118_800 * (1 - CRYPTO_DISCOUNT)), // 83160 → $831.60
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
      118_800 * ENTERPRISE_MIN_SEATS * (1 - CRYPTO_DISCOUNT),
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
      238_800 * ENTERPRISE_MIN_SEATS * (1 - CRYPTO_DISCOUNT),
    ), // 501480 → $5014.80
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
