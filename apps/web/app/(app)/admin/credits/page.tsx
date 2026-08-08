import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { isFounder } from '@/lib/admin/access';
import { createServerSupabase } from '@/lib/supabase-server';
import CreditsAdmin, { type PlanRow } from './CreditsAdmin';

export const metadata: Metadata = {
  title: 'FP test plans — eYKON.ai',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

export default async function CreditsAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/signin?next=/admin/credits');
  if (!isFounder(user)) redirect('/app');

  const admin = createServerSupabase();
  const { data: accounts } = await admin
    .from('user_credit_accounts')
    .select('user_id, label, budget_usd, spent_usd, deep_cap_pct, deep_spent_usd, status, created_at')
    .order('created_at', { ascending: false });

  const rows = (accounts ?? []) as Omit<PlanRow, 'name' | 'handle'>[];

  // Hydrate names (service-role read), same shape as /admin/partners.
  const ids = rows.map((r) => r.user_id);
  const { data: profiles } = ids.length
    ? await admin.from('user_profiles').select('id, display_name, handle').in('id', ids)
    : { data: [] as Array<{ id: string; display_name: string | null; handle: string | null }> };

  const byId = new Map(
    (profiles ?? []).map((p: any) => [p.id, { name: p.display_name ?? p.handle ?? '—', handle: p.handle }]),
  );

  const plans: PlanRow[] = rows.map((r) => ({
    ...r,
    budget_usd: Number(r.budget_usd),
    spent_usd: Number(r.spent_usd),
    deep_cap_pct: Number(r.deep_cap_pct),
    deep_spent_usd: Number(r.deep_spent_usd),
    name: byId.get(r.user_id)?.name ?? '—',
    handle: byId.get(r.user_id)?.handle ?? null,
  }));

  return (
    <section style={{ maxWidth: 1100, margin: '0 auto', padding: '30px 22px 60px' }}>
      <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 24, margin: '0 0 6px' }}>
        Founding Partner test plans
      </h1>
      <p style={{ fontSize: 13.5, color: 'var(--ink-dim)', margin: '0 0 8px', lineHeight: 1.6, maxWidth: 760 }}>
        A metered evaluation account: full Pro capability, bounded by a Claude budget you set per
        plan. Deep Analysis is separately capped so one careless session cannot eat the whole
        allowance.
      </p>
      <p style={{ fontSize: 12.5, color: 'var(--ink-dim)', margin: '0 0 24px', lineHeight: 1.6, maxWidth: 760 }}>
        Top-ups are founder-issued by design — the real-money checkout path is still unproven, and a
        partner&rsquo;s top-up must not be the first live transaction in system history.
      </p>

      <CreditsAdmin plans={plans} />
    </section>
  );
}
