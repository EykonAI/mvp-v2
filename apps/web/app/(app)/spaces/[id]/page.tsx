import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { CommChatShell } from '@/components/comm/CommChatShell';
import { getCurrentUser } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase-server';
import { loadSpace, spacesCheckoutEnabled } from '@/lib/comm/spaces';
import { getFoundingPartner } from '@/lib/comm/foundingPartner';
import { getLinkedWallet } from '@/lib/comm/wallets';
import { loadMessages, markRead } from '@/lib/comm/dm';
import { Thread } from '@/components/comm/Thread';
import { AskAnalyst } from '@/components/comm/AskAnalyst';
import { getAnalystId } from '@/lib/comm/analyst';
import { ConnectWallet } from '@/components/comm/ConnectWallet';
import { EnableSubscriptions } from '@/components/comm/EnableSubscriptions';
import { SubscribePanel } from '@/components/comm/SubscribePanel';

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
  const checkout = spacesCheckoutEnabled();
  const linkedWallet = checkout ? await getLinkedWallet(supabase, user.id) : null;
  const platformWallet = process.env.UNLOCK_PLATFORM_WALLET ?? '';

  // Founding Partner gating (mig 076): past the Note deadline, the
  // space pauses for NEW subscribers only — members keep everything.
  const creatorPartner = space.creator ? await getFoundingPartner(supabase, space.creator.id) : null;
  const creatorGated = creatorPartner?.status === 'gated';

  return (
    <CommChatShell>
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

        {space.is_creator && checkout && (
          <div style={{ border: '1px solid var(--rule)', borderRadius: 10, padding: 16, background: 'var(--bg-panel)', marginBottom: 14 }}>
            <div className="eyebrow" style={{ color: 'var(--teal)', marginBottom: 8 }}>Monetization</div>
            {space.lock_status === 'ready' && space.lock_address ? (
              <div style={{ fontSize: 12.5, color: 'var(--ink-dim)', lineHeight: 1.6 }}>
                ✓ Subscriptions live — lock{' '}
                <a
                  href={`https://basescan.org/address/${space.lock_address}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: 'var(--teal)', textDecoration: 'none', fontFamily: 'var(--f-mono)' }}
                >
                  {space.lock_address.slice(0, 6)}…{space.lock_address.slice(-4)}
                </a>{' '}
                · {fmtUsdc(space.price_usdc)} USDC / {space.cadence === 'annual' ? 'year' : 'month'} · you keep 85% to your linked wallet.
              </div>
            ) : space.lock_status === 'working' ? (
              <div style={{ fontSize: 12.5, color: 'var(--ink-dim)', lineHeight: 1.6 }}>
                Finishing setup on Base — deploying the lock and handing control to your wallet. This takes a few seconds; refresh shortly.
              </div>
            ) : !linkedWallet ? (
              <div style={{ fontSize: 12.5, color: 'var(--ink-dim)', lineHeight: 1.6 }}>
                <p style={{ margin: '0 0 10px' }}>
                  Connect your payout wallet — it becomes the lock owner, so subscription funds go directly to it (non-custodial).
                </p>
                <ConnectWallet linked={null} />
              </div>
            ) : (
              <div style={{ fontSize: 12.5, color: 'var(--ink-dim)', lineHeight: 1.6 }}>
                <div style={{ marginBottom: 10 }}>
                  <ConnectWallet linked={linkedWallet.address} />
                </div>
                {space.lock_status === 'failed' ? (
                  <p style={{ margin: '0 0 10px' }}>
                    Setup didn&rsquo;t finish — pick up where it stopped. No funds are at risk; an existing lock resumes rather than redeploying.
                  </p>
                ) : (
                  <p style={{ margin: '0 0 10px' }}>
                    Deploy this space&rsquo;s lock on Base — {fmtUsdc(space.price_usdc)} USDC /{' '}
                    {space.cadence === 'annual' ? 'year' : 'month'}; you keep 85% to{' '}
                    {linkedWallet.address.slice(0, 6)}…{linkedWallet.address.slice(-4)}, 15% platform fee.
                  </p>
                )}
                <EnableSubscriptions spaceId={space.id} label={space.lock_status === 'failed' ? 'Finish setup' : undefined} />
              </div>
            )}
          </div>
        )}

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
            <div style={{ marginTop: 14 }}>
              {creatorGated ? (
                <p style={{ fontSize: 12.5, color: 'var(--ink-dim)', lineHeight: 1.6, border: '1px dashed var(--rule)', borderRadius: 6, padding: '12px 14px', margin: 0 }}>
                  This creator is completing their calibration — subscriptions reopen when their
                  Reputation Note is live. Existing members are unaffected.
                </p>
              ) : checkout && space.lock_address ? (
                <SubscribePanel
                  spaceId={space.id}
                  lock={space.lock_address}
                  network={8453}
                  referrer={platformWallet}
                  priceLabel={`${fmtUsdc(space.price_usdc)} USDC / ${space.cadence === 'annual' ? 'year' : 'month'}`}
                  linkedWallet={linkedWallet?.address ?? null}
                />
              ) : (
                <>
                  <button
                    disabled
                    style={{ fontFamily: 'var(--f-mono)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-dim)', background: 'var(--bg-raised)', border: '1px solid var(--rule)', borderRadius: 4, padding: '10px 18px', cursor: 'default', opacity: 0.7 }}
                  >
                    Subscribe — soon
                  </button>
                  <p style={{ fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 10, lineHeight: 1.5 }}>
                    Subscriptions open soon — non-custodial USDC via Unlock Protocol.
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </section>
    </CommChatShell>
  );
}

function fmtUsdc(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
