'use client';
import { useEffect, useState } from 'react';

interface Region {
  region: string;
  detected: boolean;
  p_value: number;
  test_statistic: number;
  old_window: { start: string; end: string; mean: number; std: number };
  new_window: { start: string; end: string; mean: number; std: number };
  signals: Array<{ signal: string; effect: number; direction: string }>;
}

interface Payload {
  regions: Region[];
  degraded?: boolean;
  note?: string;
}

export default function RegimeShiftsWorkspace() {
  const [data, setData] = useState<Payload | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/intel/regime-shifts')
      .then(r => r.json())
      .then((j: Payload) => {
        setData(j);
        setSelected(j.regions[0]?.region ?? null);
      });
  }, []);

  if (!data) {
    return <div style={{ padding: 24 }}><p className="eyebrow">Loading regimes…</p></div>;
  }

  const active = data.regions.find(r => r.region === selected) ?? data.regions[0];

  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: '280px 1fr 320px',
        gap: 1,
        background: 'var(--rule-soft)',
        minHeight: 620,
      }}
    >
      <aside style={{ background: 'var(--bg-navy)', padding: 14 }}>
        <Head accent="var(--amber)">Pinned Theatres</Head>
        {data.degraded && (
          <p className="eyebrow" style={{ marginTop: 8, color: 'var(--ink-faint)' }}>
            Illustrative data — nightly cron lands Phase 7
          </p>
        )}
        <div className="flex flex-col" style={{ gap: 4, marginTop: 10 }}>
          {data.regions.map(r => (
            <button
              key={r.region}
              onClick={() => setSelected(r.region)}
              style={{
                textAlign: 'left',
                padding: '10px 12px',
                background: selected === r.region ? 'rgba(212, 162, 76, 0.08)' : 'var(--bg-panel)',
                border: `1px solid ${selected === r.region ? 'var(--amber)' : 'var(--rule-soft)'}`,
                color: 'var(--ink)',
                fontFamily: 'var(--f-body)',
                fontSize: 12,
                cursor: 'pointer',
                borderRadius: 2,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span>{r.region}</span>
              {r.detected ? (
                <span
                  style={{
                    fontFamily: 'var(--f-mono)',
                    fontSize: 9,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    background: 'var(--red)',
                    color: 'var(--bg-void)',
                    padding: '1px 6px',
                  }}
                >
                  Shift
                </span>
              ) : (
                <span className="num-lg" style={{ fontSize: 10.5, color: 'var(--ink-faint)' }}>
                  p={r.p_value.toFixed(2)}
                </span>
              )}
            </button>
          ))}
        </div>
      </aside>

      <section style={{ background: 'var(--bg-navy)', padding: 16 }}>
        {active && (
          <>
            {active.detected && (
              <div
                style={{
                  padding: 10,
                  background: 'rgba(224, 93, 80, 0.08)',
                  borderLeft: '2px solid var(--red)',
                  fontFamily: 'var(--f-mono)',
                  fontSize: 12,
                  letterSpacing: '0.1em',
                  color: 'var(--red)',
                  textTransform: 'uppercase',
                  marginBottom: 14,
                }}
              >
                Regime change detected · KS p = {active.p_value.toFixed(4)}
              </div>
            )}

            <Head accent="var(--amber)">30d vs 60d Histograms · {active.region}</Head>
            <Histograms old={active.old_window} latest={active.new_window} />
          </>
        )}
      </section>

      <aside style={{ background: 'var(--bg-navy)', padding: 14 }}>
        <Head accent="var(--amber)">Per-Signal Shift</Head>
        <div className="flex flex-col" style={{ gap: 4, marginTop: 10 }}>
          {active?.signals.map(s => (
            <div
              key={s.signal}
              className="flex items-center"
              style={{
                gap: 8,
                padding: '6px 8px',
                background: 'var(--bg-panel)',
                border: '1px solid var(--rule-soft)',
                fontFamily: 'var(--f-mono)',
                fontSize: 11,
                color: 'var(--ink)',
              }}
            >
              <span style={{ flex: 1, color: 'var(--ink-dim)' }}>{prettySignal(s.signal)}</span>
              <span
                style={{
                  fontSize: 11,
                  color: s.direction === 'up' ? 'var(--red)' : s.direction === 'down' ? 'var(--green)' : 'var(--ink-faint)',
                }}
              >
                {s.direction === 'up' ? '▲' : s.direction === 'down' ? '▼' : '→'}
              </span>
              <span className="num-lg">{(s.effect * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

function Histograms({ old: o, latest: l }: { old: Region['old_window']; latest: Region['new_window'] }) {
  // Generate two mock histograms deterministically from the means/stds.
  const bins = 12;
  function make(mean: number, std: number) {
    return Array.from({ length: bins }, (_, i) => {
      const x = i + 1;
      return Math.exp(-((x - mean / 5) ** 2) / (2 * (std / 3) ** 2));
    });
  }
  const h1 = make(o.mean, o.std);
  const h2 = make(l.mean, l.std);
  const max = Math.max(...h1, ...h2);

  return (
    <div
      className="grid"
      style={{ gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--rule-soft)', border: '1px solid var(--rule-soft)' }}
    >
      {[
        { label: `Preceding 60d · μ=${o.mean.toFixed(0)}`, h: h1, colour: 'var(--ink-faint)' },
        { label: `Trailing 30d · μ=${l.mean.toFixed(0)}`, h: h2, colour: 'var(--amber)' },
      ].map(({ label, h, colour }, idx) => (
        <div key={idx} style={{ background: 'var(--bg-panel)', padding: 12 }}>
          <div className="eyebrow" style={{ marginBottom: 10, color: idx === 0 ? 'var(--ink-faint)' : 'var(--amber)' }}>
            {label}
          </div>
          <svg width="100%" height={140} viewBox={`0 0 ${bins * 14 + 8} 140`} aria-hidden>
            {h.map((v, i) => (
              <rect
                key={i}
                x={4 + i * 14}
                y={140 - (v / max) * 120 - 4}
                width={10}
                height={(v / max) * 120}
                fill={colour}
                opacity={0.85}
              />
            ))}
          </svg>
        </div>
      ))}
    </div>
  );
}

function Head({ children, accent = 'var(--teal)' }: { children: React.ReactNode; accent?: string }) {
  return (
    <h3 className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 3, height: 12, background: accent }} />
      {children}
    </h3>
  );
}

function prettySignal(s: string): string {
  return s.replaceAll('_', ' ');
}
