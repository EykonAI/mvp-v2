import type { SupabaseClient } from '@supabase/supabase-js';

// Creator Pro (monetisation review §4.3, mig 074) — an orthogonal
// grant, NOT a platform tier. $20/mo headline; the first 50 creators
// claim free-for-life slots. Paid grants ($200/yr, NOWPayments) open
// only at the review's sequencing gate (≥100 paid Space subs across
// ≥5 Spaces) — the schema already supports them.
//
// Integrity invariant: nothing in this module may gate the Reputation
// Note itself. Creator Pro gates DISTRIBUTION (embeddable card,
// dashboard, branding, Discover boost) — never the on-platform score.

export const CREATOR_PRO_FREE_CAP = 50;
export const CREATOR_PRO_MONTHLY_USD = 20; // headline; billing deferred

export type CreatorProGrant = {
  user_id: string;
  source: 'free50' | 'paid';
  lifetime_free: boolean;
  claimed_at: string;
  expires_at: string | null;
};

export async function getCreatorProGrant(
  admin: SupabaseClient,
  userId: string,
): Promise<CreatorProGrant | null> {
  const { data } = await admin
    .from('creator_pro_grants')
    .select('user_id, source, lifetime_free, claimed_at, expires_at')
    .eq('user_id', userId)
    .maybeSingle();
  return (data as CreatorProGrant) ?? null;
}

export function grantIsActive(grant: CreatorProGrant | null): boolean {
  if (!grant) return false;
  if (grant.lifetime_free) return true;
  return !!grant.expires_at && new Date(grant.expires_at).getTime() > Date.now();
}

export async function isCreatorPro(admin: SupabaseClient, userId: string): Promise<boolean> {
  return grantIsActive(await getCreatorProGrant(admin, userId));
}

export async function freeSlotsRemaining(admin: SupabaseClient): Promise<number> {
  const { count } = await admin
    .from('creator_pro_grants')
    .select('user_id', { count: 'exact', head: true })
    .eq('source', 'free50');
  return Math.max(CREATOR_PRO_FREE_CAP - (count ?? 0), 0);
}

// Owns ≥1 non-archived Space — the eligibility line for "Creator".
export async function isEligibleCreator(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { count } = await admin
    .from('comm_spaces')
    .select('space_id', { count: 'exact', head: true })
    .eq('creator_id', userId)
    .neq('status', 'archived');
  return (count ?? 0) > 0;
}

export async function claimFreeSlot(
  admin: SupabaseClient,
  userId: string,
): Promise<{ claimed: boolean; slotsLeft: number } | { error: string }> {
  const { data, error } = await admin.rpc('claim_creator_pro_free_slot', {
    p_user_id: userId,
  });
  if (error) return { error: error.message };
  const row = Array.isArray(data) ? data[0] : data;
  return { claimed: row?.claimed === true, slotsLeft: row?.slots_left ?? 0 };
}
