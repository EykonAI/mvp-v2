import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ForecastRow } from '@/lib/briefs/forecasts';
import type { DailyBriefRow } from '@/lib/briefs/dailyBrief';

// Presentational BRIEFS building blocks (no client state — usable from server
// and client components alike). The interactive Open/Resolved tabs live in
// ForecastsBoard; this file is pure rendering.

export function SectionHeading({ title, href, cta }: { title: string; href?: string; cta?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
      <h2 style={{ fontFamily: 'var(--f-display)', fontSize: 16, fontWeight: 500, color: 'var(--ink)', margin: 0 }}>{title}</h2>
      {href && cta && (
        <Link
          href={href}
          prefetch={false}
          style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--teal)', textDecoration: 'none', whiteSpace: 'nowrap' }}
        >
          {cta} →
        </Link>
      )}
    </div>
  );
}

export function DailyBriefCard({ brief }: { brief: DailyBriefRow }) {
  return (
    <article
      style={{
        padding: '16px 18px',
        background: 'var(--bg-panel)',
        border: '1px solid var(--rule-soft)',
        borderLeft: '2px solid var(--teal)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 10,
          marginBottom: 10,
          fontFamily: 'var(--f-mono)',
          fontSize: 9,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
        }}
      >
        <span style={{ color: 'var(--ink-faint)' }}>
          Issued {brief.briefDate} · {brief.generatedAt.slice(11, 16)} UTC
        </span>
        <span style={{ color: brief.isToday ? 'var(--teal)' : 'var(--amber)', whiteSpace: 'nowrap' }}>
          {brief.isToday ? (brief.isQuiet ? 'Quiet period' : 'Current') : 'Latest available'}
        </span>
      </div>
      <div
        className="chat-content"
        style={{
          fontFamily: 'var(--f-body)',
          fontSize: 13,
          lineHeight: 1.6,
          color: 'var(--ink)',
          whiteSpace: 'pre-wrap',
        }}
      >
        {brief.content}
      </div>
    </article>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: 22, textAlign: 'center', border: '1px dashed var(--rule)', borderRadius: 8, color: 'var(--ink-faint)', fontSize: 12.5, lineHeight: 1.6 }}>
      {children}
    </div>
  );
}

const FEATURE_LABEL: Record<string, string> = {
  ais_chokepoint_weekly: 'Chokepoint transit',
  eia_weekly_inventory: 'EIA inventory',
};

export function ForecastList({ rows }: { rows: ForecastRow[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((r) => (
        <Link
          key={r.id}
          href={`/briefs/forecasts/${r.id}`}
          prefetch={false}
          style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
        >
        <article
          style={{
            padding: '11px 13px',
            background: 'var(--bg-panel)',
            border: '1px solid var(--rule-soft)',
            borderLeft: `2px solid ${r.resolved ? 'var(--teal)' : 'var(--amber)'}`,
            borderRadius: 2,
            cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-faint)' }}>
              {FEATURE_LABEL[r.feature] ?? r.feature}
            </span>
            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: r.resolved ? 'var(--teal)' : 'var(--amber)' }}>
              {r.resolved ? 'Resolved' : 'Open'}
            </span>
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.5, margin: '0 0 6px' }}>{r.statement}</p>
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--ink-dim)', letterSpacing: '0.02em' }}>
            {r.predictedMean != null && <span>Forecast {r.predictedMean.toFixed(2)}</span>}
            {r.resolved && r.observedValue != null && <span> · Observed {r.observedValue}</span>}
            {r.resolved && r.brier != null && <span> · Brier {r.brier.toFixed(3)}</span>}
            {!r.resolved && r.resolvesAt && <span> · Resolves {r.resolvesAt.slice(0, 10)}</span>}
          </div>
        </article>
        </Link>
      ))}
    </div>
  );
}
