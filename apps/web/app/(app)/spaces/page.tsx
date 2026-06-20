import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import TopNav from '@/components/TopNav';
import { getCurrentUser } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase-server';
import { listSpaces, canCreateSpace, type SpaceSummary } from '@/lib/comm/spaces';
import { CreateSpace } from '@/components/comm/CreateSpace';

export const metadata: Metadata = { title: 'Spaces — eYKON.ai', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function SpacesPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/signin?next=/spaces');

  const supabase = createServerSupabase();
  const [spaces, gate] = await Promise.all([listSpaces(supabase, user.id), canCreateSpace(supabase, user)]);

  return (
    <>
      <TopNav />
      <section style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px 80px', color: 'var(--ink)' }}>
        <div className="eyebrow" style={{ color: 'var(--teal)' }}>·· Spaces ··</div>
        <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 28, marginTop: 8, marginBottom: 6 }}>Paid spaces</h1>
        <p style={{ fontSize: 13, color: 'var(--ink-dim)', margin: '0 0 20px', lineHeight: 1.5 }}>
          Subscription communities run by calibrated analysts — each a private room with the in-room AI analyst.
          Non-custodial USDC; subscriptions open soon.
        </p>

        {gate.ok ? (
          <CreateSpace />
        ) : (
          <div style={{ border: '1px dashed var(--rule)', borderRadius: 8, padding: '12px 14px', color: 'var(--ink-faint)', fontSize: 12, marginBottom: 18, lineHeight: 1.5 }}>
            {gate.reason} Climb the{' '}
            <Link href="/leaderboard" style={{ color: 'var(--teal)', textDecoration: 'none' }}>
              leaderboard
            </Link>{' '}
            to unlock paid spaces.
          </div>
        )}

        {spaces.length === 0 ? (
          <div style={{ padding: 28, textAlign: 'center', border: '1px dashed var(--rule)', borderRadius: 8, color: 'var(--ink-faint)', fontSize: 13 }}>
            No spaces yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {spaces.map((s) => (
              <SpaceCard key={s.id} s={s} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function SpaceCard({ s }: { s: SpaceSummary }) {
  return (
    <Link
      href={`/spaces/${s.id}`}
      style={{ display: 'block', padding: '13px 15px', borderRadius: 8, textDecoration: 'none', border: '1px solid var(--rule-soft)', background: 'var(--bg-panel)' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <span style={{ color: 'var(--ink)', fontSize: 15, fontWeight: 600 }}>{s.title ?? 'Untitled space'}</span>
        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--teal)', flexShrink: 0 }}>
          {fmtUsdc(s.price_usdc)} USDC / {s.cadence === 'annual' ? 'yr' : 'mo'}
        </span>
      </div>
      {s.blurb && <p style={{ color: 'var(--ink-dim)', fontSize: 12.5, margin: '6px 0 0', lineHeight: 1.5 }}>{s.blurb}</p>}
      <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 8 }}>
        {s.creator ? `by ${s.creator.name}` : 'by —'} · {s.subscriber_count} subscriber{s.subscriber_count === 1 ? '' : 's'}
        {s.is_creator ? ' · yours' : s.is_subscribed ? ' · subscribed' : ''}
      </div>
    </Link>
  );
}

function fmtUsdc(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
