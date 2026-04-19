'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export const WORKSPACES: { slug: string; label: string; path: string }[] = [
  { slug: 'home',              label: 'Dashboard',          path: '/intel' },
  { slug: 'chokepoint',        label: 'Chokepoint',         path: '/intel/chokepoint' },
  { slug: 'sanctions',         label: 'Sanctions Wargame',  path: '/intel/sanctions' },
  { slug: 'cascade',           label: 'Cascade Map',        path: '/intel/cascade' },
  { slug: 'commodities',       label: 'Commodities',        path: '/intel/commodities' },
  { slug: 'shadow-fleet',      label: 'Shadow Fleet',       path: '/intel/shadow-fleet' },
  { slug: 'minerals',          label: 'Critical Minerals',  path: '/intel/minerals' },
  { slug: 'regime-shifts',     label: 'Regime Shifts',      path: '/intel/regime-shifts' },
  { slug: 'precursor-analogs', label: 'Precursor Analogs',  path: '/intel/precursor-analogs' },
  { slug: 'calibration',       label: 'Calibration',        path: '/intel/calibration' },
];

/**
 * Horizontal workspace nav. Used both as the dashboard's sticky footer
 * and in the right-rail's Workspace Feed (orientation='vertical').
 */
export default function WorkspaceNav({ orientation = 'horizontal' }: { orientation?: 'horizontal' | 'vertical' }) {
  const pathname = usePathname() ?? '/intel';

  if (orientation === 'vertical') {
    return (
      <ul className="flex flex-col" style={{ gap: 0 }}>
        {WORKSPACES.map(w => {
          const active = isActive(pathname, w.path);
          return (
            <li key={w.slug} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
              <Link
                href={w.path}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '9px 14px',
                  textDecoration: 'none',
                  fontFamily: 'var(--f-mono)',
                  fontSize: 11,
                  letterSpacing: '0.08em',
                  color: active ? 'var(--teal)' : 'var(--ink-dim)',
                  background: active ? 'rgba(25,208,184,0.04)' : 'transparent',
                }}
              >
                <span style={{ color: active ? 'var(--teal)' : 'var(--ink-faint)' }}>◆</span>
                <span>{w.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <nav
      className="sticky bottom-0 z-20 flex items-center gap-0 px-6 backdrop-blur"
      style={{
        background: 'rgba(10, 18, 32, 0.92)',
        borderTop: '1px solid var(--rule-soft)',
        height: 40,
      }}
    >
      {WORKSPACES.filter(w => w.slug !== 'home').map(w => {
        const active = isActive(pathname, w.path);
        return (
          <Link
            key={w.slug}
            href={w.path}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 14px',
              height: 40,
              textDecoration: 'none',
              fontFamily: 'var(--f-mono)',
              fontSize: 10.5,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: active ? 'var(--teal)' : 'var(--ink-dim)',
              borderBottom: active ? '2px solid var(--teal)' : '2px solid transparent',
            }}
          >
            {w.label}
          </Link>
        );
      })}
    </nav>
  );
}

function isActive(pathname: string, path: string): boolean {
  if (path === '/intel') return pathname === '/intel';
  return pathname === path || pathname.startsWith(`${path}/`);
}
