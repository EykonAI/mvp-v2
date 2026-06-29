'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { CSSProperties, ReactNode } from 'react';
import { TAB_BASE_STYLE, activeStyle } from '@/components/navTabStyles';

// COMM pillar dropdown. Per the 2026-06-28 COMM UX/UI Uplift brief (§2):
//   • the trigger renders as a peer pillar tab (shared TAB_BASE_STYLE) inside
//     the right-hand cluster, active when on any COMM route;
//   • the six flat links are grouped into three labelled buckets a member
//     already has in mind — You · Community · Messages.
// "Profile" → /me, which redirects to the signed-in user's own public
// profile (/u/<handle>). Messages carries a live unread badge.
//
// Outside-click close uses a document-level listener rather than a
// fixed-position backdrop: the nav has backdrop-blur (a backdrop-filter),
// which would confine any position:fixed child to the nav's own box and
// stop it catching clicks elsewhere on the page.

const I = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const RadarIcon = (
  <svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.4" {...I} /><circle cx="7" cy="7" r="2.4" {...I} /><line x1="7" y1="7" x2="11.3" y2="3.4" {...I} /></svg>
);
const ProfileIcon = (
  <svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="4.6" r="2.4" {...I} /><path d="M2.6 11.8a4.4 4.4 0 0 1 8.8 0" {...I} /></svg>
);
const TrophyIcon = (
  <svg width="14" height="14" viewBox="0 0 14 14"><line x1="3" y1="11.5" x2="3" y2="8" {...I} /><line x1="7" y1="11.5" x2="7" y2="3.2" {...I} /><line x1="11" y1="11.5" x2="11" y2="5.6" {...I} /></svg>
);
const RoomsIcon = (
  <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2.6 3.2h8.8a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H6.2l-2.6 2v-2H2.6a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z" {...I} /></svg>
);
const SpacesIcon = (
  <svg width="14" height="14" viewBox="0 0 14 14"><rect x="3" y="6.4" width="8" height="5.1" rx="1" {...I} /><path d="M4.8 6.4V5a2.2 2.2 0 0 1 4.4 0v1.4" {...I} /></svg>
);
const MailIcon = (
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
    heading: 'You',
    items: [
      { href: '/radar', label: 'Radar', desc: 'Your feed — followed analysts', icon: RadarIcon },
      { href: '/me', label: 'Profile', desc: 'Your public page & Reputation Note', icon: ProfileIcon },
    ],
  },
  {
    heading: 'Community',
    items: [
      { href: '/leaderboard', label: 'Leaderboard', desc: 'Ranked by calibrated accuracy', icon: TrophyIcon },
      { href: '/rooms', label: 'Rooms', desc: 'Topic & event discussion', icon: RoomsIcon },
      { href: '/spaces', label: 'Spaces', desc: 'Paid creator communities', icon: SpacesIcon },
    ],
  },
  {
    heading: 'Messages',
    items: [
      { href: '/messages', label: 'Direct messages', desc: 'Private 1:1 conversations', icon: MailIcon },
    ],
  },
];

// Route prefixes that light the trigger's active (pillar-selected) state.
const COMM_ROUTES = ['/radar', '/me', '/u/', '/leaderboard', '/rooms', '/spaces', '/messages'];

// Is a menu item's route the current one? '/me' must match EXACTLY — it is a
// string prefix of '/messages', so a naive startsWith would also light Profile
// while on /messages. Every other item is a prefix match (covers nested routes
// like /spaces/<id>). '/me' redirects to /u/<handle>, so Profile simply won't
// light while viewing a /u/ profile — acceptable; we don't resolve the handle.
function isItemActive(itemHref: string, pathname: string | null): boolean {
  if (!pathname) return false;
  if (itemHref === '/me') return pathname === '/me';
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
  color: 'var(--ink-dim)',
  opacity: 0.65,
  padding: '8px 10px 4px',
};
const badge: CSSProperties = {
  marginLeft: 'auto',
  fontFamily: 'var(--f-mono)',
  fontSize: 9.5,
  fontWeight: 600,
  lineHeight: 1,
  color: 'var(--bg-void)',
  background: 'var(--teal)',
  borderRadius: 9,
  padding: '3px 6px',
  minWidth: 16,
  textAlign: 'center',
};

export default function CommMenu() {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const active = COMM_ROUTES.some((r) => pathname?.startsWith(r));

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

  // Live unread-DM count (read-only; reuses listThreads server-side). Silent
  // on any failure — the badge simply stays hidden, never a fabricated number.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/comm/dm/unread')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d && typeof d.count === 'number') setUnread(d.count);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        style={{
          ...TAB_BASE_STYLE,
          ...activeStyle(active),
          // Keep the caret inline with the label (never wrapping under it) so
          // COMM stays a single-line tab, homogeneous with the other pillars.
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        COMM
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
                const showBadge = it.href === '/messages' && unread > 0;
                // Active takes precedence over hover: the current route reads in
                // the teal accent (tinted row + left accent bar + teal label),
                // visually distinct from the neutral white-wash hover.
                // Tint matches --teal (#19D0B8 → rgb 25,208,184) at low alpha.
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
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: 6,
                          bottom: 6,
                          width: 2.5,
                          borderRadius: 2,
                          background: 'var(--teal)',
                        }}
                      />
                    )}
                    <span
                      style={{
                        display: 'flex',
                        color: isActive || isHovered ? 'var(--teal)' : 'var(--ink-dim)',
                        flexShrink: 0,
                      }}
                    >
                      {it.icon}
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                      <span
                        style={{
                          fontFamily: 'var(--f-mono)',
                          fontSize: 11.5,
                          letterSpacing: '0.04em',
                          color: isActive ? 'var(--teal)' : 'var(--ink)',
                        }}
                      >
                        {it.label}
                      </span>
                      <span
                        style={{
                          fontFamily: 'var(--f-mono)',
                          fontSize: 9.5,
                          letterSpacing: '0.02em',
                          color: 'var(--ink-dim)',
                        }}
                      >
                        {it.desc}
                      </span>
                    </span>
                    {showBadge && (
                      <span style={badge} aria-label={`${unread} unread`}>
                        {unread > 99 ? '99+' : unread}
                      </span>
                    )}
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
