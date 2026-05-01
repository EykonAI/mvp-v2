'use client';
import Link from 'next/link';
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

export default function NotificationBell() {
  const [count, setCount] = useState(0);

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

  return (
    <Link
      href="/notif?filter=recent"
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
