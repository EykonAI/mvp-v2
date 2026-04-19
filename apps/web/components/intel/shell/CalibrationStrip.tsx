'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';

type Trend = 'up' | 'down' | 'flat';
interface Metric {
  key: string;
  label: string;
  value: string;
  trend: Trend;
  spark: number[];
}

interface Summary {
  metrics: Metric[];
  generated_at: string;
  degraded: boolean;
}

/**
 * Global epistemic-anchor strip. Mounts under the top bar on every
 * /intel/** route and surfaces five calibration metrics plus a link
 * to the full Calibration Ledger. Feature 22.
 */
export default function CalibrationStrip() {
  const [data, setData] = useState<Summary | null>(null);

  useEffect(() => {
    fetch('/api/intel/calibration/summary')
      .then(r => (r.ok ? r.json() : null))
      .then(j => j && setData(j))
      .catch(() => undefined);
  }, []);

  const metrics: Metric[] = data?.metrics ?? FALLBACK;

  return (
    <div
      className="grid items-center gap-7 px-6"
      style={{
        gridTemplateColumns: 'auto 1fr auto',
        padding: '10px 24px',
        borderBottom: '1px solid var(--rule-soft)',
        background: 'linear-gradient(180deg, rgba(25, 208, 184, 0.03), transparent)',
      }}
    >
      <div className="flex items-center gap-2.5">
        <span
          style={{
            display: 'inline-block',
            width: 7,
            height: 7,
            background: 'var(--teal)',
            boxShadow: '0 0 6px var(--teal)',
          }}
        />
        <span className="eyebrow" style={{ color: 'var(--ink)' }}>
          Calibration Ledger
        </span>
      </div>

      <div
        className="grid gap-7"
        style={{
          gridTemplateColumns: 'repeat(5, 1fr)',
          fontFamily: 'var(--f-mono)',
          fontSize: 11,
        }}
      >
        {metrics.map(m => (
          <MetricCell key={m.key} m={m} />
        ))}
      </div>

      <Link
        href="/intel/calibration"
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          color: 'var(--teal)',
          textDecoration: 'none',
          borderBottom: '1px dashed var(--teal-dim)',
          paddingBottom: 1,
        }}
      >
        Full Ledger →
      </Link>
    </div>
  );
}

function MetricCell({ m }: { m: Metric }) {
  const trendGlyph = m.trend === 'up' ? '▲' : m.trend === 'down' ? '▼' : '→';
  const trendColour =
    m.trend === 'up' ? 'var(--green)' : m.trend === 'down' ? 'var(--red)' : 'var(--ink-faint)';

  const max = Math.max(...m.spark, 1);
  const min = Math.min(...m.spark, 0);
  const range = max - min || 1;
  const points = m.spark
    .map((v, i) => {
      const x = (i / Math.max(1, m.spark.length - 1)) * 86 + 1;
      const y = 13 - ((v - min) / range) * 12;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div className="flex flex-col" style={{ gap: 2 }}>
      <span
        style={{
          fontSize: 9,
          letterSpacing: '0.18em',
          color: 'var(--ink-faint)',
          textTransform: 'uppercase',
        }}
      >
        {m.label}
      </span>
      <div className="flex items-baseline" style={{ gap: 8, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
        <span className="num-lg" style={{ fontSize: 14 }}>
          {m.value}
        </span>
        <span style={{ fontSize: 10, color: trendColour }}>{trendGlyph}</span>
      </div>
      <svg width={88} height={14} aria-hidden="true" style={{ display: 'block', marginTop: 1 }}>
        <polyline fill="none" stroke="var(--teal)" strokeWidth={1.25} points={points} />
      </svg>
    </div>
  );
}

const FALLBACK: Metric[] = [
  { key: 'brier',      label: 'Aggregate Brier',     value: '—',     trend: 'flat', spark: [0.18, 0.18, 0.18, 0.18, 0.18, 0.18] },
  { key: 'posture',    label: 'Posture-Shift Monitor', value: '—',   trend: 'flat', spark: [0.22, 0.22, 0.22, 0.22, 0.22, 0.22] },
  { key: 'conflict',   label: 'Conflict Escalation', value: '—',     trend: 'flat', spark: [0.20, 0.20, 0.20, 0.20, 0.20, 0.20] },
  { key: 'trade',      label: 'Trade-Flow Horizon',  value: '—',     trend: 'flat', spark: [0.17, 0.17, 0.17, 0.17, 0.17, 0.17] },
  { key: 'precision',  label: 'Alerts Precision@10', value: '—',     trend: 'flat', spark: [0.60, 0.60, 0.60, 0.60, 0.60, 0.60] },
];
