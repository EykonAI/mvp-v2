'use client';
import { useEffect, useState } from 'react';
import ScoreBar from '@/components/intel/shared/ScoreBar';

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

interface Evidence {
  mmsi?: string;
  data_clock?: string | null;
  feed_lag_minutes?: number | null;
  identity?: {
    name: string | null;
    imo: string | null;
    flag: string | null;
    foc: boolean;
    dwt: number | null;
    built_year: number | null;
  };
  telemetry?: {
    destination: string | null;
    speed: number | null;
    heading: number | null;
    nav_status: number | null;
    nav_status_label: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  contact?: {
    last_contact_at: string | null;
    hours_since_contact: number | null;
    dark_gap_open: boolean;
    last_dark_at: string | null;
    last_ais_at: string | null;
  };
  score?: {
    composite_score: number | null;
    indicators: Record<string, number> | null;
  };
  error?: string;
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
          <div style={{ padding: 8, background: 'var(--bg-panel)', border: '1px dashed var(--rule)', fontSize: 11, color: 'var(--ink-faint)' }}>
            Kinship clustering awaits entities / fleet_kinship_edges population — no linkages recorded yet.
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
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setEvidence(null);
    fetch(`/api/intel/shadow-fleet/evidence?mmsi=${encodeURIComponent(lead.mmsi)}`)
      .then(r => r.json())
      .then(j => {
        if (cancelled) return;
        setEvidence(j ?? { error: 'empty response' });
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setEvidence({ error: 'request failed' });
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lead.mmsi]);

  const identity = evidence?.identity;
  const telemetry = evidence?.telemetry;
  const contact = evidence?.contact;
  const gapOpen = contact?.dark_gap_open ?? false;
  const feedLag = evidence?.feed_lag_minutes ?? null;
  const feedStalled = feedLag !== null && feedLag > 30;
  const gapHours =
    contact?.hours_since_contact !== null && contact?.hours_since_contact !== undefined
      ? Math.round(contact.hours_since_contact)
      : lead.last_dark_hours;

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
            {identity?.foc ? ' (FOC)' : ''}
            {lead.imo ? ` · IMO ${lead.imo}` : ''}
            {lead.dwt ? ` · DWT ${lead.dwt.toLocaleString()}` : ''}
            {identity?.built_year ? ` · Built ${identity.built_year}` : ''}
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
              background: gapOpen ? 'var(--red)' : 'var(--bg-navy)',
              color: gapOpen ? 'var(--bg-void)' : 'var(--ink-dim)',
              border: gapOpen ? 'none' : '1px solid var(--rule)',
              marginTop: 6,
            }}
          >
            {gapOpen ? `Dark · ${gapHours}h gap` : 'AIS current'}
          </span>
        </div>
      </header>

      <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--rule-soft)', padding: 12 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Live Telemetry · current AIS snapshot</div>
        {feedStalled && (
          <div
            style={{
              display: 'inline-block',
              padding: '3px 8px',
              marginBottom: 8,
              fontFamily: 'var(--f-mono)',
              fontSize: 9.5,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: 'var(--amber)',
              border: '1px solid var(--amber)',
              borderRadius: 2,
            }}
          >
            AIS FEED STALLED · {feedLag} min behind
          </div>
        )}
        {loading ? (
          <p style={{ fontSize: 11.5, color: 'var(--ink-faint)', fontFamily: 'var(--f-mono)', letterSpacing: '0.08em' }}>
            Fetching live vessel record…
          </p>
        ) : evidence?.error || !contact ? (
          <p style={{ fontSize: 11.5, color: 'var(--ink-faint)', lineHeight: 1.5 }}>
            Live telemetry unavailable{evidence?.error ? ` — ${evidence.error}` : ''}. No fabricated track is shown in its place.
          </p>
        ) : (
          <>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--rule-soft)', border: '1px solid var(--rule-soft)' }}>
              <Fact
                label="Last AIS contact"
                value={
                  contact.hours_since_contact !== null
                    ? `${contact.hours_since_contact} h ${feedStalled ? 'before last feed tick' : 'ago'}`
                    : '—'
                }
                sub={contact.last_contact_at ? fmtUtc(contact.last_contact_at) : undefined}
              />
              <Fact
                label="Dark-gap status"
                value={
                  gapOpen
                    ? `OPEN · > 6 h silent${feedStalled ? ' vs last feed tick' : ''}`
                    : 'No open gap'
                }
                accent={gapOpen}
              />
              <Fact
                label="Last dark episode"
                value={contact.last_dark_at ? fmtUtc(contact.last_dark_at) : 'None recorded'}
              />
              <Fact
                label="Destination (self-reported)"
                value={telemetry?.destination || '—'}
              />
              <Fact
                label="Speed / Heading"
                value={`${telemetry?.speed ?? '—'} kn · ${telemetry?.heading ?? '—'}°`}
              />
              <Fact
                label="Nav status"
                value={telemetry?.nav_status_label ?? '—'}
              />
              <Fact
                label="Position"
                value={
                  telemetry?.latitude != null && telemetry?.longitude != null
                    ? `${Number(telemetry.latitude).toFixed(3)}, ${Number(telemetry.longitude).toFixed(3)}`
                    : '—'
                }
              />
              <Fact
                label="Registry"
                value={identity?.flag ? `${identity.flag}${identity.foc ? ' · flag of convenience' : ''}` : '—'}
              />
            </div>
            <p style={{ marginTop: 8, fontSize: 10.5, color: 'var(--ink-faint)', lineHeight: 1.5 }}>
              Single current-position snapshot from the live AIS feed. Historical track reconstruction requires AIS retention, which is not yet stored.
            </p>
          </>
        )}
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--rule-soft)', border: '1px solid var(--rule-soft)' }}>
        <Box title="Flag & Owner History">
          <Pending>Registry history not yet integrated.</Pending>
        </Box>
        <Box title="Port Calls (last 12 mo)">
          <Pending>Port-call history requires AIS retention — not yet stored.</Pending>
        </Box>
        <Box title="Ownership Graph">
          <Pending>Ownership graph awaits entities / fleet_kinship_edges population.</Pending>
        </Box>
        <Box title="Sentinel Imagery">
          <Pending>Satellite imagery not yet integrated.</Pending>
        </Box>
      </div>
    </div>
  );
}

function Fact({ label, value, sub, accent = false }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div style={{ background: 'var(--bg-panel)', padding: '8px 10px' }}>
      <div className="eyebrow" style={{ fontSize: 9 }}>{label}</div>
      <div style={{ fontFamily: 'var(--f-mono)', fontSize: 12, marginTop: 2, color: accent ? 'var(--red)' : 'var(--ink)' }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--ink-faint)', marginTop: 2 }}>{sub}</div>
      )}
    </div>
  );
}

function Pending({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 11.5, color: 'var(--ink-faint)', lineHeight: 1.5, fontStyle: 'italic', margin: 0 }}>
      {children}
    </p>
  );
}

function fmtUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
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
