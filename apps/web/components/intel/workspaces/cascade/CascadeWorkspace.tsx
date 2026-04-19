'use client';
import { useState } from 'react';
import ScenarioLayout from '@/components/intel/shared/ScenarioLayout';
import infra from '@/lib/fixtures/infra_edges.json';
import type { CascadeOutput } from '@/lib/intel/cascade';

const CLASS_FILTERS = ['refinery', 'pipeline', 'port', 'lng'] as const;

export default function CascadeWorkspace() {
  const [seed, setSeed] = useState<string[]>(['rotterdam']);
  const [loss, setLoss] = useState(65);
  const [duration, setDuration] = useState(72);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CascadeOutput | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/intel/cascade/propagate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed_nodes: seed, capacity_loss_pct: loss, outage_duration_hours: duration }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? 'cascade failed');
      setResult(j);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown error');
    } finally {
      setRunning(false);
    }
  }

  const toggleSeed = (id: string) =>
    setSeed(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));

  return (
    <ScenarioLayout
      left={
        <div className="flex flex-col" style={{ gap: 16 }}>
          <PanelHead accent="var(--amber)">Seed Selector</PanelHead>

          <Field label="Infrastructure Class">
            <div className="flex flex-wrap" style={{ gap: 4 }}>
              {CLASS_FILTERS.map(c => (
                <Chip key={c} active onClick={() => undefined} accent="var(--amber)">
                  {c}
                </Chip>
              ))}
            </div>
          </Field>

          <Field label="Seed Nodes">
            <div className="flex flex-col" style={{ gap: 4 }}>
              {infra.nodes.filter((n: any) => n.tier !== 'transit').map((n: any) => {
                const active = seed.includes(n.id);
                const statusColour =
                  n.status === 'crit' ? 'var(--red)' : n.status === 'warn' ? 'var(--amber)' : 'var(--green)';
                return (
                  <label
                    key={n.id}
                    className="flex items-center"
                    style={{
                      gap: 8,
                      padding: '6px 8px',
                      background: active ? 'rgba(212, 162, 76, 0.08)' : 'var(--bg-panel)',
                      border: `1px solid ${active ? 'var(--amber)' : 'var(--rule)'}`,
                      fontSize: 12,
                      color: active ? 'var(--ink)' : 'var(--ink-dim)',
                      cursor: 'pointer',
                      borderRadius: 2,
                    }}
                  >
                    <input type="checkbox" checked={active} onChange={() => toggleSeed(n.id)} style={{ accentColor: 'var(--amber)' }} />
                    <span style={{ flex: 1 }}>{n.label}</span>
                    <span className="num-lg" style={{ fontSize: 10.5, color: 'var(--ink-faint)' }}>{n.throughput_kbd} kbd</span>
                    <span
                      style={{
                        fontFamily: 'var(--f-mono)',
                        fontSize: 9,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        color: statusColour,
                      }}
                    >
                      {n.status}
                    </span>
                  </label>
                );
              })}
            </div>
          </Field>

          <Field label={`Capacity loss · ${loss}%`}>
            <input type="range" min={0} max={100} value={loss} onChange={e => setLoss(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--amber)' }} />
          </Field>

          <Field label={`Outage duration · ${duration} h`}>
            <input type="range" min={6} max={168} value={duration} onChange={e => setDuration(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--amber)' }} />
          </Field>

          <button
            onClick={run}
            disabled={running}
            style={{
              padding: '10px 16px',
              background: 'var(--amber)',
              color: 'var(--bg-void)',
              border: '1px solid var(--amber)',
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
            ◆ {running ? 'Propagating…' : 'Propagate Cascade'}
          </button>

          {error && <p style={{ color: 'var(--red)', fontSize: 11 }}>{error}</p>}
        </div>
      }
      centre={
        <div className="flex flex-col" style={{ gap: 16 }}>
          <PanelHead accent="var(--amber)">Cascade DAG · Source → Transit → Processing → Delivery</PanelHead>
          <DagVisualisation result={result} seed={seed} />
        </div>
      }
      right={
        <div className="flex flex-col" style={{ gap: 16 }}>
          <PanelHead accent="var(--amber)">Timeline</PanelHead>
          {result ? (
            <div
              className="grid"
              style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, background: 'var(--rule-soft)', border: '1px solid var(--rule-soft)' }}
            >
              {result.timeline.map(t => (
                <div key={t.label} style={{ background: 'var(--bg-panel)', padding: 10 }}>
                  <span className="eyebrow">{t.label}</span>
                  <div className="num-lg" style={{ fontSize: 16, color: 'var(--amber)' }}>{t.affected_nodes.length}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--ink-faint)' }}>nodes affected</div>
                </div>
              ))}
            </div>
          ) : (
            <Empty>Run to see T+24h/48h/72h/7d affected nodes.</Empty>
          )}

          <PanelHead accent="var(--amber)">Substitution Cost</PanelHead>
          {result ? (
            <div className="flex flex-col" style={{ gap: 4, fontFamily: 'var(--f-mono)', fontSize: 11 }}>
              {result.substitution_cost.map((s, i) => (
                <div key={i} className="flex items-baseline justify-between" style={{ padding: '4px 0', borderBottom: '1px solid var(--rule-soft)' }}>
                  <span style={{ color: 'var(--ink-dim)' }}>{s.from} → {s.to}</span>
                  <span style={{ color: 'var(--amber)' }}>+${s.cost_usd_bbl.toFixed(2)}/bbl</span>
                </div>
              ))}
            </div>
          ) : (
            <Empty>—</Empty>
          )}

          <PanelHead accent="var(--amber)">Grid Stress</PanelHead>
          {result ? (
            <div className="flex items-baseline" style={{ gap: 8 }}>
              <span className="num-lg" style={{ fontSize: 28, color: result.grid_stress >= 0.6 ? 'var(--red)' : 'var(--amber)' }}>
                {(result.grid_stress * 100).toFixed(0)}%
              </span>
              <span className="eyebrow">index</span>
            </div>
          ) : (
            <Empty>—</Empty>
          )}
        </div>
      }
    />
  );
}

