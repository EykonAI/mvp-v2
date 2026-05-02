'use client';
import { RecentFiresList } from '@/components/notif/RecentFiresList';

// 30-day Recent notifications view on /settings (brief §3.8). Same
// data path as /notif?filter=recent — just a longer window.

const WINDOW_HOURS = 24 * 30;

export function RecentNotificationsCard() {
  return (
    <section
      style={{
        background: 'var(--bg-panel)',
        border: '1px solid var(--rule)',
        borderRadius: 6,
        padding: '24px 28px',
        marginBottom: 24,
      }}
    >
      <RecentFiresList hours={WINDOW_HOURS} title="Recent notifications · last 30 days" compact />
    </section>
  );
}
