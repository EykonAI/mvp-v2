'use client';
import { useMemo, useState } from 'react';
import { usePersona } from '@/components/intel/shell/PersonaContext';
import Sparkline from '@/components/intel/shared/Sparkline';

const COMMODITIES = [
  { slug: 'wheat',   label: 'Wheat',        family: 'agri' },
  { slug: 'brent',   label: 'Brent',        family: 'oil' },
  { slug: 'wti',     label: 'WTI',          family: 'oil' },
  { slug: 'ttf',     label: 'TTF Gas',      family: 'gas' },
  { slug: 'cobalt',  label: 'Cobalt',       family: 'mineral' },
  { slug: 'lithium', label: 'Lithium',      family: 'mineral' },
  { slug: 'ree',     label: 'Rare Earths',  family: 'mineral' },
  { slug: 'copper',  label: 'Copper',       family: 'mineral' },
];

const BASE_PRICE: Record<string, number> = {
  wheat: 610, brent: 82, wti: 78, ttf: 38, cobalt: 32500, lithium: 14_800, ree: 680, copper: 9200,
};

export default function CommoditiesWorkspace() {
  const { persona } = usePersona();
  const [selected, setSelected] = useState('wheat');

  const priceSeries = useMemo(() => {
    const base = BASE_PRICE[selected] ?? 100;
    return Array.from({ length: 60 }, (_, i) => base * (1 + 0.08 * Math.sin(i * 0.25) + 0.005 * (i - 30)));
  }, [selected]);

  const isEnergy = ['brent', 'wti', 'ttf'].includes(selected);

  return (
    <div className="flex flex-col" style={{ padding: 16, gap: 14 }}>
      {/* Selector */}
      <div
        className="flex flex-wrap items-center"
        style={{ gap: 6, padding: 12, background: 'var(--bg-panel)', border: '1px solid var(--rule-soft)' }}
      >
        <span className="eyebrow" style={{ marginRight: 8 }}>Commodity</span>
        {COMMODITIES.map(c => (
          <button
            key={c.slug}
            onClick={() => setSelected(c.slug)}
            style={{
              padding: '5px 10px',
              fontFamily: 'var(--f-mono)',
              fontSize: 10.5,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              background: selected === c.slug ? 'var(--wheat)' : 'var(--bg-raised)',
              color: selected === c.slug ? 'var(--bg-void)' : 'var(--ink-dim)',
              border: `1px solid ${selected === c.slug ? 'var(--wheat)' : 'var(--rule)'}`,
              borderRadius: 2,
              cursor: 'pointer',
              fontWeight: selected === c.slug ? 500 : 400,
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      {persona === 'commodities' || persona === 'day-trader' ? (
        <div
          style={{
            padding: 10,
            background: 'rgba(212, 162, 76, 0.04)',
            borderLeft: '2px solid var(--wheat)',
            fontSize: 11.5,
            color: 'var(--ink-dim)',
          }}
        >
          {persona === 'day-trader'
            ? 'Market framing: named instruments with direction + magnitude + horizon. Persona footer on every card.'
            : 'Commodities desk framing: supply-demand balance + chokepoint exposure + disruption risk.'}
        </div>
      ) : null}

      <div
        className="grid"
        style={{
          gridTemplateColumns: '1fr 1.4fr 1fr',
          gap: 1,
          background: 'var(--rule-soft)',
          border: '1px solid var(--rule-soft)',
        }}
      >
        <Panel title="01 · Production & Export Share">
          <div className="flex flex-col" style={{ gap: 4 }}>
            {DONUT_STUB.map(d => (
              <div key={d.country} className="flex items-center" style={{ gap: 8 }}>
                <span style={{ width: 80, fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--ink-dim)' }}>
                  {d.country}
                </span>
                <div style={{ flex: 1, height: 5, background: 'var(--bg-raised)', border: '1px solid var(--rule)' }}>
                  <div style={{ width: `${d.share * 100}%`, height: '100%', background: 'var(--wheat)' }} />
                </div>
                <span className="num-lg" style={{ width: 40, fontSize: 10.5, color: 'var(--ink)', textAlign: 'right' }}>
                  {(d.share * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title={`02 · Price Volatility & Futures · ${selected.toUpperCase()}`}>
          <Sparkline values={priceSeries} width={420} height={120} stroke="var(--wheat)" fill="rgba(212, 162, 76, 0.14)" />
          <div className="flex items-baseline justify-between" style={{ marginTop: 8 }}>
            <span className="eyebrow">Spot · 60-day</span>
            <span className="num-lg" style={{ fontSize: 18, color: 'var(--wheat)' }}>
              ${priceSeries.at(-1)?.toFixed(2)}
            </span>
          </div>
        </Panel>

        <Panel title="03 · Chokepoint Exposure">
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontFamily: 'var(--f-mono)', fontSize: 11 }}>
            <li className="flex items-center justify-between" style={{ padding: '4px 0', borderBottom: '1px solid var(--rule-soft)' }}>
              <span style={{ color: 'var(--ink-dim)' }}>Hormuz</span>
              <span style={{ color: 'var(--wheat)' }}>73%</span>
            </li>
            <li className="flex items-center justify-between" style={{ padding: '4px 0', borderBottom: '1px solid var(--rule-soft)' }}>
              <span style={{ color: 'var(--ink-dim)' }}>Bab-el-Mandeb</span>
              <span style={{ color: 'var(--wheat)' }}>24%</span>
            </li>
            <li className="flex items-center justify-between" style={{ padding: '4px 0', borderBottom: '1px solid var(--rule-soft)' }}>
              <span style={{ color: 'var(--ink-dim)' }}>Malacca</span>
              <span style={{ color: 'var(--wheat)' }}>41%</span>
            </li>
            <li className="flex items-center justify-between" style={{ padding: '4px 0', borderBottom: '1px solid var(--rule-soft)' }}>
              <span style={{ color: 'var(--ink-dim)' }}>Suez</span>
              <span style={{ color: 'var(--wheat)' }}>18%</span>
            </li>
          </ul>
        </Panel>

        <Panel title="04 · Top Exporters & Sanction Risk">
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontFamily: 'var(--f-mono)', fontSize: 11 }}>
            {RISK_EXPORTERS.map(r => (
              <li key={r.country} className="flex items-center justify-between" style={{ padding: '5px 0', borderBottom: '1px solid var(--rule-soft)' }}>
                <span style={{ color: 'var(--ink)' }}>{r.country}</span>
                <span
                  style={{
                    padding: '1px 6px',
                    background: r.band === 'red' ? 'var(--red)' : r.band === 'amber' ? 'var(--amber)' : 'var(--green)',
                    color: 'var(--bg-void)',
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    fontSize: 9.5,
                  }}
                >
                  {r.band}
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="05 · Trade-Flow Horizon · 72h" span={2}>
          <p style={{ fontSize: 12, color: 'var(--ink-dim)', lineHeight: 1.5 }}>
            72-h disruption ribbon: probability-weighted corridor risk for the next three days. Feature 4.
          </p>
          <div className="flex" style={{ gap: 1, marginTop: 10, background: 'var(--rule-soft)', border: '1px solid var(--rule-soft)' }}>
            {[0.12, 0.22, 0.38, 0.55, 0.62, 0.48, 0.28].map((v, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  padding: 8,
                  background: 'var(--bg-panel)',
                  color: 'var(--ink)',
                  fontFamily: 'var(--f-mono)',
                  fontSize: 10.5,
                  borderBottom: `3px solid ${v >= 0.5 ? 'var(--red)' : v >= 0.3 ? 'var(--amber)' : 'var(--green)'}`,
                  textAlign: 'center',
                }}
              >
                <div className="eyebrow" style={{ marginBottom: 4 }}>T+{i * 12}h</div>
                <div className="num-lg" style={{ fontSize: 14 }}>{(v * 100).toFixed(0)}%</div>
              </div>
            ))}
          </div>
        </Panel>

        {isEnergy && (
          <Panel title="06 · Energy Stress 72h">
            <p style={{ fontSize: 12, color: 'var(--ink-dim)', lineHeight: 1.5 }}>
              Cross-border flow stress for the selected energy commodity. Feature 6.
            </p>
            <div className="flex items-baseline" style={{ gap: 6, marginTop: 10 }}>
              <span className="num-lg" style={{ fontSize: 28, color: 'var(--red)' }}>62%</span>
              <span className="eyebrow">peak stress</span>
            </div>
          </Panel>
        )}
      </div>

      <div
        className="flex items-center"
        style={{ gap: 8, padding: 10, background: 'var(--bg-panel)', border: '1px solid var(--rule-soft)' }}
      >
        <button style={footerBtn}>◆ Export PDF + JSON</button>
        <button style={footerBtn}>Draft {persona === 'day-trader' ? 'trade memo' : persona === 'journalist' ? 'lead brief' : 'commodities memo'}</button>
        <button style={footerBtn}>Compliance review</button>
      </div>
    </div>
  );
}

const DONUT_STUB = [
  { country: 'Russia',    share: 0.18 },
  { country: 'USA',       share: 0.14 },
  { country: 'Canada',    share: 0.11 },
  { country: 'Australia', share: 0.10 },
  { country: 'Ukraine',   share: 0.08 },
  { country: 'France',    share: 0.06 },
];

const RISK_EXPORTERS = [
  { country: 'Russia',   band: 'red' },
  { country: 'Iran',     band: 'red' },
  { country: 'Venezuela',band: 'amber' },
  { country: 'Libya',    band: 'amber' },
  { country: 'Nigeria',  band: 'amber' },
  { country: 'Norway',   band: 'green' },
  { country: 'Canada',   band: 'green' },
];

function Panel({ title, children, span = 1 }: { title: string; children: React.ReactNode; span?: number }) {
  return (
    <section
      style={{
        gridColumn: span === 2 ? 'span 2' : span === 3 ? 'span 3' : undefined,
        background: 'var(--bg-navy)',
        padding: 14,
      }}
    >
      <h3 className="panel-title" style={{ marginBottom: 10 }}>
        <span className="idx">{title.split(' · ')[0]}</span>
        {title.split(' · ').slice(1).join(' · ')}
      </h3>
      {children}
    </section>
  );
}

const footerBtn: React.CSSProperties = {
  padding: '6px 10px',
  fontFamily: 'var(--f-mono)',
  fontSize: 10.5,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  background: 'var(--bg-raised)',
  color: 'var(--ink)',
  border: '1px solid var(--rule)',
  borderRadius: 2,
  cursor: 'pointer',
};
