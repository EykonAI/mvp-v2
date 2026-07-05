import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import TopNav from '@/components/TopNav';
import { getCurrentUser } from '@/lib/auth/session';
import { isFounder } from '@/lib/admin/access';
import { createServerSupabase } from '@/lib/supabase-server';
import { getBountyRateBps } from '@/lib/comm/bounty';
import BountyActions from './Actions';

export const metadata: Metadata = {
  title: 'Creator bounties — eYKON.ai',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

const STATUS_COLOR: Record<string, string> = {
  pending: 'var(--amber)',
  approved: 'var(--teal)',
  paid: 'var(--ink-faint)',
  void: 'var(--ink-faint)',
};

type AdminBountyRow = {
  id: string;
  creator_user_id: string;
  converted_user_id: string;
  space_id: string;
  plan_variant: string;
  base_amount_usd_cents: number;
  bounty_usd_cents: number;
  status: string;
  created_at: string;
  paid_at: string | null;
  creator: { display_name: string | null; handle: string | null } | null;
};

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default async function BountiesAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/signin?next=/admin/bounties');
  if (!isFounder(user)) redirect('/app');

  const admin = createServerSupabase();
  const { data } = await admin
    .from('creator_bounties')
    .select(
      'id, creator_user_id, converted_user_id, space_id, plan_variant, base_amount_usd_cents, bounty_usd_cents, status, created_at, paid_at, creator:user_profiles!creator_bounties_creator_user_id_fkey(display_name, handle)',
    )
    .order('created_at', { ascending: false })
    .limit(200);
  const rows = (data ?? []) as unknown as AdminBountyRow[];

  const owed = rows
    .filter(r => r.status === 'pending' || r.status === 'approved')
    .reduce((a, r) => a + r.bounty_usd_cents, 0);
  const paid = rows.filter(r => r.status === 'paid').reduce((a, r) => a + r.bounty_usd_cents, 0);

  return (
    <>
      <TopNav />
      <section style={{ maxWidth: 820, margin: '0 auto', padding: '40px 24px 80px', color: 'var(--ink)' }}>
        <div className="eyebrow" style={{ color: 'var(--teal)' }}>·· Admin · Creator bounties ··</div>
        <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 28, marginTop: 8, marginBottom: 6 }}>
          Conversion bounties
        </h1>
        <p style={{ fontSize: 13, color: 'var(--ink-dim)', marginBottom: 8, maxWidth: 620 }}>
          {getBountyRateBps() / 100}% of first-year revenue for the creator whose Space brought the
          converted user (earliest-joined active membership at upgrade time). Payouts are manual
          monthly USDC transfers — approve, pay, then mark paid.
        </p>
        <p style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--ink-dim)', marginBottom: 24 }}>
          Owed (pending + approved): <strong style={{ color: 'var(--teal)' }}>{usd(owed)}</strong>
          {' · '}Paid to date: <strong>{usd(paid)}</strong>
        </p>

        {rows.length === 0 ? (
          <div style={{ padding: 28, textAlign: 'center', border: '1px dashed var(--rule)', borderRadius: 8, color: 'var(--ink-faint)', fontSize: 13 }}>
            No bounties yet. A row appears the first time a paid-Space member upgrades their
            platform plan.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {rows.map(r => (
              <div
                key={r.id}
                style={{ border: '1px solid var(--rule)', borderRadius: 8, padding: '14px 16px', background: 'var(--bg-panel)' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: STATUS_COLOR[r.status] ?? 'var(--ink-faint)' }}>
                    {r.status}
                    {r.paid_at ? ` · ${new Date(r.paid_at).toISOString().slice(0, 10)}` : ''}
                  </div>
                  <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--ink-faint)' }}>
                    {new Date(r.created_at).toISOString().slice(0, 10)}
                  </div>
                </div>
                <div style={{ marginTop: 6, fontSize: 14 }}>
                  <strong>{usd(r.bounty_usd_cents)}</strong>
                  <span style={{ color: 'var(--ink-dim)' }}>
                    {' '}to {r.creator?.display_name || (r.creator?.handle ? `@${r.creator.handle}` : r.creator_user_id.slice(0, 8))}
                    {' '}· {r.plan_variant} · base {usd(r.base_amount_usd_cents)}
                  </span>
                </div>
                <BountyActions id={r.id} status={r.status} />
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
