import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase-server';
import { isFounder } from '@/lib/admin/access';
import { AdvocateAdminClient, type AdvocateRow, type CandidateRow } from './AdvocateAdminClient';

// /admin/advocates — founder-only admin panel.
//
// Five sections:
//   1. Candidates (top sharers with no advocate state yet)
//   2. Invited (awaiting partnership-doc countersign)
//   3. Active (earning commission)
//   4. Paused (no new referrals; existing ones continue)
//   5. Terminated (terminal; existing referrals continue per §2.7)
//
// Founder gate: lib/admin/access.ts uses FOUNDER_EMAILS env var.
// Without that var set, every request 404s — fail-closed.

export const dynamic = 'force-dynamic';

export default async function AdvocatesAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/signin?next=/admin/advocates');
  if (!isFounder(user)) {
    // 404 over 403 — admin existence shouldn't leak.
    redirect('/app');
  }

  const admin = createServerSupabase();
  const { data: rows } = await admin
    .from('user_profiles')
    .select(
      'id, email, display_name, public_id, advocate_state, advocate_invited_at, advocate_onboarded_at, advocate_terminated_at, rewardful_affiliate_id',
    )
    .neq('advocate_state', 'none')
    .order('advocate_state')
    .order('advocate_onboarded_at', { ascending: false, nullsFirst: false });

  const advocates: AdvocateRow[] = ((rows ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id ?? ''),
    email: (r.email as string | null) ?? null,
    display_name: (r.display_name as string | null) ?? null,
    public_id: String(r.public_id ?? ''),
    advocate_state: (r.advocate_state as AdvocateRow['advocate_state']) ?? 'none',
    advocate_invited_at: (r.advocate_invited_at as string | null) ?? null,
    advocate_onboarded_at: (r.advocate_onboarded_at as string | null) ?? null,
    advocate_terminated_at: (r.advocate_terminated_at as string | null) ?? null,
    rewardful_affiliate_id: (r.rewardful_affiliate_id as string | null) ?? null,
  }));

  // Candidate query is server-fetched once and passed to the client
  // component, which can refetch after a transition.
  const initialCandidates = await loadCandidates();

  return <AdvocateAdminClient advocates={advocates} initialCandidates={initialCandidates} />;
}

async function loadCandidates(): Promise<CandidateRow[]> {
  const admin = createServerSupabase();
  const since = new Date(Date.now() - 90 * 24 * 60 * 60_000).toISOString();

  const { data: referred } = await admin
    .from('user_profiles')
    .select('id, referred_by')
    .gte('created_at', since)
    .not('referred_by', 'is', null);

  const counts = new Map<string, number>();
  for (const r of referred ?? []) {
    const ref = (r as { referred_by: string | null }).referred_by;
    if (!ref) continue;
    counts.set(ref, (counts.get(ref) ?? 0) + 1);
  }

  const eligibleIds = [...counts.entries()]
    .filter(([, n]) => n >= 5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([id]) => id);

  if (eligibleIds.length === 0) return [];

  const { data: profiles } = await admin
    .from('user_profiles')
    .select('id, email, display_name, public_id')
    .in('id', eligibleIds)
    .eq('advocate_state', 'none');

  return ((profiles ?? []) as Array<Record<string, unknown>>)
    .map((p) => ({
      id: String(p.id ?? ''),
      email: (p.email as string | null) ?? null,
      display_name: (p.display_name as string | null) ?? null,
      public_id: String(p.public_id ?? ''),
      attributed_signups: counts.get(String(p.id ?? '')) ?? 0,
    }))
    .sort((a, b) => b.attributed_signups - a.attributed_signups);
}
