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
  member: 1,
  pro: 2,
  desk: 3,
  enterprise: 4,
};

export function tierMeetsRequirement(userTier: Tier, requirement: Tier): boolean {
  return TIER_ORDER[userTier] >= TIER_ORDER[requirement];
}

export function canAccessModule(userTier: Tier, slug: ModuleSlug): boolean {
  return tierMeetsRequirement(userTier, MODULE_TIER_REQUIREMENTS[slug]);
}

// Monthly caps per tier — source of truth for /api/chat rate limiting.
// Citizen = 5 per the trial-mechanism brief §5.1: enough for a prospect
// to feel the analyst's quality on a real question, low enough that
// freeloader scraping is cost-prohibitive. Citizen queries are also
// constrained to the "cheap" tool subset — see CITIZEN_AI_TOOLS in
// lib/anthropic.ts. Member = 25/month on the standard tool surface
// (monetisation review §4.1: enough to check a Creator's claim, not
// enough to do the Creator's job). Pro+ get the full tool surface.
export const AI_QUERY_LIMITS: Record<Tier, number> = {
  citizen: 5,
  member: 25,
  pro: 500,
  desk: 5_000,
  enterprise: 1_000_000,
};

export const API_CALL_LIMITS: Record<Tier, number> = {
  citizen: 0,
  member: 0,
  pro: 0,
  desk: 10_000,
  enterprise: 1_000_000,
};

export const EXPORT_LIMITS: Record<Tier, number> = {
  citizen: 0,
  member: 0,
  pro: 100,
  desk: 1_000,
  enterprise: 1_000_000,
};

// Maximum concurrent watchlists per user, per tier. Citizen is capped at 1
// to create real pressure on heavy free-tier users (Path 1 conversion in
// the trial-mechanism brief §5.4). Member gets a small allowance in the
// participate-not-analyse spirit. Pro/Desk/Enterprise are generous.
export const WATCHLIST_LIMITS: Record<Tier, number> = {
  citizen: 1,
  member: 3,
  pro: 25,
  desk: 100,
  enterprise: 1_000_000,
};

// Feed delay: NONE, for every tier — decided 2026-07-04. The old
// Citizen 24h "delay" on /api/vessels could never return a true
// delayed snapshot: vessel_positions is upsert-keyed on mmsi
// (migration 012, one row per vessel refreshed in place), so the
// delayed-window query returned only vessels that went dark N hours
// ago — a ghost fleet (~310 stale vessels vs ~21k live, measured on
// prod 2026-07-04) — the same structural reason /api/aircraft was
// always exempted. Rather than build a snapshot time-series to make
// the delay real, all raw feeds are live for all tiers; the paid
// differentiation is the intelligence layer (AI-query budgets, INTEL
// workspaces, alerts, exports) — see the tier limit maps above.

// ─── Citizen Intelligence Center access (trial-mechanism brief §5.2) ───
// Citizens see one live workspace (Calibration Ledger, read-only) and
// eight visible-but-inert tiles. Any click on an inert tile routes to
// /pricing?from=intel_<slug>. Pro+ users see all nine live.
export const MODULE_PREVIEW_FOR_CITIZEN: readonly ModuleSlug[] = ['calibration'];
export const MODULE_INERT_FOR_CITIZEN: readonly ModuleSlug[] = MODULE_SLUGS.filter(
  slug => !MODULE_PREVIEW_FOR_CITIZEN.includes(slug),
);

export type CitizenIntelAccess = 'preview' | 'inert';

export function citizenIntelAccess(slug: ModuleSlug): CitizenIntelAccess {
  return MODULE_PREVIEW_FOR_CITIZEN.includes(slug) ? 'preview' : 'inert';
}

export function isCitizenInert(slug: ModuleSlug): boolean {
  return citizenIntelAccess(slug) === 'inert';
}
