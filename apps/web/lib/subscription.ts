import type { Tier } from './pricing';
import { getUserProfile } from './auth/session';
import { createServerSupabase } from './supabase-server';

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

// Week Pass (mig 075): rank map for combining the profile tier with an
// active tier override — the override never DOWNGRADES (a desk user
// with a stray pass row stays desk).
const TIER_RANK: Record<Tier, number> = {
  citizen: 0,
  member: 1,
  pro: 2,
  desk: 3,
  enterprise: 4,
};

async function activeOverrideTier(userId: string): Promise<Tier | null> {
  const admin = createServerSupabase();
  const { data } = await admin
    .from('tier_overrides')
    .select('tier, expires_at')
    .eq('user_id', userId)
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.tier as Tier) ?? null;
}

/**
 * Returns the viewer's tier. When NEXT_PUBLIC_AUTH_ENABLED is still 'false'
 * (dev / pre-Phase-2-activation), returns 'pro' so the app remains fully
 * explorable without a signed-in user. Once the flag flips to 'true', the
 * middleware guarantees a session on any (app)/* path, so getUserProfile()
 * returns a real row and we read tier from user_profiles — raised to an
 * active Week Pass override (tier_overrides, mig 075) when one exists.
 * Expiry is a timestamp comparison, so a lapsed pass degrades cleanly on
 * the next request with no cron involved.
 *
 * Server-only — uses next/headers cookies via getUserProfile.
 */
export async function getCurrentTier(): Promise<Tier> {
  if (process.env.NEXT_PUBLIC_AUTH_ENABLED !== 'true') {
    return 'pro';
  }
  const profile = await getUserProfile();
  const base: Tier = profile?.tier ?? 'citizen';
  if (!profile?.id) return base;
  // Only look up overrides below the override tier — pro+ can't gain.
  if (TIER_RANK[base] >= TIER_RANK.pro) return base;
  const override = await activeOverrideTier(profile.id);
  if (override && TIER_RANK[override] > TIER_RANK[base]) return override;
  return base;
}
