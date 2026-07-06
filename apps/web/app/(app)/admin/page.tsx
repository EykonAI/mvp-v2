import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import TopNav from '@/components/TopNav';
import { getCurrentUser } from '@/lib/auth/session';
import { isFounder } from '@/lib/admin/access';

// /admin — founder-only operator console. A single hub linking every admin
// surface so the operator no longer has to remember individual /admin/* URLs.
//
// TO ADD A FUTURE ADMIN PAGE: add one entry to ADMIN_SECTIONS below. Note the
// linked page still needs its OWN founder gate (mirror any existing
// app/(app)/admin/*/page.tsx) — this index only routes to it, it does not
// gate it.

export const metadata: Metadata = {
  title: 'Admin console — eYKON.ai',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

type AdminLink = { href: string; title: string; glyph: string; desc: string };
type AdminGroup = { group: string; links: AdminLink[] };

const ADMIN_SECTIONS: AdminGroup[] = [
  {
    group: 'Growth & revenue',
    links: [
      {
        href: '/admin/waitlist',
        title: 'Waitlist',
        glyph: '📋',
        desc: 'Fiat billing waitlist — contacts, country, spots-left, bulk email.',
      },
      {
        href: '/admin/refunds',
        title: 'Refunds',
        glyph: '🧾',
        desc: 'Crypto (USDC) refund reconciliation — pending → sent → closed.',
      },
      {
        href: '/admin/bounties',
        title: 'Creator bounties',
        glyph: '💸',
        desc: 'Conversion-bounty ledger — pending → approved → paid (monthly USDC).',
      },
    ],
  },
  {
    group: 'Community & moderation',
    links: [
      {
        href: '/admin/partners',
        title: 'Founding Partners',
        glyph: '🤝',
        desc: 'Grant & manage the 20 founder-vetted partners (bundles Creator Pro).',
      },
      {
        href: '/admin/advocates',
        title: 'Advocates',
        glyph: '📣',
        desc: 'Advocate programme — invitations, submissions, and overrides.',
      },
      {
        href: '/admin/comm-reports',
        title: 'COMM reports',
        glyph: '🚩',
        desc: 'Community moderation — reported content and member reports.',
      },
      {
        href: '/admin/predictions',
        title: 'Predictions',
        glyph: '🎯',
        desc: 'Prediction oversight and manual resolution.',
      },
    ],
  },
  {
    group: 'Marketing',
    links: [
      {
        href: '/admin/newsjack',
        title: 'Newsjack review',
        glyph: '📰',
        desc: 'One-tap approval queue for baseline + spike X posts.',
      },
    ],
  },
];

export default async function AdminConsolePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/signin?next=/admin');
  if (!isFounder(user)) redirect('/app');

  return (
    <>
      <TopNav />
      <style>{`.admin-tile{transition:border-color 120ms ease, background 120ms ease}
.admin-tile:hover{border-color:var(--teal) !important;background:var(--bg-void)}`}</style>
      <section
        style={{ maxWidth: 1000, margin: '0 auto', padding: '56px 32px 120px', color: 'var(--ink)' }}
      >
        <div style={{ marginBottom: 36 }}>
          <div
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 11,
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              color: 'var(--teal)',
              marginBottom: 6,
            }}
          >
            ·· Admin console ··
          </div>
          <h1
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: 32,
              fontWeight: 600,
              letterSpacing: '-0.5px',
              margin: 0,
            }}
          >
            Operator console
          </h1>
          <p style={{ color: 'var(--ink-dim)', fontSize: 13.5, marginTop: 8, maxWidth: 640 }}>
            Every founder-only surface in one place. Access is gated to{' '}
            <code style={{ fontFamily: 'var(--f-mono)', color: 'var(--ink)' }}>FOUNDER_EMAILS</code>{' '}
            here and on each linked page.
          </p>
        </div>

        {ADMIN_SECTIONS.map(section => (
          <div key={section.group} style={{ marginBottom: 30 }}>
            <h2
              style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 10.5,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: 'var(--ink-faint)',
                margin: '0 0 12px',
              }}
            >
              {section.group}
            </h2>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 12,
              }}
            >
              {section.links.map(link => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="admin-tile"
                  style={{
                    textDecoration: 'none',
                    display: 'block',
                    background: 'var(--bg-panel)',
                    border: '1px solid var(--rule-soft)',
                    borderRadius: 8,
                    padding: '16px 18px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <span style={{ fontSize: 17, lineHeight: 1 }}>{link.glyph}</span>
                    <span
                      style={{
                        fontFamily: 'var(--f-display)',
                        fontSize: 16,
                        fontWeight: 600,
                        color: 'var(--ink)',
                      }}
                    >
                      {link.title}
                    </span>
                  </div>
                  <p
                    style={{
                      fontSize: 12.5,
                      lineHeight: 1.5,
                      color: 'var(--ink-dim)',
                      margin: '0 0 10px',
                    }}
                  >
                    {link.desc}
                  </p>
                  <div
                    style={{
                      fontFamily: 'var(--f-mono)',
                      fontSize: 10,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      color: 'var(--teal)',
                    }}
                  >
                    Open →
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
