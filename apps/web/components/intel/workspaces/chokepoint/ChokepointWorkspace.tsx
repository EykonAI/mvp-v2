'use client';
import { useState } from 'react';
import ScenarioLayout from '@/components/intel/shared/ScenarioLayout';
import Sparkline from '@/components/intel/shared/Sparkline';
import type { ChokepointOutput, ClosureType } from '@/lib/intel/chokepoint';

const CHOKEPOINTS = [
  { slug: 'hormuz',         label: 'Strait of Hormuz',    throughput: '21.0 Mb/d' },
  { slug: 'bab-el-mandeb',  label: 'Bab-el-Mandeb',       throughput: '8.8 Mb/d' },
  { slug: 'malacca',        label: 'Strait of Malacca',   throughput: '16.0 Mb/d' },
  { slug: 'bosphorus',      label: 'Bosphorus',           throughput: '2.4 Mb/d' },
  { slug: 'suez',           label: 'Suez Canal',          throughput: '9.2 Mb/d' },
  { slug: 'panama',         label: 'Panama Canal',        throughput: '1.1 Mb/d' },
];

export default function ChokepointWorkspace() {
  const [chokepoint, setChokepoint] = useState('hormuz');
  const [closure, setClosure] = useState<ClosureType>('full');
  const [duration, setDuration] = useState(14);
  const [lag, setLag] = useState(48);
  const [assumptions, setAssumptions] = useState({
    spr_release: false,
    opec_plus_compensatory: false,
    asia_demand_elastic: true,
    shipping_rate_contagion: true,
  });
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ChokepointOutput | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/intel/chokepoint/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chokepoint,
          closure_type: closure,
          duration_days: duration,
          diversion_lag_hours: lag,
          assumptions,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? 'simulation failed');
      setResult(j);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown error');
    } finally {
      setRunning(false);
    }
  }

  return (
    <ScenarioLayout
      left={
        <div className="flex flex-col" style={{ gap: 16 }}>
          <PanelHead>Scenario Parameters</PanelHead>

          <Field label="Chokepoint">
            <div className="flex flex-col" style={{ gap: 4 }}>
              {CHOKEPOINTS.map(cp => (
                <Radio
                  key={cp.slug}
                  name="chokepoint"
                  value={cp.slug}
                  checked={chokepoint === cp.slug}
                  onChange={() => setChokepoint(cp.slug)}
                >
                  <span className="flex items-baseline justify-between" style={{ flex: 1 }}>
                    <span>{cp.label}</span>
                    <span className="num-lg" style={{ fontSize: 10.5, color: 'var(--ink-faint)' }}>{cp.throughput}</span>
                  </span>
                </Radio>
              ))}
            </div>
          </Field>

          <Field label="Closure Type">
            <div className="flex" style={{ gap: 4 }}>
              <Chip active={closure === 'partial_50'}     onClick={() => setClosure('partial_50')}>Partial 50%</Chip>
              <Chip active={closure === 'full'}           onClick={() => setClosure('full')}>Full closure</Chip>
              <Chip active={closure === 'transit_tax_30'} onClick={() => setClosure('transit_tax_30')}>Transit tax 30%</Chip>
            </div>
          </Field>

          <Field label={`Closure duration · ${duration} day${duration === 1 ? '' : 's'}`}>
            <input type="range" min={1} max={90} value={duration} onChange={e => setDuration(Number(e.target.value))} style={{ width: '100%' }} />
          </Field>

          <Field label={`Tanker diversion lag · ${lag} h`}>
            <input type="range" min={12} max={96} value={lag} onChange={e => setLag(Number(e.target.value))} style={{ width: '100%' }} />
          </Field>

          <Field label="Assumptions">
            <Checkbox checked={assumptions.spr_release}              onChange={v => setAssumptions(a => ({ ...a, spr_release: v }))}             >SPR release</Checkbox>
            <Checkbox checked={assumptions.opec_plus_compensatory}   onChange={v => setAssumptions(a => ({ ...a, opec_plus_compensatory: v }))}  >OPEC+ compensatory</Checkbox>
            <Checkbox checked={assumptions.asia_demand_elastic}      onChange={v => setAssumptions(a => ({ ...a, asia_demand_elastic: v }))}    >Asia demand elastic</Checkbox>
            <Checkbox checked={assumptions.shipping_rate_contagion}  onChange={v => setAssumptions(a => ({ ...a, shipping_rate_contagion: v }))}>Shipping-rate contagion</Checkbox>
          </Field>

          <button
            onClick={run}
            disabled={running}
            style={{
              padding: '10px 16px',
              background: 'var(--coral)',
              color: 'var(--bg-void)',
              border: '1px solid var(--coral)',
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
            ◆ {running ? 'Running…' : 'Run Scenario'}
          </button>

          {error && (
            <p style={{ color: 'var(--red)', fontSize: 11 }}>{error}</p>
          )}
        </div>
      }
      centre={
        <div className="flex flex-col" style={{ gap: 18 }}>
          <PanelHead>Price Envelope</PanelHead>
          <PriceEnvelope result={result} />

          <PanelHead>Refining Impact · kbd lost per cluster</PanelHead>
          <RefiningBars result={result} />

          <PanelHead>Timeline</PanelHead>
          <TimelineStrip result={result} />
        </div>
      }
      right={
        <div className="flex flex-col" style={{ gap: 16 }}>
          <PanelHead>Consequence Summary</PanelHead>
          <p style={{ color: 'var(--ink-dim)', fontSize: 12, lineHeight: 1.55 }}>
            {result
              ? result.consequence_summary
              : 'Configure parameters on the left and press Run Scenario. The model reruns entirely server-side.'}
          </p>

          {result && (
            <>
              <PanelHead>Diverted Vessels</PanelHead>
              <p className="num-lg" style={{ fontSize: 28, color: 'var(--coral)' }}>
                {result.diverted_vessels.toLocaleString()}
              </p>
              <span className="eyebrow">over window</span>

              <div className="flex" style={{ gap: 6, marginTop: 8 }}>
                <SmallButton onClick={() => alert('Save to Scenario A — Phase 9')}>Save as A</SmallButton>
                <SmallButton onClick={() => alert('Save to Scenario B — Phase 9')}>Save as B</SmallButton>
                <SmallButton onClick={() => alert('PDF + JSON export — Phase 9')}>Export</SmallButton>
              </div>
            </>
          )}
        </div>
      }
    />
  );
}

function PriceEnvelope({ result }: { result: ChokepointOutput | null }) {
  if (!result) {
    return <Empty>Run a scenario to see Brent spot + 3/6-month forwards with a 60/95% CI band.</Empty>;
  }
  const values = result.price_envelope.map(p => p.brent_spot);
  const fwd3 = result.price_envelope.map(p => p.forward_3m);
  const fwd6 = result.price_envelope.map(p => p.forward_6m);
  const max = Math.max(...values, ...fwd3, ...fwd6);
  const min = Math.min(...values, ...fwd3, ...fwd6);
  return (
    <div style={{ background: 'var(--bg-panel)', padding: 14, border: '1px solid var(--rule-soft)' }}>
      <div className="flex items-baseline justify-between" style={{ marginBottom: 8 }}>
        <span className="eyebrow">Brent spot · 3m · 6m forwards (USD/bbl)</span>
        <span className="num-lg" style={{ fontSize: 14, color: 'var(--coral)' }}>
          ${values.at(-1)?.toFixed(1)}
        </span>
      </div>
      <div style={{ position: 'relative' }}>
        <Sparkline values={values} width={640} height={120} stroke="var(--coral)" fill="rgba(222, 127, 112, 0.14)" min={min} max={max} />
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
          <Sparkline values={fwd3} width={640} height={120} stroke="var(--amber)" min={min} max={max} />
        </div>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
          <Sparkline values={fwd6} width={640} height={120} stroke="var(--ink-faint)" min={min} max={max} />
        </div>
      </div>
      <div className="flex" style={{ gap: 14, marginTop: 8 }}>
        <Legend dot="var(--coral)" label="Spot" />
        <Legend dot="var(--amber)" label="3m fwd" />
        <Legend dot="var(--ink-faint)" label="6m fwd" />
      </div>
    </div>
  );
}

function RefiningBars({ result }: { result: ChokepointOutput | null }) {
  if (!result) {
    return <Empty>Per-cluster lost kbd appears after a run.</Empty>;
  }
  const entries = Object.entries(result.refining_impact_kbd);
  const max = Math.max(...entries.map(([, v]) => v), 1);
  return (
    <div className="flex flex-col" style={{ gap: 6 }}>
      {entries.map(([label, v]) => (
        <div key={label} className="flex items-center" style={{ gap: 10 }}>
          <span style={{ width: 130, fontFamily: 'var(--f-mono)', fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-dim)' }}>
            {label}
          </span>
          <div style={{ flex: 1, height: 6, background: 'var(--bg-raised)', border: '1px solid var(--rule)' }}>
            <div style={{ width: `${(v / max) * 100}%`, height: '100%', background: 'var(--coral)' }} />
          </div>
          <span className="num-lg" style={{ width: 70, fontSize: 11, color: 'var(--ink)', textAlign: 'right' }}>
            {v.toLocaleString()} kbd
          </span>
        </div>
      ))}
    </div>
  );
}

function TimelineStrip({ result }: { result: ChokepointOutput | null }) {
  if (!result) return <Empty>T+24h / 48h / 72h / 7d / 30d deltas appear after a run.</Empty>;
  return (
    <div
      className="grid"
      style={{ gridTemplateColumns: 'repeat(5, 1fr)', gap: 1, background: 'var(--rule-soft)', border: '1px solid var(--rule-soft)' }}
    >
      {result.timeline.map(t => (
        <div key={t.label} style={{ background: 'var(--bg-panel)', padding: 10 }}>
          <span className="eyebrow">{t.label}</span>
          <div className="num-lg" style={{ fontSize: 16, color: t.delta_brent_pct >= 0 ? 'var(--coral)' : 'var(--green)' }}>
            {t.delta_brent_pct > 0 ? '+' : ''}
            {t.delta_brent_pct.toFixed(1)}%
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 4 }}>{t.delta_diverted} diverted</div>
          <div style={{ fontSize: 11, color: 'var(--ink-dim)', marginTop: 4, lineHeight: 1.4 }}>{t.note}</div>
        </div>
      ))}
    </div>
  );
}

