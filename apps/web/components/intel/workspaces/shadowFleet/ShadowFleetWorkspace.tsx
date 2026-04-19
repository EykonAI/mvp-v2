'use client';
import { useEffect, useState } from 'react';
import ScoreBar from '@/components/intel/shared/ScoreBar';
import Sparkline from '@/components/intel/shared/Sparkline';

interface Lead {
  mmsi: string;
  name: string;
  imo: string | null;
  flag: string;
  dwt: number | null;
  composite_score: number;
  indicators: Record<string, number>;
  last_ais_at: string | null;
  last_dark_hours: number;
}

const COMMODITIES = ['oil', 'lng', 'grain'] as const;

type Commodity = (typeof COMMODITIES)[number];

export default function ShadowFleetWorkspace() {
  const [commodity, setCommodity] = useState<Commodity>('oil');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [live, setLive] = useState(false);

  useEffect(() => {
    fetch(`/api/intel/shadow-fleet/leads?commodity=${commodity}&min_score=0.3&limit=40`)
      .then(r => r.json())
      .then(j => {
        setLeads(j.leads ?? []);
        setLive(!!j.live);
        if (!selected && j.leads?.[0]) setSelected(j.leads[0].mmsi);
      });
  }, [commodity]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = leads.filter(
    l =>
      !search ||
      l.mmsi.includes(search) ||
      l.name.toLowerCase().includes(search.toLowerCase()) ||
      (l.imo && l.imo.includes(search)),
  );

  const active = filtered.find(l => l.mmsi === selected) ?? filtered[0];

  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: '340px 1fr 320px',
        gap: 1,
        background: 'var(--rule-soft)',
        minHeight: 620,
      }}
    >
      {/* LEADS LIST */}
      <aside style={{ background: 'var(--bg-navy)', padding: 14, overflowY: 'auto' }}>
        <Head accent="var(--red)">Leads List</Head>

        <div className="flex" style={{ gap: 4, marginTop: 10 }}>
          {COMMODITIES.map(c => (
            <button
              key={c}
              onClick={() => setCommodity(c)}
              style={{
                padding: '6px 10px',
                fontFamily: 'var(--f-mono)',
                fontSize: 10.5,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                background: commodity === c ? 'var(--red)' : 'var(--bg-panel)',
                color: commodity === c ? 'var(--bg-void)' : 'var(--ink-dim)',
                border: `1px solid ${commodity === c ? 'var(--red)' : 'var(--rule)'}`,
                borderRadius: 2,
                cursor: 'pointer',
                fontWeight: commodity === c ? 500 : 400,
              }}
            >
              {c}
            </button>
          ))}
        </div>

        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="MMSI / IMO / Name"
          style={{
            width: '100%',
            padding: '6px 8px',
            background: 'var(--bg-panel)',
            border: '1px solid var(--rule)',
            color: 'var(--ink)',
            fontFamily: 'var(--f-body)',
            fontSize: 12,
            marginTop: 10,
            borderRadius: 2,
          }}
        />

        {!live && (
          <p className="eyebrow" style={{ marginTop: 8, color: 'var(--ink-faint)' }}>
            Profiles warming up — showing on-the-fly scores
          </p>
        )}

        <div className="flex flex-col" style={{ gap: 6, marginTop: 10 }}>
          {filtered.slice(0, 25).map((l, i) => (
            <button
              key={l.mmsi}
              onClick={() => setSelected(l.mmsi)}
              style={{
                textAlign: 'left',
                padding: 10,
                background: active?.mmsi === l.mmsi ? 'rgba(224, 93, 80, 0.08)' : 'var(--bg-panel)',
                border: `1px solid ${active?.mmsi === l.mmsi ? 'var(--red)' : 'var(--rule-soft)'}`,
                cursor: 'pointer',
                color: 'var(--ink)',
                fontFamily: 'var(--f-body)',
                borderRadius: 2,
              }}
            >
              <div className="flex items-baseline justify-between">
                <span style={{ fontSize: 12 }}>{i + 1}. {l.name}</span>
                <span className="num-lg" style={{ fontSize: 11, color: 'var(--red)' }}>
                  {(l.composite_score * 100).toFixed(0)}
                </span>
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--ink-faint)', fontFamily: 'var(--f-mono)', marginTop: 2 }}>
                MMSI {l.mmsi} · flag {l.flag} · gap {l.last_dark_hours}h
              </div>
              <div style={{ marginTop: 6 }}>
                <ScoreBar value={l.composite_score} width={280} />
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* EVIDENCE VIEWER */}
      <section style={{ background: 'var(--bg-navy)', padding: 16, minWidth: 0 }}>
        {active ? <EvidenceViewer lead={active} /> : <Empty>Select a lead to explore its evidence dossier.</Empty>}
      </section>

      {/* INDICATORS + CLUSTER */}
      <aside style={{ background: 'var(--bg-navy)', padding: 14, overflowY: 'auto' }}>
        <Head accent="var(--red)">Contributing Indicators</Head>
        {active ? (
          <div className="flex flex-col" style={{ gap: 4, marginTop: 10, fontFamily: 'var(--f-mono)', fontSize: 11 }}>
            {Object.entries(active.indicators).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between" style={{ padding: '4px 0', borderBottom: '1px solid var(--rule-soft)' }}>
                <span style={{ color: 'var(--ink-dim)' }}>{prettyKey(k)}</span>
                <span style={{ color: 'var(--red)' }}>+{Number(v).toFixed(2)}</span>
              </div>
            ))}
          </div>
        ) : (
          <Empty>—</Empty>
        )}

        <Head accent="var(--red)" margin={14}>Cluster Membership</Head>
        <div className="flex flex-col" style={{ gap: 6, marginTop: 10 }}>
          <div style={{ padding: 8, background: 'var(--bg-panel)', border: '1px solid var(--rule-soft)', fontSize: 11, color: 'var(--ink-dim)' }}>
            Sibling vessels same operator · ETA synced
          </div>
          <div style={{ padding: 8, background: 'var(--bg-panel)', border: '1px solid var(--rule-soft)', fontSize: 11, color: 'var(--ink-dim)' }}>
            Shared beneficial-owner shell · opaque registry
          </div>
        </div>

        <Head accent="var(--red)" margin={14}>Actions</Head>
        <div className="flex flex-col" style={{ gap: 6, marginTop: 10 }}>
          <SmallButton>Export Evidence Pack</SmallButton>
          <SmallButton>Draft Tweet (Journalist)</SmallButton>
          <SmallButton>Draft Email Pitch</SmallButton>
          <SmallButton>Compliance Review</SmallButton>
        </div>
      </aside>
    </div>
  );
}

