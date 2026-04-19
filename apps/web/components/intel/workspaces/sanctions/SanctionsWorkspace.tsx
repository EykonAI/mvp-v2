'use client';
import { useState } from 'react';
import ScenarioLayout from '@/components/intel/shared/ScenarioLayout';
import type { SanctionsInput, SanctionsOutput } from '@/lib/intel/sanctions';

const BODIES = [
  { code: 'OFAC',         label: 'OFAC' },
  { code: 'EU',           label: 'EU' },
  { code: 'UK_OFSI',      label: 'UK OFSI' },
  { code: 'UN',           label: 'UN' },
  { code: 'G7_PRICE_CAP', label: 'G7 Price Cap' },
] as const;

const PRESETS = [
  { value: 'sdn_new_listing',         label: 'New SDN listing' },
  { value: 'secondary_expansion',     label: 'Secondary sanctions expansion' },
  { value: 'price_cap_tightening',    label: 'Price cap tightening' },
  { value: 'maritime_insurance_ban',  label: 'Maritime insurance ban' },
  { value: 'port_of_call_restriction',label: 'Port-of-call restrictions' },
] as const;

export default function SanctionsWorkspace() {
  const [bodies, setBodies] = useState<SanctionsInput['sanctioning_bodies']>(['OFAC']);
  const [preset, setPreset] = useState<SanctionsInput['preset']>('secondary_expansion');
  const [targets, setTargets] = useState<string[]>(['Sovcomflot Operator', 'NITC Operator', 'Gabon Flag', 'Kozmino Port']);
  const [depth, setDepth] = useState<1 | 2 | 3>(2);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SanctionsOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newTarget, setNewTarget] = useState('');

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/intel/sanctions/wargame', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sanctioning_bodies: bodies, preset, target_entities: targets, depth }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? 'wargame failed');
      setResult(j);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown error');
    } finally {
      setRunning(false);
    }
  }

  const toggleBody = (c: (typeof BODIES)[number]['code']) => {
    setBodies(b => (b.includes(c) ? b.filter(x => x !== c) : ([...b, c] as SanctionsInput['sanctioning_bodies'])));
  };

  return (
    <ScenarioLayout
      left={
        <div className="flex flex-col" style={{ gap: 16 }}>
          <PanelHead accent="var(--violet)">Scenario Builder</PanelHead>

          <Field label="Sanctioning Body">
            <div className="flex flex-wrap" style={{ gap: 4 }}>
              {BODIES.map(b => (
                <Chip key={b.code} active={bodies.includes(b.code)} onClick={() => toggleBody(b.code)} accent="var(--violet)">
                  {b.label}
                </Chip>
              ))}
            </div>
          </Field>

          <Field label="Sanction Preset">
            <div className="flex flex-col" style={{ gap: 4 }}>
              {PRESETS.map(p => (
                <label key={p.value} className="flex items-center" style={{ gap: 8, fontSize: 12, color: preset === p.value ? 'var(--ink)' : 'var(--ink-dim)', cursor: 'pointer' }}>
                  <input type="radio" name="preset" checked={preset === p.value} onChange={() => setPreset(p.value)} style={{ accentColor: 'var(--violet)' }} />
                  {p.label}
                </label>
              ))}
            </div>
          </Field>

          <Field label="Target Entities">
            <div className="flex flex-wrap" style={{ gap: 4, marginBottom: 6 }}>
              {targets.map(t => (
                <span
                  key={t}
                  style={{
                    padding: '4px 8px',
                    background: 'var(--bg-panel)',
                    border: '1px solid var(--violet)',
                    color: 'var(--violet)',
                    fontFamily: 'var(--f-mono)',
                    fontSize: 10.5,
                    borderRadius: 2,
                    display: 'inline-flex',
                    gap: 6,
                    alignItems: 'center',
                  }}
                >
                  {t}
                  <button onClick={() => setTargets(ts => ts.filter(x => x !== t))} style={{ background: 'transparent', border: 0, color: 'var(--violet)', cursor: 'pointer' }}>×</button>
                </span>
              ))}
            </div>
            <div className="flex" style={{ gap: 4 }}>
              <input
                value={newTarget}
                onChange={e => setNewTarget(e.target.value)}
                placeholder="Add entity…"
                style={{
                  flex: 1,
                  padding: '6px 8px',
                  background: 'var(--bg-panel)',
                  border: '1px solid var(--rule)',
                  color: 'var(--ink)',
                  fontFamily: 'var(--f-body)',
                  fontSize: 12,
                  borderRadius: 2,
                }}
              />
              <button
                onClick={() => {
                  if (newTarget.trim()) {
                    setTargets(ts => [...ts, newTarget.trim()]);
                    setNewTarget('');
                  }
                }}
                style={{
                  padding: '6px 10px',
                  background: 'var(--violet)',
                  color: 'var(--bg-void)',
                  border: 0,
                  fontFamily: 'var(--f-mono)',
                  fontSize: 10.5,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  borderRadius: 2,
                  cursor: 'pointer',
                }}
              >
                Add
              </button>
            </div>
          </Field>

          <Field label="Propagation Depth">
            <div className="flex" style={{ gap: 4 }}>
              {[1, 2, 3].map(d => (
                <Chip key={d} active={depth === d} onClick={() => setDepth(d as 1 | 2 | 3)} accent="var(--violet)">
                  {d}-hop
                </Chip>
              ))}
            </div>
          </Field>

          <button
            onClick={run}
            disabled={running}
            style={{
              padding: '10px 16px',
              background: 'var(--violet)',
              color: 'var(--bg-void)',
              border: '1px solid var(--violet)',
              fontFamily: 'var(--f-mono)',
              fontSize: 11.5,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              fontWeight: 500,
              cursor: running ? 'wait' : 'pointer',
              opacity: running ? 0.6 : 1,
              borderRadius: 2,
            }}
          >
            ◆ {running ? 'Running…' : 'Run Wargame'}
          </button>

          {error && <p style={{ color: 'var(--red)', fontSize: 11 }}>{error}</p>}
        </div>
      }
      centre={
        <div className="flex flex-col" style={{ gap: 16 }}>
          <PanelHead accent="var(--violet)">Affected Network · {result ? result.nodes.length : '—'} nodes</PanelHead>
          <NetworkGraph result={result} />
        </div>
      }
      right={
        <div className="flex flex-col" style={{ gap: 16 }}>
          <PanelHead accent="var(--violet)">Fleet Scope</PanelHead>
          {result ? (
            <>
              <span className="num-lg" style={{ fontSize: 28, color: 'var(--violet)' }}>
                {result.fleet_scope.affected} / {result.fleet_scope.total}
              </span>
              <span className="eyebrow">{((result.fleet_scope.affected / result.fleet_scope.total) * 100).toFixed(1)}% · 90-day window</span>
            </>
          ) : (
            <Empty>Run to see affected-fleet scope.</Empty>
          )}

          <PanelHead accent="var(--violet)">Top Affected</PanelHead>
          {result ? (
            <div className="flex flex-col" style={{ gap: 4, fontFamily: 'var(--f-mono)', fontSize: 11 }}>
              {result.top_affected.map((r, i) => (
                <div key={i} className="flex items-baseline justify-between" style={{ padding: '4px 0', borderBottom: '1px solid var(--rule-soft)' }}>
                  <span style={{ color: 'var(--ink-dim)' }}>{r.label}</span>
                  <span style={{ color: 'var(--violet)' }}>{r.weighted_hop_distance.toFixed(2)}</span>
                </div>
              ))}
            </div>
          ) : (
            <Empty>—</Empty>
          )}

          <PanelHead accent="var(--violet)">Flag-Hop Destinations</PanelHead>
          {result ? (
            <div className="flex flex-col" style={{ gap: 4 }}>
              {result.reflag_destinations.slice(0, 6).map((r, i) => (
                <div key={i} className="flex items-center" style={{ gap: 8 }}>
                  <span style={{ width: 110, fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--ink-dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    {r.flag}
                  </span>
                  <div style={{ flex: 1, height: 5, background: 'var(--bg-raised)', border: '1px solid var(--rule)' }}>
                    <div style={{ width: `${r.share * 100}%`, height: '100%', background: 'var(--violet)' }} />
                  </div>
                  <span className="num-lg" style={{ fontSize: 10.5, color: 'var(--ink)', width: 40, textAlign: 'right' }}>
                    {(r.share * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <Empty>—</Empty>
          )}
        </div>
      }
    />
  );
}

function NetworkGraph({ result }: { result: SanctionsOutput | null }) {
  if (!result) {
    return <Empty>A force-directed graph of affected entities, with dashed edges for projected reflags, appears here after Run.</Empty>;
  }

  const W = 640;
  const H = 440;
  const cx = W / 2;
  const cy = H / 2;
  const rings = [0, 120, 190, 250];
  const byRing: Record<number, typeof result.nodes> = { 0: [], 1: [], 2: [], 3: [] };
  result.nodes.forEach(n => byRing[n.ring].push(n));

  const pos = new Map<string, { x: number; y: number }>();
  (Object.entries(byRing) as Array<[string, typeof result.nodes]>).forEach(([ring, ns]) => {
    const r = rings[Number(ring)];
    const count = Math.max(1, ns.length);
    ns.forEach((n, i) => {
      const angle = (i / count) * Math.PI * 2;
      pos.set(n.id, { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
    });
  });

  return (
    <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--rule-soft)', position: 'relative' }}>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        {result.edges.map((e, i) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={e.projected_reflag ? 'var(--amber)' : 'var(--rule-strong)'}
              strokeDasharray={e.projected_reflag ? '3 3' : ''}
              strokeWidth={0.8}
            />
          );
        })}
        {result.nodes.map(n => {
          const p = pos.get(n.id);
          if (!p) return null;
          const colour =
            n.severity === 'seed'
              ? 'var(--violet)'
              : n.severity === 'high'
              ? 'var(--red)'
              : n.severity === 'medium'
              ? 'var(--amber)'
              : 'var(--ink-faint)';
          const r = n.severity === 'seed' ? 11 : n.severity === 'high' ? 7 : 5;
          return (
            <g key={n.id}>
              <circle cx={p.x} cy={p.y} r={r} fill={colour} opacity={0.85} />
              <text
                x={p.x}
                y={p.y - r - 4}
                textAnchor="middle"
                style={{
                  fontFamily: 'var(--f-mono)',
                  fontSize: 9,
                  fill: n.severity === 'seed' ? 'var(--ink)' : 'var(--ink-dim)',
                  letterSpacing: '0.04em',
                }}
              >
                {n.label.length > 22 ? n.label.slice(0, 22) + '…' : n.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function PanelHead({ children, accent = 'var(--teal)' }: { children: React.ReactNode; accent?: string }) {
  return (
    <h3 className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 3, height: 12, background: accent }} />
      {children}
    </h3>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col" style={{ gap: 6 }}>
      <span className="eyebrow">{label}</span>
      {children}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
  accent = 'var(--teal)',
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  accent?: string;
}) {
  return (
    <button
      onClick={onClick}
      type="button"
      style={{
        padding: '6px 10px',
        fontFamily: 'var(--f-mono)',
        fontSize: 10.5,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        background: active ? accent : 'var(--bg-panel)',
        color: active ? 'var(--bg-void)' : 'var(--ink-dim)',
        border: `1px solid ${active ? accent : 'var(--rule)'}`,
        borderRadius: 2,
        cursor: 'pointer',
        fontWeight: active ? 500 : 400,
      }}
    >
      {children}
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'var(--bg-panel)',
        padding: 20,
        border: '1px dashed var(--rule)',
        fontSize: 11.5,
        color: 'var(--ink-faint)',
        fontFamily: 'var(--f-mono)',
        letterSpacing: '0.08em',
      }}
    >
      {children}
    </div>
  );
}
