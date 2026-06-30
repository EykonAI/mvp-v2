'use client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CommChatShell } from '@/components/comm/CommChatShell';

// Shared chrome for the BRIEFS pillar: the global TopNav + AI Analyst panel
// (via CommChatShell, the generic content-pillar shell) plus the pillar's
// internal sub-tabs. Each page renders only its own heading + content; auth is
// enforced in the server layout. Track Record is folded into Forecasts (the
// four-item menu), so it is not a top-level tab here.

const TABS = [
  { href: '/briefs', label: 'Today' },
  { href: '/briefs/briefings', label: 'Briefings' },
  { href: '/briefs/forecasts', label: 'Forecasts' },
  { href: '/briefs/convergence', label: 'Convergence' },
];

function tabActive(href: string, pathname: string | null): boolean {
  if (!pathname) return false;
  if (href === '/briefs') return pathname === '/briefs';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BriefsChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <CommChatShell>
      <section style={{ maxWidth: 760, margin: '0 auto', padding: '34px 24px 80px', color: 'var(--ink)' }}>
        <div className="eyebrow" style={{ color: 'var(--teal)' }}>·· Briefs ··</div>
        <nav style={{ display: 'flex', gap: 6, margin: '14px 0 24px', flexWrap: 'wrap' }}>
          {TABS.map((t) => {
            const a = tabActive(t.href, pathname);
            return (
              <Link
                key={t.href}
                href={t.href}
                prefetch={false}
                style={{
                  fontFamily: 'var(--f-mono)',
                  fontSize: 10.5,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  padding: '5px 12px',
                  borderRadius: 2,
                  textDecoration: 'none',
                  color: a ? 'var(--bg-void)' : 'var(--ink-dim)',
                  background: a ? 'var(--teal)' : 'transparent',
                  border: `1px solid ${a ? 'var(--teal)' : 'var(--rule-strong)'}`,
                }}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
        {children}
      </section>
    </CommChatShell>
  );
}