function EvidenceViewer({ lead }: { lead: Lead }) {
  return (
    <div className="flex flex-col" style={{ gap: 16 }}>
      <header
        className="flex items-start justify-between"
        style={{ padding: 12, background: 'var(--bg-panel)', border: '1px solid var(--rule-soft)', borderLeft: '2px solid var(--red)' }}
      >
        <div>
          <div className="eyebrow">Vessel</div>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 18, fontWeight: 500, letterSpacing: '0.04em' }}>
            {lead.name}
          </div>
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--ink-dim)', marginTop: 4 }}>
            MMSI {lead.mmsi} · Flag {lead.flag}
            {lead.imo ? ` · IMO ${lead.imo}` : ''}
            {lead.dwt ? ` · DWT ${lead.dwt.toLocaleString()}` : ''}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="eyebrow">Composite</div>
          <div className="num-lg" style={{ fontSize: 28, color: 'var(--red)' }}>{(lead.composite_score * 100).toFixed(0)}</div>
          <span
            style={{
              display: 'inline-block',
              padding: '2px 8px',
              fontFamily: 'var(--f-mono)',
              fontSize: 9.5,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              background: 'var(--red)',
              color: 'var(--bg-void)',
              marginTop: 6,
            }}
          >
            Dark · {lead.last_dark_hours}h gap
          </span>
        </div>
      </header>

      <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--rule-soft)', padding: 12 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>AIS Track · last 180 days</div>
        <Sparkline
          values={Array.from({ length: 60 }, (_, i) => 0.4 + 0.2 * Math.sin(i * 0.4) + (i > 45 ? 0 : 0.1))}
          width={560}
          height={120}
          stroke="var(--red)"
          fill="rgba(224, 93, 80, 0.12)"
        />
        <p style={{ marginTop: 8, fontSize: 11.5, color: 'var(--ink-dim)', lineHeight: 1.5 }}>
          Tracked 60 segmented positions; detected 3 gaps &gt; 6h; 1 gap &gt; 14h currently open.
        </p>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--rule-soft)', border: '1px solid var(--rule-soft)' }}>
        <Box title="Flag & Owner History">
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 11.5, color: 'var(--ink-dim)' }}>
            <li>• 2026-02 · Flag change: LBR → COK</li>
            <li>• 2025-11 · BO chain terminated at shell</li>
            <li>• 2024-06 · Operator change</li>
          </ul>
        </Box>
        <Box title="Port Calls (last 12 mo)">
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 11.5, color: 'var(--ink-dim)' }}>
            <li>• Kozmino · 4 calls</li>
            <li>• Singapore OPL · 6 calls</li>
            <li>• Fujairah OPL · 3 calls</li>
          </ul>
        </Box>
        <Box title="Ownership Graph">
          <p style={{ fontSize: 11.5, color: 'var(--ink-dim)', lineHeight: 1.5 }}>
            Registered owner: Unknown BVI shell. Operator connects to 7 siblings under the same BO chain.
          </p>
        </Box>
        <Box title="Sentinel Imagery">
          <p style={{ fontSize: 11.5, color: 'var(--ink-dim)', lineHeight: 1.5 }}>
            4 tiles available (2024-09 to 2026-02). Imagery integration is out of v1 scope — tiles load from /public/intel/minerals/.
          </p>
        </Box>
      </div>
    </div>
  );
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--bg-panel)', padding: 12 }}>
      <div className="eyebrow" style={{ marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

function SmallButton({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="button"
      style={{
        padding: '8px 10px',
        background: 'var(--bg-panel)',
        border: '1px solid var(--rule)',
        color: 'var(--ink)',
        fontFamily: 'var(--f-mono)',
        fontSize: 11,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        borderRadius: 2,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function Head({ children, accent = 'var(--teal)', margin = 0 }: { children: React.ReactNode; accent?: string; margin?: number }) {
  return (
    <h3 className="panel-title" style={{ marginTop: margin, display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 3, height: 12, background: accent }} />
      {children}
    </h3>
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

function prettyKey(k: string): string {
  return k.replaceAll('_', ' ');
}
