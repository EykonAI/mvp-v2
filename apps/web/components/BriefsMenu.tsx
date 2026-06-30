'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { CSSProperties, ReactNode } from 'react';
import { TAB_BASE_STYLE, activeStyle } from '@/components/navTabStyles';

// BRIEFS pillar dropdown — the reading room for everything eYKON issues to a
// user: the daily/weekly briefs, the calibrated forecasts and how they score,
// and the convergence wire. Built as a peer pillar tab beside COMM ▾, mirroring
// CommMenu (outside-click close, shared TAB_BASE_STYLE, grouped items). NOTIF
// stays alerts-only; the editorial surfaces read here. Four primary
// destinations + a Delivery (editorial-preferences) item, distinct from NOTIF's
// alert channels.

const I = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const TodayIcon = (
  <svg width="14" height="14" viewBox="0 0 14 14"><rect x="2.2" y="3" width="9.6" height="8.4" rx="1" {...I} /><line x1="2.2" y1="5.4" x2="11.8" y2="5.4" {...I} /><line x1="4.6" y1="1.8" x2="4.6" y2="3.4" {...I} /><line x1="9.4" y1="1.8" x2="9.4" y2="3.4" {...I} /></svg>
);
const BriefingsIcon = (
  <svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 2.4h5l3 3v6.2H3z" {...I} /><line x1="4.6" y1="7" x2="9.4" y2="7" {...I} /><line x1="4.6" y1="9.2" x2="8" y2="9.2" {...I} /></svg>
);
const ForecastIcon = (
  <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2.2 9.8l3-3 2.2 2.2 4.4-4.4" {...I} /><path d="M9.4 4.4h2.4v2.4" {...I} /></svg>
);
const ConvergenceIcon = (
  <svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="1.6" {...I} /><path d="M7 1.8v3M7 9.2v3M1.8 7h3M9.2 7h3" {...I} /></svg>
);
const DeliveryIcon = (
  <svg width="14" height="14" viewBox="0 0 14 14"><rect x="2" y="3.4" width="10" height="7.2" rx="1.2" {...I} /><path d="M2.4 4.2L7 8l4.6-3.8" {...I} /></svg>
);

interface NavItem {
  href: string;
  label: string;
  desc: string;
  icon: ReactNode;
}
interface NavGroup {
  heading: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    heading: 'Read',
    items: [
      { href: '/briefs', label: 'Today', desc: 'What eYKON issued for you', icon: TodayIcon },
      { href: '/briefs/briefings', label: 'Briefings', desc: 'Daily · weekly · digest', icon: BriefingsIcon },
    ],
  },
  {
    heading: 'Signals & scores',
    items: [
      { href: '/briefs/forecasts', label: 'Forecasts', desc: 'Sealed calls + how they score', icon: ForecastIcon },
      { href: '/briefs/convergence', label: 'Convergence', desc: 'Live multi-domain wire', icon: ConvergenceIcon },
    ],
  },
  {
    heading: 'Settings',
    items: [
      { href: '/briefs/preferences', label: 'Delivery', desc: 'Which briefs · cadence · channel', icon: DeliveryIcon },
    ],
  },
];

// Route prefixes that light the trigger's active (pillar-selected) state.
const BRIEFS_ROUTES = ['/briefs'];

// '/briefs' (Today) must match EXACTLY — it is a prefix of every sub-route, so
// a naive startsWith would light Today on /briefs/forecasts too. Every other
// item is a prefix match (covers any nested routes).
function isItemActive(itemHref: string, pathname: string | null): boolean {
  if (!pathname) return false;
  if (itemHref === '/briefs') return pathname === '/briefs';
  return pathname === itemHref || pathname.startsWith(`${itemHref}/`);
}

const menu: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 8px)',
  left: 0,
  zIndex: 50,
  minWidth: 272,
  background: 'var(--bg-panel)',
  border: '1px solid var(--rule)',
  borderRadius: 6,
  padding: 6,
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
};
const groupHeading: CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 9.5,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: 'var(--teal)',
  padding: '8px 10px 4px',
};

export default function BriefsMenu() {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const active = BRIEFS_ROUTES.some((r) => pathname?.startsWith(r));

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        style={{
          ...TAB_BASE_STYLE,
          ...activeStyle(active),
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        BRIEFS
        <span aria-hidden style={{ fontSize: 9, lineHeight: 1, opacity: 0.9 }}>
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
        <div role="menu" style={menu}>
          {GROUPS.map((group) => (
            <div key={group.heading}>
              <div style={groupHeading}>{group.heading}</div>
              {group.items.map((it) => {
                const isActive = isItemActive(it.href, pathname);
                const isHovered = hovered === it.href;
                const rowBg = isActive
                  ? 'rgba(25,208,184,0.10)'
                  : isHovered
                    ? 'rgba(255,255,255,0.05)'
                    : 'transparent';
                return (
                  <Link
                    key={it.href}
                    href={it.href}
                    prefetch={false}
                    role="menuitem"
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => setOpen(false)}
                    onMouseEnter={() => setHovered(it.href)}
                    onMouseLeave={() => setHovered((h) => (h === it.href ? null : h))}
                    style={{
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 11,
                      padding: '7px 10px',
                      borderRadius: 4,
                      textDecoration: 'none',
                      background: rowBg,
                    }}
                  >
                    {isActive && (
                      <span
                        aria-hidden
                        style={{ position: 'absolute', left: 0, top: 6, bottom: 6, width: 2.5, borderRadius: 2, background: 'var(--teal)' }}
                      />
                    )}
                    <span style={{ display: 'flex', color: isActive || isHovered ? 'var(--teal)' : 'var(--ink-dim)', flexShrink: 0 }}>
                      {it.icon}
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                      <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11.5, letterSpacing: '0.04em', color: isActive ? 'var(--teal)' : 'var(--ink)' }}>
                        {it.label}
                      </span>
                      <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9.5, letterSpacing: '0.02em', color: 'var(--ink-dim)' }}>
                        {it.desc}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
