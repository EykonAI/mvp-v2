'use client';
import { useEffect, useState } from 'react';

interface Convergence {
  id: string;
  location: string;
  joint_p_value: number;
  contributing_anomalies: Array<{ domain: string; label: string } | string>;
  synthesis: string;
  created_at: string;
}

interface Payload {
  events: Convergence[];
  degraded: boolean;
  reason?: string;
}

const DEMO: Convergence[] = [
  {
    id: 'demo-1',
    location: 'Red Sea',
    joint_p_value: 0.0008,
    contributing_anomalies: [
      { domain: 'maritime', label: 'AIS gap' },
      { domain: 'air_traffic', label: 'Naval reposition' },
      { domain: 'conflict', label: 'ACLED surge' },
    ],
    synthesis:
      'Three independent anomalies converge on the southern Red Sea within 72 h: a 14-h AIS gap on a VLCC, a carrier-strike-group reposition 180 NM southeast, and a 3σ surge in ACLED events ashore.',
    created_at: new Date().toISOString(),
  },
  {
    id: 'demo-2',
    location: 'Black Sea',
    joint_p_value: 0.0043,
    contributing_anomalies: [
      { domain: 'air_traffic', label: 'Mil cargo surge' },
      { domain: 'energy', label: 'Grid draw spike' },
    ],
    synthesis:
      'Dual-domain convergence: +38% military cargo flights into southern military districts over 48 h, paired with a persistent +12% generation draw on the adjacent energy corridor.',
    created_at: new Date().toISOString(),
  },
];

export default function ConvergenceFeed() {
  const [data, setData] = useState<Payload | null>(null);

  useEffect(() => {
    fetch('/api/intel/convergences?hours=24')
      .then(r => (r.ok ? r.json() : null))
      .then((j: Payload | null) => setData(j))
      .catch(() => setData(null));
  }, []);

  const events = data && data.events.length > 0 ? data.events : DEMO;
  const degraded = !data || data.events.length === 0;

  return (
    <div className="flex flex-col" style={{ gap: 10 }}>
      {degraded && (
        <p
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 9.5,
            letterSpacing: '0.12em',
            color: 'var(--ink-faint)',
            textTransform: 'uppercase',
            margin: 0,
          }}
        >
          No recent convergences — showing illustrative events
        </p>
      )}
      {events.map(c => (
        <article
          key={c.id}
          style={{
            padding: 10,
            background: 'var(--bg-panel)',
            borderLeft: '2px solid var(--violet)',
            cursor: 'pointer',
          }}
        >
          <header className="flex items-baseline justify-between" style={{ marginBottom: 4 }}>
            <span
              style={{
                fontFamily: 'var(--f-display)',
                fontSize: 13,
                fontWeight: 500,
                letterSpacing: '0.04em',
                color: 'var(--ink)',
              }}
            >
              {c.location}
            </span>
            <span
              className="num-lg"
              style={{ fontSize: 10.5, color: 'var(--violet)', letterSpacing: '0.02em' }}
            >
              p &lt; {c.joint_p_value.toFixed(3)}
            </span>
          </header>
          <p style={{ fontSize: 11, color: 'var(--ink-dim)', lineHeight: 1.5, margin: '4px 0 8px' }}>
            {c.synthesis}
          </p>
          <div className="flex flex-wrap" style={{ gap: 4 }}>
            {c.contributing_anomalies.map((a, i) => {
              const label = typeof a === 'string' ? a : a.label;
              const domain = typeof a === 'string' ? 'other' : a.domain;
              return (
                <span
                  key={i}
                  style={{
                    fontFamily: 'var(--f-mono)',
                    fontSize: 9,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    padding: '2px 6px',
                    border: `1px solid ${chipColour(domain)}`,
                    color: chipColour(domain),
                    background: 'transparent',
                    borderRadius: 2,
                  }}
                >
                  {label}
                </span>
              );
            })}
          </div>
        </article>
      ))}
    </div>
  );
}

function chipColour(domain: string): string {
  switch (domain) {
    case 'maritime':    return 'var(--teal)';
    case 'air_traffic': return 'var(--amber)';
    case 'conflict':    return 'var(--red)';
    case 'energy':      return 'var(--green)';
    default:            return 'var(--ink-faint)';
  }
}
