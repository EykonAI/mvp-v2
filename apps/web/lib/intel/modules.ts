// Pure-data module registry for the Intelligence Center workspaces.
// Lives in its own file (not lib/subscription.ts) because it must be
// importable by client components — and lib/subscription.ts pulls in
// lib/auth/session.ts → next/headers, which only works in Server
// Components. PR 51 introduced client imports from subscription.ts
// which broke the production build; this module is the fix.
//
// Server-side consumers (intel/layout.tsx, /api routes, settings/page.tsx)
// continue to import from lib/subscription.ts, which re-exports the
// names below for backwards compatibility.

import type { Tier } from '../pricing';

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

// ─── Workspace surfacing tier (product decision 2026-05-04) ────────
// Tiering is a presentation concern — every workspace stays Pro+
// accessible. Visibility:
//   • 'hero'     — primary nav strip, prominent treatment.
//   • 'visible'  — secondary nav strip, subtler weight.
//   • 'advanced' — surfaced only via the right-aligned "Advanced
//                  Scenarios" entry that lands on /intel/advanced.

export type ModuleTier = 'hero' | 'visible' | 'advanced';

export const MODULE_TIERS: Record<ModuleSlug, ModuleTier> = {
  calibration: 'hero',
  'shadow-fleet': 'hero',
  'regime-shifts': 'hero',
  commodities: 'visible',
  minerals: 'visible',
  chokepoint: 'advanced',
  sanctions: 'advanced',
  cascade: 'advanced',
  'precursor-analogs': 'advanced',
};

export function modulesByTier(tier: ModuleTier): ModuleSlug[] {
  return MODULE_SLUGS.filter(slug => MODULE_TIERS[slug] === tier);
}

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
  enterprise: 1_000_000,
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
