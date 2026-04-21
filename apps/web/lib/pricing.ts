// Canonical pricing constants — derived from
// `Marketing & Sales/Road to Market/eYKON_pricing_page_wireframe.html`
// and `memory/project_pricing_tiers.md`.
//
// Phase 4 (crypto) consumes only the CRYPTO_VARIANTS subset (annual-only).
// Phase 5 (fiat) will add monthly + lifetime via Lemon Squeezy variant IDs.
// Phase 7 (pricing page) will extend this file with UI labels + features.

export const CRYPTO_DISCOUNT = 0.30; // 30 % off annual fiat price

export type Tier = 'citizen' | 'pro' | 'desk' | 'enterprise';
export type BillingCycle = 'monthly' | 'annual' | 'lifetime';

// Variant id format:  <tier>_<founding|standard>_<cycle>
// Example: 'pro_founding_annual', 'desk_standard_annual'.
export type CryptoVariantId =
  | 'pro_founding_annual'
  | 'pro_standard_annual';
// Desk-tier crypto is not sold self-serve on Day 10 (3-seat minimum is
// handled by a "Contact sales" form). Add desk_*_annual here when that
// scope re-opens.

export type CryptoVariant = {
  id: CryptoVariantId;
  tier: Tier;
  billing_cycle: 'annual';
  is_founding: boolean;
  seats: number;
  label: string;
  fiat_annual_eur_cents: number;       // headline annual price in EUR cents
  crypto_amount_eur_cents: number;     // fiat × (1 - CRYPTO_DISCOUNT), rounded
  crypto_price_currency: 'eur';        // billed in EUR on NOWPayments
};

const round = (x: number) => Math.round(x);

export const CRYPTO_VARIANTS: Record<CryptoVariantId, CryptoVariant> = {
  pro_founding_annual: {
    id: 'pro_founding_annual',
    tier: 'pro',
    billing_cycle: 'annual',
    is_founding: true,
    seats: 1,
    label: 'Pro · Founding Member · Annual (crypto)',
    fiat_annual_eur_cents: 19000,        // €190/yr founding
    crypto_amount_eur_cents: round(19000 * (1 - CRYPTO_DISCOUNT)), // €133
    crypto_price_currency: 'eur',
  },
  pro_standard_annual: {
    id: 'pro_standard_annual',
    tier: 'pro',
    billing_cycle: 'annual',
    is_founding: false,
    seats: 1,
    label: 'Pro · Standard · Annual (crypto)',
    fiat_annual_eur_cents: 29000,        // €290/yr standard
    crypto_amount_eur_cents: round(29000 * (1 - CRYPTO_DISCOUNT)), // €203
    crypto_price_currency: 'eur',
  },
};

export function getCryptoVariant(id: string): CryptoVariant | null {
  if ((CRYPTO_VARIANTS as Record<string, CryptoVariant>)[id]) {
    return (CRYPTO_VARIANTS as Record<string, CryptoVariant>)[id];
  }
  return null;
}

export function formatEur(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}
