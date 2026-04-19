'use client';
import { useEffect, useState } from 'react';

interface Data {
  groups: Array<{ slug: string; label: string; minerals: Array<{ slug: string; label: string; china_refining_share: number; risk_band: string }> }>;
  refining_dominance: Array<{ mineral: string; share: number }>;
  mines: Array<{ mineral: string; name: string; country: string; owner: string; tonnage_pct: number; status: string }>;
  supply_risk_index: Array<{ mineral: string; band: string }>;
  in_transit: Array<{ vessel: string; flag: string; route: string; mineral: string; tonnage_t: number; eta_hours: number }>;
}

export default function MineralsWorkspace() {
  const [data, setData] = useState<Data | null>(null);
  const [selected, setSelected] = useState('cobalt');

  useEffect(() => {
    fetch('/api/intel/minerals/overview')
      .then(r => r.json())
      .then((j: Data) => setData(j));
  }, []);

  if (!data) {
    return (
      <div style={{ padding: 24 }}>
        <p className="eyebrow">Loading minerals overview…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ padding: 16, gap: 14 }}>
      <div
        className="flex flex-wrap items-center"
        style={{ gap: 16, padding: 12, background: 'var(--bg-panel)', border: '1px solid var(--rule-soft)' }}
      >
        {data.groups.map(g => (
          <div key={g.slug} className="flex items-center" style={{ gap: 8 }}>
            <span className="eyebrow" style={{ color: 'var(--violet)' }}>{g.label}</span>
            {g.minerals.map(m => (
              <button
                key={m.slug}
                onClick={() => setSelected(m.slug)}
                style={{
                  padding: '5px 10px',
                  fontFamily: 'var(--f-mono)',
                  fontSize: 10.5,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  background: selected === m.slug ? 'var(--violet)' : 'var(--bg-raised)',
                  color: selected === m.slug ? 'var(--bg-void)' : 'var(--ink-dim)',
                  border: `1px solid ${selected === m.slug ? 'var(--violet)' : 'var(--rule)'}`,
                  borderRadius: 2,
                  cursor: 'pointer',
                  fontWeight: selected === m.slug ? 500 : 400,
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div
        className="grid"
        style={{
          gridTemplateColumns: '2fr 1.3fr 1.3fr',
          gap: 1,
          background: 'var(--rule-soft)',
          border: '1px solid var(--rule-soft)',
        }}
      >
        <Panel title="01 · Mine Tonnage">
          <table style={{ width: '100%', fontFamily: 'var(--f-mono)', fontSize: 11, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                <th style={{ textAlign: 'left', padding: '6px 4px' }}>Mine</th>
                <th style={{ textAlign: 'left', padding: '6px 4px' }}>Owner</th>
                <th style={{ textAlign: 'right', padding: '6px 4px' }}>%</th>
                <th style={{ textAlign: 'right', padding: '6px 4px' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.mines
                .filter(m => m.mineral === selected)
                .map((m, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--rule-soft)' }}>
                    <td style={{ padding: '6px 4px', color: 'var(--ink)' }}>{m.name}</td>
                    <td style={{ padding: '6px 4px', color: 'var(--ink-dim)' }}>{m.owner}</td>
                    <td style={{ padding: '6px 4px', color: 'var(--ink)', textAlign: 'right' }}>
                      {(m.tonnage_pct * 100).toFixed(0)}%
                    </td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                      <StatusBadge status={m.status} />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="02 · China Refining">
          <div className="flex flex-col" style={{ gap: 6 }}>
            {data.refining_dominance.map(r => (
              <div key={r.mineral} className="flex items-center" style={{ gap: 10 }}>
                <span style={{ width: 40, fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--ink-dim)' }}>{r.mineral}</span>
                <div style={{ flex: 1, height: 6, background: 'var(--bg-raised)', border: '1px solid var(--rule)' }}>
                  <div style={{ width: `${r.share * 100}%`, height: '100%', background: r.share >= 0.7 ? 'var(--red)' : r.share >= 0.5 ? 'var(--amber)' : 'var(--green)' }} />
                </div>
                <span className="num-lg" style={{ width: 40, fontSize: 11, color: 'var(--ink)', textAlign: 'right' }}>
                  {(r.share * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="03 · Supply Risk Index">
          <div className="flex flex-col" style={{ gap: 4 }}>
            {data.supply_risk_index.map(r => (
              <div
                key={r.mineral}
                className="flex items-center justify-between"
                style={{
                  padding: '5px 8px',
                  background: r.mineral.toLowerCase().startsWith(selected.slice(0, 3)) ? 'rgba(139, 127, 216, 0.08)' : 'var(--bg-panel)',
                  border: `1px solid ${r.mineral.toLowerCase().startsWith(selected.slice(0, 3)) ? 'var(--violet)' : 'var(--rule-soft)'}`,
                  fontFamily: 'var(--f-mono)',
                  fontSize: 11,
                }}
              >
                <span style={{ color: 'var(--ink-dim)' }}>{r.mineral}</span>
                <span
                  style={{
                    padding: '1px 6px',
                    background: bandColour(r.band),
                    color: 'var(--bg-void)',
                    fontSize: 9.5,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                  }}
                >
                  {r.band}
                </span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="04 · In-Transit Shipments" span={3}>
          <table style={{ width: '100%', fontFamily: 'var(--f-mono)', fontSize: 11, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                <th style={{ textAlign: 'left', padding: '6px 4px' }}>Vessel · Flag</th>
                <th style={{ textAlign: 'left', padding: '6px 4px' }}>Route</th>
                <th style={{ textAlign: 'left', padding: '6px 4px' }}>Mineral</th>
                <th style={{ textAlign: 'right', padding: '6px 4px' }}>Tonnage</th>
                <th style={{ textAlign: 'right', padding: '6px 4px' }}>ETA</th>
              </tr>
            </thead>
            <tbody>
              {data.in_transit.map((s, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--rule-soft)' }}>
                  <td style={{ padding: '6px 4px', color: 'var(--ink)' }}>
                    {s.vessel} · {s.flag}
                  </td>
                  <td style={{ padding: '6px 4px', color: 'var(--ink-dim)' }}>{s.route}</td>
                  <td style={{ padding: '6px 4px', color: 'var(--violet)' }}>{s.mineral}</td>
                  <td style={{ padding: '6px 4px', color: 'var(--ink)', textAlign: 'right' }}>{s.tonnage_t.toLocaleString()} t</td>
                  <td style={{ padding: '6px 4px', color: 'var(--ink)', textAlign: 'right' }}>{Math.round(s.eta_hours / 24)} d</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="05 · Sentinel-2 Stockpile Imagery" span={3}>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {[1, 2, 3, 4].map(i => (
              <div
                key={i}
                style={{
                  aspectRatio: '1 / 1',
                  background:
                    'linear-gradient(135deg, var(--bg-raised), var(--bg-hover)), repeating-linear-gradient(45deg, rgba(255,255,255,0.02) 0 4px, transparent 4px 8px)',
                  border: '1px solid var(--rule)',
                  padding: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <span className="eyebrow">Tile {i}</span>
                <span className="num-lg" style={{ fontSize: 16, color: i % 2 === 0 ? 'var(--red)' : 'var(--amber)' }}>
                  {i % 2 === 0 ? '+18%' : '+9%'}
                </span>
                <span style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: 'var(--f-mono)' }}>vs baseline</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Panel({ title, children, span = 1 }: { title: string; children: React.ReactNode; span?: number }) {
  return (
    <section
      style={{
        gridColumn: span === 3 ? 'span 3' : undefined,
        background: 'var(--bg-navy)',
        padding: 14,
      }}
    >
      <h3 className="panel-title" style={{ marginBottom: 10 }}>
        <span className="idx">{title.split(' · ')[0]}</span>
        {title.split(' · ')[1]}
      </h3>
      {children}
    </section>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; colour: string }> = {
    running: { label: 'RUNNING', colour: 'var(--green)' },
    'permit-review': { label: 'PERMIT', colour: 'var(--amber)' },
    strike: { label: 'STRIKE', colour: 'var(--red)' },
  };
  const e = map[status] ?? { label: status.toUpperCase(), colour: 'var(--ink-faint)' };
  return (
    <span
      style={{
        padding: '2px 6px',
        fontFamily: 'var(--f-mono)',
        fontSize: 9,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        background: 'transparent',
        color: e.colour,
        border: `1px solid ${e.colour}`,
      }}
    >
      {e.label}
    </span>
  );
}

function bandColour(band: string): string {
  return band === 'red' ? 'var(--red)' : band === 'amber' ? 'var(--amber)' : 'var(--green)';
}