function DagVisualisation({ result, seed }: { result: CascadeOutput | null; seed: string[] }) {
  if (!result) {
    return <Empty>The 4-tier DAG (Source → Transit → Processing → Delivery) renders after Propagate. Nodes are sized by throughput and coloured red when starved post-propagation.</Empty>;
  }

  const W = 680;
  const H = 420;
  const tiers: CascadeOutput['nodes'][number]['tier'][] = ['source', 'transit', 'processing', 'delivery'];
  const byTier: Record<string, typeof result.nodes> = { source: [], transit: [], processing: [], delivery: [] };
  result.nodes.forEach(n => byTier[n.tier].push(n));
  const columnX: Record<string, number> = {
    source: 90,
    transit: (W / 4) * 1.3,
    processing: (W / 4) * 2.3,
    delivery: W - 100,
  };

  const pos = new Map<string, { x: number; y: number; r: number }>();
  for (const tier of tiers) {
    const ns = byTier[tier];
    const count = Math.max(1, ns.length);
    ns.forEach((n, i) => {
      const y = ((i + 1) / (count + 1)) * H;
      const maxTh = Math.max(...ns.map(x => x.throughput_kbd), 1);
      const r = 6 + (n.throughput_kbd / maxTh) * 10;
      pos.set(n.id, { x: columnX[tier], y, r });
    });
  }

  return (
    <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--rule-soft)' }}>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        {result.edges.map((e, i) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;
          const stroke = e.active ? 'var(--rule-strong)' : 'var(--red)';
          const width = Math.max(0.6, Math.log(e.flow_kbd + 1) * 0.2);
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={stroke} strokeWidth={width} opacity={e.active ? 0.7 : 1} />;
        })}
        {tiers.map((tier, col) => (
          <text
            key={tier}
            x={columnX[tier]}
            y={18}
            textAnchor="middle"
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 9.5,
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              fill: 'var(--ink-faint)',
            }}
          >
            {tier}
          </text>
        ))}
        {result.nodes.map(n => {
          const p = pos.get(n.id);
          if (!p) return null;
          const isSeed = seed.includes(n.id);
          const colour =
            n.status === 'crit' ? 'var(--red)' : n.status === 'warn' ? 'var(--amber)' : 'var(--green)';
          return (
            <g key={n.id}>
              {isSeed && (
                <circle cx={p.x} cy={p.y} r={p.r + 4} fill="none" stroke="var(--amber)" strokeWidth="1" strokeDasharray="3 2" />
              )}
              <circle cx={p.x} cy={p.y} r={p.r} fill={colour} opacity={0.85} />
              <text
                x={p.x}
                y={p.y + p.r + 12}
                textAnchor="middle"
                style={{ fontFamily: 'var(--f-mono)', fontSize: 9, fill: 'var(--ink-dim)', letterSpacing: '0.04em' }}
              >
                {n.label}
              </text>
              <text
                x={p.x}
                y={p.y + 3}
                textAnchor="middle"
                style={{ fontFamily: 'var(--f-mono)', fontSize: 9, fill: 'var(--bg-void)', fontWeight: 600 }}
              >
                {n.throughput_kbd > 999 ? `${Math.round(n.throughput_kbd / 1000)}M` : n.throughput_kbd}
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

function Chip({ active, onClick, children, accent = 'var(--teal)' }: { active: boolean; onClick: () => void; children: React.ReactNode; accent?: string }) {
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
