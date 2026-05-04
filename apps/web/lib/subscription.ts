import type { Tier } from './pricing';
import { getUserProfile } from './auth/session';

// SERVER-ONLY MODULE: this file imports from ./auth/session, which
// uses next/headers. It cannot be imported from a client component.
// All pure-data exports (MODULE_SLUGS, MODULE_LABELS, MODULE_TIERS,
// modulesByTier, tierMeetsRequirement, canAccessModule, etc.) live in
// ./intel/modules and are re-exported below for backwards compat with
// existing server-side consumers.
//
// Client components must import directly from '@/lib/intel/modules'.

export type { Tier } from './pricing';
export { TIER_LABELS } from './pricing';

export {
  MODULE_SLUGS,
  MODULE_LABELS,
  MODULE_TIER_REQUIREMENTS,
  MODULE_TIERS,
  modulesByTier,
  tierMeetsRequirement,
  canAccessModule,
  AI_QUERY_LIMITS,
  API_CALL_LIMITS,
  EXPORT_LIMITS,
} from './intel/modules';
export type { ModuleSlug, ModuleTier } from './intel/modules';

/**
 * Returns the viewer's tier. When NEXT_PUBLIC_AUTH_ENABLED is still 'false'
 * (dev / pre-Phase-2-activation), returns 'pro' so the app remains fully
 * explorable without a signed-in user. Once the flag flips to 'true', the
 * middleware guarantees a session on any (app)/* path, so getUserProfile()
 * returns a real row and we read tier from user_profiles.
 *
 * Server-only — uses next/headers cookies via getUserProfile.
 */
export async function getCurrentTier(): Promise<Tier> {
  if (process.env.NEXT_PUBLIC_AUTH_ENABLED !== 'true') {
    return 'pro';
  }
  const profile = await getUserProfile();
  return profile?.tier ?? 'citizen';
}
