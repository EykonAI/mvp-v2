import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CommChatShell } from '@/components/comm/CommChatShell';
import { getCurrentUser } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase-server';
import {
  getCreatorProGrant,
  grantIsActive,
  freeSlotsRemaining,
  isEligibleCreator,
  CREATOR_PRO_FREE_CAP,
  CREATOR_PRO_MONTHLY_USD,
} from '@/lib/comm/creatorPro';
import { ClaimButton } from './ClaimButton';

export const metadata: Metadata = {
  title: 'Creator Pro — eYKON.ai',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

// Creator Pro (monetisation review §4.3). The principle, stated where
// creators read it: the Reputation Note is public and free for
// everyone, always — Creator Pro sells distribution of it.
export default async function CreatorProPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/signin?next=/creator-pro');

  const admin = createServerSupabase();
  const [grant, slotsLeft, eligible, profile] = await Promise.all([
    getCreatorProGrant(admin, user.id),
    freeSlotsRemaining(admin),
    isEligibleCreator(admin, user.id),
    admin.from('user_profiles').select('handle, public_id').eq('id', user.id).maybeSingle(),
  ]);
  const active = grantIsActive(grant);
  const slug = profile.data?.handle ?? profile.data?.public_id ?? '';

  return (
    <CommChatShell>
      <section style={{ maxWidth: 680, margin: '0 auto', padding: '40px 24px 80px', color: 'var(--ink)' }}>
        <div className="eyebrow" style={{ color: 'var(--teal)' }}>·· Creator Pro ··</div>
        <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 28, marginTop: 8, marginBottom: 6 }}>
          Grow your Space. Own your track record.
        </h1>
        <p style={{ fontSize: 13.5, color: 'var(--ink-dim)', lineHeight: 1.6, maxWidth: 560 }}>
          Your Reputation Note is public and free — for you and everyone else, always. Creator Pro
          is the distribution layer on top of it: analytics on your Space and conversion earnings,
          an embeddable reputation card for your site and socials, Space branding, and priority in
          Discover.
        </p>

        <div style={{ margin: '20px 0', padding: '14px 16px', border: '1px solid var(--rule)', borderRadius: 8, background: 'var(--bg-panel)' }}>
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--teal)' }}>
            Founding window
          </div>
          <div style={{ fontSize: 14, marginTop: 6 }}>
            <strong>{slotsLeft}</strong> of {CREATOR_PRO_FREE_CAP} founding slots left —{' '}
            <strong>free for life</strong>. Afterwards ${CREATOR_PRO_MONTHLY_USD}/month.
          </div>
        </div>

        {active ? (
          <div style={{ padding: '14px 16px', border: '1px solid var(--teal-dim)', borderRadius: 8, background: 'var(--bg-panel)' }}>
            <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--teal)', marginBottom: 6 }}>
              You are Creator Pro{grant?.lifetime_free ? ' · founding · free for life' : ''}
            </div>
            <ul style={{ fontSize: 13, color: 'var(--ink-dim)', lineHeight: 1.9, margin: 0, paddingLeft: 18 }}>
              <li>
                <Link href="/creator/dashboard" style={{ color: 'var(--teal)', textDecoration: 'none' }}>
                  Creator dashboard →
                </Link>{' '}
                subscribers, churn, conversion earnings, card traffic
              </li>
              <li>
                Embeddable reputation card:{' '}
                <code style={{ fontFamily: 'var(--f-mono)', fontSize: 11.5 }}>
                  {`<iframe src="https://eykon.ai/embed/reputation/${slug || '<your-handle>'}" width="420" height="180" frameborder="0"></iframe>`}
                </code>
              </li>
              <li>Space branding (accent colour + banner) — set it on your Space’s Manage tab</li>
              <li>Priority placement in Discover</li>
            </ul>
          </div>
        ) : eligible ? (
          slotsLeft > 0 ? (
            <ClaimButton />
          ) : (
            <div style={{ padding: '14px 16px', border: '1px dashed var(--rule)', borderRadius: 8, color: 'var(--ink-dim)', fontSize: 13, lineHeight: 1.6 }}>
              The 50 founding slots are taken. The ${CREATOR_PRO_MONTHLY_USD}/month plan opens for
              new creators shortly — you’ll see it here first.
            </div>
          )
        ) : (
          <div style={{ padding: '14px 16px', border: '1px dashed var(--rule)', borderRadius: 8, color: 'var(--ink-dim)', fontSize: 13, lineHeight: 1.6 }}>
            Creator Pro is for Space creators.{' '}
            <Link href="/spaces?tab=manage" style={{ color: 'var(--teal)', textDecoration: 'none' }}>
              Open a Space
            </Link>{' '}
            first — then come back and claim a founding slot.
          </div>
        )}
      </section>
    </CommChatShell>
  );
}
