import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CommChatShell } from '@/components/comm/CommChatShell';
import { getCurrentUser } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase-server';
import { listManageSpaces } from '@/lib/comm/spaces';
import { loadCreatorEarnings } from '@/lib/comm/bounty';
import { isCreatorPro } from '@/lib/comm/creatorPro';

export const metadata: Metadata = {
  title: 'Creator dashboard — eYKON.ai',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// Creator Pro analytics (monetisation review §4.3). The dashboard is
// the Creator-Pro-gated layer; the basic earnings panel on the Spaces
// Manage tab stays free for every creator.
export default async function CreatorDashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/signin?next=/creator/dashboard');

  const admin = createServerSupabase();
  const pro = await isCreatorPro(admin, user.id);
  if (!pro) {
    return (
      <CommChatShell>
        <section style={{ maxWidth: 680, margin: '0 auto', padding: '40px 24px 80px', color: 'var(--ink)' }}>
          <div className="eyebrow" style={{ color: 'var(--teal)' }}>·· Creator dashboard ··</div>
          <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 26, marginTop: 8 }}>Creator Pro feature</h1>
          <p style={{ fontSize: 13.5, color: 'var(--ink-dim)', lineHeight: 1.6, maxWidth: 520 }}>
            Subscriber growth, churn, conversion earnings and reputation-card traffic in one view.
            Part of Creator Pro — the first 50 creators claim it free for life.
          </p>
          <Link href="/creator-pro" style={{ color: 'var(--teal)', textDecoration: 'none', fontFamily: 'var(--f-mono)', fontSize: 13 }}>
            Claim your founding slot →
          </Link>
        </section>
      </CommChatShell>
    );
  }

  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [spaces, earnings, profile] = await Promise.all([
    listManageSpaces(admin, user.id),
    loadCreatorEarnings(admin, user.id),
    admin.from('user_profiles').select('handle, public_id').eq('id', user.id).maybeSingle(),
  ]);
  const spaceIds = spaces.map(s => s.id);
  const slug = profile.data?.handle ?? profile.data?.public_id ?? null;

  // New active subs joined and subs expired in the last 30 days, plus
  // reputation-card touches (channel_touchpoints where channel=repcard,
  // utm_content=<slug>). Empty space list short-circuits to zeros.
  const [newSubs, churned, cardTouches] = await Promise.all([
    spaceIds.length
      ? admin
          .from('comm_space_subscriptions')
          .select('id', { count: 'exact', head: true })
          .in('space_id', spaceIds)
          .eq('status', 'active')
          .gte('created_at', since30)
      : Promise.resolve({ count: 0 }),
    spaceIds.length
      ? admin
          .from('comm_space_subscriptions')
          .select('id', { count: 'exact', head: true })
          .in('space_id', spaceIds)
          .eq('status', 'expired')
          .gte('expires_at', since30)
      : Promise.resolve({ count: 0 }),
    slug
      ? admin
          .from('channel_touchpoints')
          .select('id', { count: 'exact', head: true })
          .eq('channel', 'repcard')
          .eq('utm_content', slug)
          .gte('created_at', since30)
      : Promise.resolve({ count: 0 }),
  ]);

  const stat: React.CSSProperties = { border: '1px solid var(--rule)', borderRadius: 8, padding: '12px 14px', background: 'var(--bg-panel)', minWidth: 140, flex: 1 };
  const statLabel: React.CSSProperties = { fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-faint)' };
  const statValue: React.CSSProperties = { fontFamily: 'var(--f-display)', fontSize: 22, color: 'var(--ink)', marginTop: 4 };

  return (
    <CommChatShell>
      <section style={{ maxWidth: 760, margin: '0 auto', padding: '40px 24px 80px', color: 'var(--ink)' }}>
        <div className="eyebrow" style={{ color: 'var(--teal)' }}>·· Creator dashboard · last 30 days ··</div>
        <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 28, marginTop: 8, marginBottom: 18 }}>
          Your Spaces, measured
        </h1>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
          <div style={stat}>
            <div style={statLabel}>New subscribers</div>
            <div style={statValue}>{newSubs.count ?? 0}</div>
          </div>
          <div style={stat}>
            <div style={statLabel}>Churned</div>
            <div style={statValue}>{churned.count ?? 0}</div>
          </div>
          <div style={stat}>
            <div style={statLabel}>Conversion earnings accrued</div>
            <div style={statValue}>{usd(earnings.pendingUsdCents)}</div>
          </div>
          <div style={stat}>
            <div style={statLabel}>Reputation-card visits</div>
            <div style={statValue}>{cardTouches.count ?? 0}</div>
          </div>
        </div>

        <h2 style={{ fontFamily: 'var(--f-display)', fontSize: 18, margin: '0 0 10px' }}>Per Space</h2>
        {spaces.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', border: '1px dashed var(--rule)', borderRadius: 8, color: 'var(--ink-faint)', fontSize: 13 }}>
            No Spaces yet —{' '}
            <Link href="/spaces?tab=manage" style={{ color: 'var(--teal)', textDecoration: 'none' }}>
              open one
            </Link>
            .
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {spaces.map(s => (
              <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, border: '1px solid var(--rule)', borderRadius: 8, padding: '10px 14px', background: 'var(--bg-panel)', flexWrap: 'wrap' }}>
                <div>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{s.title ?? 'Untitled space'}</span>
                  <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--ink-faint)', marginLeft: 10 }}>
                    {s.status}{s.lock_status === 'ready' ? ' · ● live lock' : ''}
                  </span>
                </div>
                <div style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--ink-dim)' }}>
                  {s.subscriber_count} subs · {s.price_usdc} USDC/{s.cadence === 'annual' ? 'yr' : 'mo'}
                  {' · ≈ '}{(s.subscriber_count * s.price_usdc * 0.85).toFixed(2)} USDC/{s.cadence === 'annual' ? 'yr' : 'mo'} to you
                </div>
              </div>
            ))}
          </div>
        )}

        <p style={{ fontSize: 12, color: 'var(--ink-faint)', marginTop: 18, lineHeight: 1.6 }}>
          Bounty detail lives on{' '}
          <Link href="/spaces?tab=manage" style={{ color: 'var(--teal)', textDecoration: 'none' }}>
            Spaces → Manage
          </Link>
          . Card embed code is on{' '}
          <Link href="/creator-pro" style={{ color: 'var(--teal)', textDecoration: 'none' }}>
            Creator Pro
          </Link>
          . “To you” assumes the standard 15% platform fee.
        </p>
      </section>
    </CommChatShell>
  );
}
