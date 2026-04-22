import type { Tier } from './pricing';
import { getUserProfile } from './auth/session';

export type { Tier } from './pricing';
// Re-exported for backwards compat with any server callers that used to
// read TIER_LABELS from here. Client components should import it from
// '@/lib/pricing' directly (to avoid pulling in the server-only
// getUserProfile dependency).
export { TIER_LABELS } from './pricing';

export const MODULE_SLUGS = [
  'calibration',
  'cascade',
  'chokepoint',
  'commodities',
  'minerals',
  'precursor-analogs',
  'regime-shifts',
  'sanctions',
  'shadow-fleet',
] as const;
export type ModuleSlug = (typeof MODULE_SLUGS)[number];

export const MODULE_LABELS: Record<ModuleSlug, string> = {
  calibration: 'Calibration Ledger',
  cascade: 'Cascade Propagation',
  chokepoint: 'Chokepoint Simulator',
  commodities: 'Commodities Workspace',
  minerals: 'Critical Minerals',
  'precursor-analogs': 'Precursor Analogs',
  'regime-shifts': 'Regime Shifts',
  sanctions: 'Sanctions Wargame',
  'shadow-fleet': 'Shadow Fleet',
};

// Minimum tier to access each Intelligence Center workspace. Day-10 launch:
// every module requires Pro. Citizen gets the globe + daily briefing only.
// Per-module tuning is open — edit this map in a migration-scoped PR so the
// pricing page FAQ and marketing copy can be updated alongside.
export const MODULE_TIER_REQUIREMENTS: Record<ModuleSlug, Tier> = {
  calibration: 'pro',
  cascade: 'pro',
  chokepoint: 'pro',
  commodities: 'pro',
  minerals: 'pro',
  'precursor-analogs': 'pro',
  'regime-shifts': 'pro',
  sanctions: 'pro',
  'shadow-fleet': 'pro',
};

const TIER_ORDER: Record<Tier, number> = {
  citizen: 0,
  pro: 1,
  desk: 2,
  enterprise: 3,
};

export function tierMeetsRequirement(userTier: Tier, requirement: Tier): boolean {
  return TIER_ORDER[userTier] >= TIER_ORDER[requirement];
}

export function canAccessModule(userTier: Tier, slug: ModuleSlug): boolean {
  return tierMeetsRequirement(userTier, MODULE_TIER_REQUIREMENTS[slug]);
}

// Monthly caps per tier — source of truth for /api/chat rate limiting.
// memory/project_pricing_tiers.md: Pro 500/mo, Desk 5,000/mo/seat.
export const AI_QUERY_LIMITS: Record<Tier, number> = {
  citizen: 0,
  pro: 500,
  desk: 5_000,
  enterprise: 1_000_000, // enforced via custom contract; effectively unlimited
};

export const API_CALL_LIMITS: Record<Tier, number> = {
  citizen: 0,
  pro: 0,
  desk: 10_000,
  enterprise: 1_000_000,
};

export const EXPORT_LIMITS: Record<Tier, number> = {
  citizen: 0,
  pro: 100,
  desk: 1_000,
  enterprise: 1_000_000,
};

/**
 * Returns the viewer's tier. When NEXT_PUBLIC_AUTH_ENABLED is still 'false'
 * (dev / pre-Phase-2-activation), returns 'pro' so the app remains fully
 * explorable without a signed-in user. Once the flag flips to 'true', the
 * middleware guarantees a session on any (app)/* path, so getUserProfile()
 * returns a real row and we read tier from user_profiles.
 */
export async function getCurrentTier(): Promise<Tier> {
  if (process.env.NEXT_PUBLIC_AUTH_ENABLED !== 'true') {
    return 'pro';
  }
  const profile = await getUserProfile();
  return profile?.tier ?? 'citizen';
}
