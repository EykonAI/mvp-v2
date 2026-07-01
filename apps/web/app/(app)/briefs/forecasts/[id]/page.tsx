import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { CSSProperties } from 'react';
import { loadForecast } from '@/lib/briefs/forecasts';

// Per-forecast drill-down: the full sealed call, the forecast vs. observed
// outcome + Brier/log-loss, the issue/resolution metadata, the SHA-256 seal,
// and the external resolution source once it has resolved.

export const dynamic = 'force-dynamic';

const FEATURE_LABEL: Record<string, string> = {
  ais_chokepoint_weekly: 'Chokepoint transit',
  eia_weekly_inventory: 'EIA inventory',
};

const backLink: CSSProperties = { fontFamily: 'var(--f-mono)', fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-dim)', textDecoration: 'none' };
const statCard: CSSProperties = { flex: '1 1 90px', minWidth: 90, padding: '10px 12px', background: 'var(--bg-panel)', border: '1px solid var(--rule-soft)', borderRadius: 3 };
const statValue: CSSProperties = { fontFamily: 'var(--f-mono)', fontSize: 18, color: 'var(--ink)' };
const statLabel: CSSProperties = { fontFamily: 'var(--f-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-faint)', marginTop: 3 };

function fmtDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '—';
}

export default async function ForecastDetailPage({ params }: { params: { id: string } }) {
  const f = await loadForecast(params.id);
  if (!f) notFound();

  const accent = f.resolved ? 'var(--teal)' : 'var(--amber)';
  const stats: Array<{ label: string; value: string }> = [
    { label: 'Forecast', value: f.predictedMean != null ? f.predictedMean.toFixed(2) : '—' },
    { label: 'Baseline', value: f.baselineMean != null ? f.baselineMean.toFixed(2) : '—' },
  ];
  if (f.resolved) {
    stats.push({ label: 'Observed', value: f.observedValue != null ? String(f.observedValue) : '—' });
    stats.push({ label: 'Brier', value: f.brier != null ? f.brier.toFixed(3) : '—' });
    if (f.logLoss != null) stats.push({ label: 'Log-loss', value: f.logLoss.toFixed(3) });
  }

  return (
    <div>
      <Link href="/briefs/forecasts" prefetch={false} style={backLink}>
        ← Forecasts
      </Link>

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, margin: '16px 0 6px' }}>
        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-faint)' }}>
          {FEATURE_LABEL[f.feature] ?? f.feature}
        </span>
        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: accent }}>
          {f.resolved ? 'Resolved' : 'Open'}
        </span>
      </div>

      <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 20, lineHeight: 1.35, margin: '0 0 18px', color: 'var(--ink)' }}>
        {f.statement}
      </h1>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 22 }}>
        {stats.map((s) => (
          <div key={s.label} style={statCard}>
            <div style={statValue}>{s.value}</div>
            <div style={statLabel}>{s.label}</div>
          </div>
        ))}
      </div>

      <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 14, margin: 0 }}>
        <Meta k="Issued" v={fmtDate(f.issuedAt)} />
        <Meta k="Resolves" v={fmtDate(f.resolvesAt)} />
        <Meta k="Window" v={f.targetWindowHours != null ? `${f.targetWindowHours}h` : '—'} />
        <Meta k="Persona" v={f.persona ?? '—'} />
      </dl>

      {f.hash && (
        <p style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--ink-faint)', letterSpacing: '0.02em', marginTop: 20 }}>
          Sealed at issue · SHA-256 {f.hash.slice(0, 16)}…
        </p>
      )}

      {f.resolved && f.resolutionSourceUrl && (
        <a
          href={f.resolutionSourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ ...backLink, display: 'inline-block', marginTop: 12, color: 'var(--teal)' }}
        >
          Resolution source →
        </a>
      )}
    </div>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt style={statLabel}>{k}</dt>
      <dd style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--ink)', margin: 0 }}>{v}</dd>
    </div>
  );
}
