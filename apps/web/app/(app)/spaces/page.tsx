import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CommChatShell } from '@/components/comm/CommChatShell';
import { getCurrentUser } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase-server';
import {
  listSpaces,
  listMySubscriptions,
  listManageSpaces,
  canCreateSpace,
  type SpaceSummary,
} from '@/lib/comm/spaces';
import { CreateSpace } from '@/components/comm/CreateSpace';
import { ManageSpaces } from '@/components/comm/ManageSpaces';
import { ReputationNote } from '@/components/profile/ReputationNote';
import { loadCreatorEarnings, getBountyRateBps, type CreatorEarnings } from '@/lib/comm/bounty';

export const metadata: Metadata = { title: 'Spaces — eYKON.ai', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const TABS = ['discover', 'subscriptions', 'manage'] as const;
type Tab = (typeof TABS)[number];

function pickTab(raw: string | string[] | undefined): Tab {
  const v = typeof raw === 'string' ? raw : '';
  return (TABS as readonly string[]).includes(v) ? (v as Tab) : 'discover';
}

export default async function SpacesPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/signin?next=/spaces');
  const tab = pickTab(searchParams?.tab);

  const supabase = createServerSupabase();
  const [discover, mySubs, manage, gate, earnings] = await Promise.all([
    listSpaces(supabase, user.id),
    listMySubscriptions(supabase, user.id),
    listManageSpaces(supabase, user.id),
    canCreateSpace(supabase, user),
    loadCreatorEarnings(supabase, user.id),
  ]);

  return (
    <CommChatShell>
      <section style={{ maxWidth: 760, margin: '0 auto', padding: '40px 24px 80px', color: 'var(--ink)' }}>
        <div className="eyebrow" style={{ color: 'var(--teal)' }}>·· Spaces ··</div>
        <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 28, marginTop: 8, marginBottom: 6 }}>Paid spaces</h1>
        <p style={{ fontSize: 13, color: 'var(--ink-dim)', margin: '0 0 18px', lineHeight: 1.5 }}>
          Subscription communities run by calibrated analysts — each a private room with the in-room AI analyst.
          Non-custodial USDC via Unlock on Base.
        </p>

        <nav style={{ display: 'flex', gap: 20, borderBottom: '1px solid var(--rule)', marginBottom: 18 }}>
          {TABS.map((t) => (
            <Link
              key={t}
              href={`/spaces?tab=${t}`}
              style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 12,
                letterSpacing: '0.04em',
                textTransform: 'capitalize',
                textDecoration: 'none',
                color: t === tab ? 'var(--teal)' : 'var(--ink-dim)',
                borderBottom: t === tab ? '2px solid var(--teal)' : '2px solid transparent',
                paddingBottom: 10,
              }}
            >
              {t === 'subscriptions' ? `Subscriptions${mySubs.length ? ` (${mySubs.length})` : ''}` : t}
            </Link>
          ))}
        </nav>

        {tab === 'discover' && (
          discover.length === 0 ? (
            <Empty>No spaces yet. Calibrated analysts can open one from the Manage tab.</Empty>
          ) : (
            <CardList spaces={discover} />
          )
        )}

        {tab === 'subscriptions' && (
          mySubs.length === 0 ? (
            <Empty>You haven’t subscribed to any spaces yet — browse Discover to find analysts worth following.</Empty>
          ) : (
            <CardList spaces={mySubs} />
          )
        )}

        {tab === 'manage' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {gate.ok ? (
              <CreateSpace />
            ) : (
              <div style={{ border: '1px dashed var(--rule)', borderRadius: 8, padding: '12px 14px', color: 'var(--ink-faint)', fontSize: 12, lineHeight: 1.5 }}>
                {gate.reason} Climb the{' '}
                <Link href="/leaderboard" style={{ color: 'var(--teal)', textDecoration: 'none' }}>
                  leaderboard
                </Link>{' '}
                to unlock paid spaces.
              </div>
            )}
            <ManageSpaces spaces={manage} />
            {(manage.length > 0 || earnings.rows.length > 0) && (
              <EarningsPanel earnings={earnings} />
            )}
          </div>
        )}
      </section>
    </CommChatShell>
  );
}