function PanelHead({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="panel-title" style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 3, height: 12, background: 'var(--coral)' }} />
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

function Radio({
  name,
  value,
  checked,
  onChange,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center" style={{ gap: 8, cursor: 'pointer', fontSize: 12, color: checked ? 'var(--ink)' : 'var(--ink-dim)' }}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} style={{ accentColor: 'var(--coral)' }} />
      {children}
    </label>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
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
        background: active ? 'var(--coral)' : 'var(--bg-panel)',
        color: active ? 'var(--bg-void)' : 'var(--ink-dim)',
        border: `1px solid ${active ? 'var(--coral)' : 'var(--rule)'}`,
        borderRadius: 2,
        cursor: 'pointer',
        fontWeight: active ? 500 : 400,
      }}
    >
      {children}
    </button>
  );
}

function Checkbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center" style={{ gap: 8, fontSize: 12, color: checked ? 'var(--ink)' : 'var(--ink-dim)', cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={{ accentColor: 'var(--coral)' }} />
      {children}
    </label>
  );
}

function SmallButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      type="button"
      style={{
        flex: 1,
        padding: '6px 8px',
        background: 'transparent',
        color: 'var(--ink)',
        border: '1px solid var(--rule)',
        fontFamily: 'var(--f-mono)',
        fontSize: 10,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        borderRadius: 2,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="flex items-center" style={{ gap: 6, fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--ink-faint)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
      <span style={{ width: 10, height: 2, background: dot, display: 'inline-block' }} />
      {label}
    </span>
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
