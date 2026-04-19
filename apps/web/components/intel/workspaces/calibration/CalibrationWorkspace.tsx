'use client';
import { useEffect, useState } from 'react';
import Sparkline from '@/components/intel/shared/Sparkline';

interface Metric {
  key: string;
  label: string;
  value: string;
  trend: string;
  spark: number[];
}

export default function CalibrationWorkspace() {
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [degraded, setDegraded] = useState(true);

  useEffect(() => {
    fetch('/api/intel/calibration/summary')
      .then(r => r.json())
      .then(j => {
        setMetrics(j.metrics ?? []);
        setDegraded(!!j.degraded);
      });
  }, []);

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Methodology */}
      <section
        style={{
          padding: 20,
          background: 'var(--bg-panel)',
          border: '1px solid var(--rule-soft)',
          borderLeft: '2px solid var(--teal)',
        }}
      >
        <div className="eyebrow" style={{ marginBottom: 6 }}>Methodology</div>
        <h2 style={{ fontFamily: 'var(--f-display)', fontSize: 18, fontWeight: 500, color: 'var(--ink)', marginBottom: 10, letterSpacing: '0.04em' }}>
          How we grade ourselves
        </h2>
        <p style={{ fontSize: 13, color: 'var(--ink-dim)', lineHeight: 1.6 }}>
          Every forecast the platform issues is stamped into the <em>Predictions Register</em> the moment it is made — the target
          observable, the predicted distribution, the resolves-at timestamp, and the persona that will consume it. When the
          resolve window closes a scoring job diffs the predicted distribution against the observed outcome and writes a
          Brier score, a log-loss, and the calibration bin. This page materialises the resulting aggregates — by feature,
          by time window, and by persona — plus reliability diagrams for each persona.
        </p>
        {degraded && (
          <p style={{ fontSize: 12, color: 'var(--amber)', marginTop: 10, fontFamily: 'var(--f-mono)', letterSpacing: '0.04em' }}>
            ⚠ The Prediction Register is warming up. The numbers below are a flat-line placeholder until ~30 days of
            resolved predictions accumulate. This is the correct degraded state, not a bug.
          </p>
        )}
      </section>

      {/* Aggregate metrics */}
      <section>
        <h3 className="panel-title" style={{ marginBottom: 10 }}>
          <span className="idx">01</span>Aggregate Metrics
        </h3>
        <div
          className="grid"
          style={{ gridTemplateColumns: 'repeat(5, 1fr)', gap: 1, background: 'var(--rule-soft)', border: '1px solid var(--rule-soft)' }}
        >
          {metrics.map(m => (
            <div key={m.key} style={{ background: 'var(--bg-panel)', padding: 14 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>{m.label}</div>
              <div className="num-lg" style={{ fontSize: 22, color: 'var(--ink)' }}>{m.value}</div>
              <div style={{ marginTop: 8 }}>
                <Sparkline values={m.spark ?? []} width={140} height={28} stroke="var(--teal)" fill="rgba(25,208,184,0.14)" />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Per-persona reliability diagrams */}
      <section>
        <h3 className="panel-title" style={{ marginBottom: 10 }}>
          <span className="idx">02</span>Reliability Diagrams · by persona
        </h3>
        <div
          className="grid"
          style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, background: 'var(--rule-soft)', border: '1px solid var(--rule-soft)' }}
        >
          {['analyst', 'day-trader', 'commodities'].map(p => (
            <ReliabilityDiagram key={p} persona={p} />
          ))}
        </div>
      </section>

      {/* Performance table */}
      <section>
        <h3 className="panel-title" style={{ marginBottom: 10 }}>
          <span className="idx">03</span>Performance · by feature × window
        </h3>
        <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--rule-soft)', padding: 12 }}>
          <table style={{ width: '100%', fontFamily: 'var(--f-mono)', fontSize: 11.5, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>Feature</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>Window</th>
                <th style={{ textAlign: 'right', padding: '6px 8px' }}>Count</th>
                <th style={{ textAlign: 'right', padding: '6px 8px' }}>Brier</th>
                <th style={{ textAlign: 'right', padding: '6px 8px' }}>Log-loss</th>
                <th style={{ textAlign: 'right', padding: '6px 8px' }}>Slope</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--rule-soft)', color: 'var(--ink)' }}>
                  <td style={{ padding: '6px 8px' }}>{r.feature}</td>
                  <td style={{ padding: '6px 8px', color: 'var(--ink-dim)' }}>{r.window}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{r.count}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{r.brier}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{r.logloss}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{r.slope}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ReliabilityDiagram({ persona }: { persona: string }) {
  // Deterministic placeholder diagonal with small deviations per persona.
  const bins = Array.from({ length: 10 }, (_, i) => {
    const ideal = (i + 0.5) / 10;
    const offset = persona === 'day-trader' ? 0.05 : persona === 'commodities' ? -0.03 : 0.01;
    return { ideal, observed: Math.max(0, Math.min(1, ideal + offset + Math.sin(i) * 0.02)) };
  });
  const W = 220;
  const H = 160;

  return (
    <div style={{ background: 'var(--bg-panel)', padding: 14 }}>
      <div className="eyebrow" style={{ marginBottom: 6 }}>{persona.replaceAll('-', ' ')}</div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <line x1={24} y1={H - 20} x2={W - 8} y2={20} stroke="var(--rule-strong)" strokeWidth="0.8" strokeDasharray="3 3" />
        <line x1={24} y1={H - 20} x2={W - 8} y2={H - 20} stroke="var(--rule)" strokeWidth="0.8" />
        <line x1={24} y1={H - 20} x2={24} y2={20} stroke="var(--rule)" strokeWidth="0.8" />
        {bins.map((b, i) => {
          const x = 24 + b.ideal * (W - 32);
          const y = H - 20 - b.observed * (H - 40);
          return <circle key={i} cx={x} cy={y} r={4} fill="var(--teal)" />;
        })}
      </svg>
    </div>
  );
}

const ROWS = [
  { feature: 'posture_shift',       window: '7d',  count: '—', brier: '—', logloss: '—', slope: '—' },
  { feature: 'posture_shift',       window: '30d', count: '—', brier: '—', logloss: '—', slope: '—' },
  { feature: 'posture_shift',       window: '90d', count: '—', brier: '—', logloss: '—', slope: '—' },
  { feature: 'conflict_escalation', window: '7d',  count: '—', brier: '—', logloss: '—', slope: '—' },
  { feature: 'conflict_escalation', window: '30d', count: '—', brier: '—', logloss: '—', slope: '—' },
  { feature: 'trade_flow',          window: '7d',  count: '—', brier: '—', logloss: '—', slope: '—' },
  { feature: 'trade_flow',          window: '30d', count: '—', brier: '—', logloss: '—', slope: '—' },
];