function CardList({ spaces }: { spaces: SpaceSummary[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {spaces.map((s) => (
        <SpaceCard key={s.id} s={s} />
      ))}
    </div>
  );
}

// Credibility-forward card (§4.1): the creator's identity + Reputation Note
// lead, before the title and price — "is this creator any good?" answered first.
function SpaceCard({ s }: { s: SpaceSummary }) {
  const ready = s.lock_status === 'ready';
  return (
    <div
      style={{
        border: '1px solid var(--rule-soft)',
        // Creator Pro branding (mig 074): accent stripe when set.
        borderLeft: s.accent_color ? `3px solid ${s.accent_color}` : '1px solid var(--rule-soft)',
        borderRadius: 8,
        background: 'var(--bg-panel)',
        padding: '13px 15px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
        {s.creator ? (
          <Link
            href={`/u/${s.creator.slug}`}
            style={{ color: 'var(--ink-dim)', fontFamily: 'var(--f-mono)', fontSize: 11, textDecoration: 'none' }}
          >
            {s.creator.name}
          </Link>
        ) : (
          <span style={{ color: 'var(--ink-faint)', fontFamily: 'var(--f-mono)', fontSize: 11 }}>—</span>
        )}
        {s.creator && <ReputationNote size="badge" note={s.creator.note} nResolved={s.creator.nResolved} />}
      </div>

      <Link href={`/spaces/${s.id}`} style={{ display: 'block', textDecoration: 'none' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
          <span style={{ color: 'var(--ink)', fontSize: 15, fontWeight: 600 }}>{s.title ?? 'Untitled space'}</span>
          <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--teal)', flexShrink: 0 }}>
            {fmtUsdc(s.price_usdc)} USDC / {s.cadence === 'annual' ? 'yr' : 'mo'}
          </span>
        </div>
        {s.blurb && <p style={{ color: 'var(--ink-dim)', fontSize: 12.5, margin: '6px 0 0', lineHeight: 1.5 }}>{s.blurb}</p>}
        <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 8 }}>
          {s.subscriber_count} subscriber{s.subscriber_count === 1 ? '' : 's'}
          {s.is_creator ? ' · yours' : s.is_subscribed ? ' · subscribed' : ''}
          {ready ? ' · ● live' : ' · setup pending'}
        </div>
      </Link>
    </div>
  );
}

// Conversion earnings (mig 073): visible to EVERY creator, not gated —
// the bounty only motivates if creators can see it accrue. Server-
// rendered from the service-role read (creator_bounties is RLS-no-policy).
function EarningsPanel({ earnings }: { earnings: CreatorEarnings }) {
  const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  return (
    <div style={{ border: '1px solid var(--rule)', borderRadius: 8, padding: '14px 16px', background: 'var(--bg-panel)' }}>
      <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--teal)', marginBottom: 8 }}>
        Conversion earnings
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--ink-dim)', margin: '0 0 10px', lineHeight: 1.5 }}>
        When a member of your Space upgrades to an eYKON plan, you earn{' '}
        {getBountyRateBps() / 100}% of their first-year subscription — on top of your Space
        revenue. Paid monthly in USDC.
      </p>
      <div style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--ink)' }}>
        Accrued: <strong style={{ color: 'var(--teal)' }}>{usd(earnings.pendingUsdCents)}</strong>
        {' · '}Paid out: <strong>{usd(earnings.paidUsdCents)}</strong>
        {' · '}{earnings.rows.length} conversion{earnings.rows.length === 1 ? '' : 's'}
      </div>
      {earnings.rows.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {earnings.rows.slice(0, 5).map(r => (
            <div key={r.id} style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--ink-faint)' }}>
              {new Date(r.created_at).toISOString().slice(0, 10)} · {usd(r.bounty_usd_cents)} · {r.plan_variant} · {r.status}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: 28, textAlign: 'center', border: '1px dashed var(--rule)', borderRadius: 8, color: 'var(--ink-faint)', fontSize: 13, lineHeight: 1.6 }}>
      {children}
    </div>
  );
}

function fmtUsdc(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
