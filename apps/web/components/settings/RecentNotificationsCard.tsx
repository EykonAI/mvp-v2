'use client';
import { RecentFiresList } from '@/components/notif/RecentFiresList';

// 30-day Recent notifications view on /settings (brief §3.8). Same
// data path as /notif?filter=recent — just a longer window.

const WINDOW_HOURS = 24 * 30;

export function RecentNotificationsCard() {
  return (
    <section className="mb-6 rounded-md border border-eykon-rule bg-eykon-bg-panel px-7 py-6">
      <RecentFiresList hours={WINDOW_HOURS} title="Recent notifications · last 30 days" compact />
    </section>
  );
}
