'use client';
import { useState } from 'react';
import { ForecastList, Empty } from '@/components/briefs/parts';
import type { ForecastRow } from '@/lib/briefs/forecasts';

// Open / Resolved tabs for the Forecasts surface. "Resolved" is the folded-in
// Track Record — the four-item BRIEFS menu keeps Track Record as a tab here
// rather than a separate destination.

export function ForecastsBoard({ open, resolved }: { open: ForecastRow[]; resolved: ForecastRow[] }) {
  const [tab, setTab] = useState<'open' | 'resolved'>(open.length ? 'open' : 'resolved');
  const rows = tab === 'open' ? open : resolved;
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        <TabBtn label={`Open (${open.length})`} active={tab === 'open'} onClick={() => setTab('open')} />
        <TabBtn label={`Resolved (${resolved.length})`} active={tab === 'resolved'} onClick={() => setTab('resolved')} />
      </div>
      {rows.length ? (
        <ForecastList rows={rows} />
      ) : (
        <Empty>
          {tab === 'open'
            ? 'No open forecasts right now — the next weekly calls are issued on schedule.'
            : 'No resolved forecasts yet — calls appear here with their Brier score once they reach their window and resolve.'}
        </Empty>
      )}
    </div>
  );
}

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: 'var(--f-mono)',
        fontSize: 10,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        padding: '5px 11px',
        borderRadius: 2,
        cursor: 'pointer',
        color: active ? 'var(--bg-void)' : 'var(--ink-dim)',
        background: active ? 'var(--teal)' : 'transparent',
        border: `1px solid ${active ? 'var(--teal)' : 'var(--rule-strong)'}`,
      }}
    >
      {label}
    </button>
  );
}
