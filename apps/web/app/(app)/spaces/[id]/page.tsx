import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import TopNav from '@/components/TopNav';
import { getCurrentUser } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase-server';
import { loadSpace } from '@/lib/comm/spaces';
import { loadMessages, markRead } from '@/lib/comm/dm';
import { Thread } from '@/components/comm/Thread';
import { AskAnalyst } from '@/components/comm/AskAnalyst';
import { getAnalystId } from '@/lib/comm/analyst';

export const metadata: Metadata = { title: 'Space — eYKON.ai', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function SpacePage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/signin');

  const supabase = createServerSupabase();
  const space = await loadSpace(supabase, params.id, user.id);
  if (!space) notFound();

  const initial = space.is_member ? await loadMessages(supabase, params.id, undefined, user.id) : [];
  if (space.is_member) await markRead(supabase, params.id, user.id);
  const analystId = getAnalystId();

  return (
    <>
      <TopNav />
      <section style={{ maxWidth: 720, margin: '0 auto', padding: '24px', color: 'var(--ink)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
          <Link href="/spaces" style={{ color: 'var(--ink-dim)', textDecoration: 'none', fontFamily: 'var(--f-mono)', fontSize: 12 }}>
            ← Spaces
          </Link>
          <span style={{ color: 'var(--ink-faint)' }}>/</span>
          <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{space.title ?? 'Untitled space'}</span>
          {space.is_creator && (
            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--teal)', border: '1px solid var(--teal-dim)', borderRadius: 3, padding: '2px 6px', letterSpacing: '0.1em' }}>
              CREATOR
            </span>
          )}
        </div>
        <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--ink-faint)', marginBottom: 14 }}>
          {fmtUsdc(space.price_usdc)} USDC / {space.cadence === 'annual' ? 'year' : 'month'} · {space.subscriber_count}{' '}
          subscriber{space.subscriber_count === 1 ? '' : 's'}
        </div>

        {space.is_member ? (
          <>
            <Thread roomId={space.id} me={user.id} initial={initial} analystId={analystId ?? undefined} />
            {analystId && <AskAnalyst roomId={space.id} />}
          </>
        ) : (
          <div style={{ border: '1px solid var(--rule)', borderRadius: 10, padding: 24, background: 'var(--bg-panel)' }}>
            {space.blurb && <p style={{ color: 'var(--ink)', fontSize: 14, lineHeight: 1.6, marginTop: 0 }}>{space.blurb}</p>}
            <p style={{ color: 'var(--ink-dim)', fontSize: 12.5, lineHeight: 1.6 }}>
              {space.creator && (
                <>
                  By{' '}
                  <Link href={`/u/${space.creator.slug}`} style={{ color: 'var(--teal)', textDecoration: 'none' }}>
                    {space.creator.name}
                  </Link>{' '}
                  —{' '}
                </>
              )}
              a subscriber-only space. Subscribe to see the conversation and the in-room analyst.
            </p>
            <button
              disabled
              style={{ fontFamily: 'var(--f-mono)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-dim)', background: 'var(--bg-raised)', border: '1px solid var(--rule)', borderRadius: 4, padding: '10px 18px', marginTop: 14, cursor: 'default', opacity: 0.7 }}
            >
              Subscribe — soon
            </button>
            <p style={{ fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 10, lineHeight: 1.5 }}>
              Subscriptions open soon — non-custodial USDC via Unlock Protocol.
            </p>
          </div>
        )}
      </section>
    </>
  );
}

function fmtUsdc(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
