import Link from 'next/link';
import { Empty } from '@/components/briefs/parts';

// Delivery — editorial delivery preferences (which briefs, what cadence, which
// channel). Distinct from NOTIF's alert channels: this controls what eYKON
// publishes to you, not the rules that fire on events. MVP stub.

export const dynamic = 'force-dynamic';

export default function BriefsPreferencesPage() {
  return (
    <div>
      <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 20, margin: '0 0 4px' }}>Delivery</h1>
      <p style={{ fontSize: 12.5, color: 'var(--ink-dim)', margin: '0 0 16px', lineHeight: 1.5 }}>
        Choose which briefs you receive, how often, and on which channel. This controls editorial delivery only — the alerts you configure (rules that fire on events) live in{' '}
        <Link href="/notif" prefetch={false} style={{ color: 'var(--teal)', textDecoration: 'none' }}>
          NOTIF
        </Link>
        .
      </p>
      <Empty>Editorial delivery preferences are coming. Today, the daily brief and the weekly briefing are issued on their fixed cadence.</Empty>
    </div>
  );
}
