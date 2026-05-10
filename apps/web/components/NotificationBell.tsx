'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

// Bell glyph in the top-nav. Polls /api/notifications/unread-count
// every 30 s for the authenticated user's last-24-h fire count.
// Click → /notif?filter=recent (the recent-fires deep link).
//
// Badge thresholds match brief §3.1:
//   • count = 0  → no badge
//   • count ≥ 1  → teal badge
//   • count ≥ 10 → amber badge (configurable threshold)
//
// PR 2 ships against the stub endpoint (always returns 0). PR 6
// swaps the endpoint body for the real query — no client changes
// required.

const POLL_INTERVAL_MS = 30_000;
const AMBER_THRESHOLD = 10;

// Brief outline pulse on the recent-fires section so a bell click
// produces visible feedback even when the section is already in the
// viewport (where scrollIntoView is a silent no-op).
function pulseSection(el: HTMLElement) {
  const prevTransition = el.style.transition;
  const prevOutline = el.style.outline;
  const prevOutlineOffset = el.style.outlineOffset;
  const prevBorderRadius = el.style.borderRadius;
  el.style.transition = 'outline-color 320ms ease-out';
  el.style.outline = '2px solid var(--teal)';
  el.style.outlineOffset = '6px';
  el.style.borderRadius = '4px';
  window.setTimeout(() => {
    el.style.outline = '2px solid transparent';
    window.setTimeout(() => {
      el.style.transition = prevTransition;
      el.style.outline = prevOutline;
      el.style.outlineOffset = prevOutlineOffset;
      el.style.borderRadius = prevBorderRadius;
    }, 360);
  }, 700);
}

export default function NotificationBell() {
  const [count, setCount] = useState(0);
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const fetchCount = async () => {
      try {
        const r = await fetch('/api/notifications/unread-count', { cache: 'no-store' });
        if (!r.ok) return;
        const data = await r.json();
        if (cancelled) return;
        if (typeof data?.count === 'number') setCount(data.count);
      } catch {
        // Network blip — keep the last value, retry on next tick.
      }
    };

    fetchCount();
    timer = setInterval(fetchCount, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  const badgeColor =
    count >= AMBER_THRESHOLD ? 'var(--amber)' : count > 0 ? 'var(--teal)' : null;

  // When already on /notif, clicking the bell would be a no-op
  // Link to the same route. Intercept the click and either scroll
  // the recent-fires section into view (if rendered) or do a soft
  // route replace to add ?filter=recent so the section appears.
  //
  // Always pulse the section's outline regardless of scroll state so
  // the user gets unambiguous visual feedback — scrollIntoView alone
  // is a silent no-op when the target is already in viewport.
  const onClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (pathname !== '/notif') return; // let Link handle the nav
    const el = document.getElementById('recent-fires');
    if (el) {
      e.preventDefault();
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      pulseSection(el);
      return;
    }
    // Section not rendered (user is on /notif without ?filter=recent).
    // Let Link handle the nav — the section will mount and the browser
    // will scroll to the #recent-fires anchor.
  };

  return (
    <Link
      href="/notif?filter=recent#recent-fires"
      onClick={onClick}
      aria-label={
        count > 0 ? `${count} notifications in the last 24 hours` : 'Notifications'
      }
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        color: 'var(--ink-dim)',
        textDecoration: 'none',
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 2a6 6 0 0 0-6 6v3.586l-1.707 1.707A1 1 0 0 0 5 15h14a1 1 0 0 0 .707-1.707L18 11.586V8a6 6 0 0 0-6-6z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M10 19a2 2 0 0 0 4 0"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
      {badgeColor && (
        <span
          style={{
            position: 'absolute',
            top: 2,
            right: 2,
            minWidth: 14,
            height: 14,
            padding: '0 3px',
            borderRadius: 7,
            background: badgeColor,
            color: 'var(--bg-void)',
            fontFamily: 'var(--f-mono)',
            fontSize: 9,
            fontWeight: 600,
            lineHeight: '14px',
            textAlign: 'center',
          }}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}
