'use client';
import { useEffect, useState } from 'react';
import Sparkline from '@/components/intel/shared/Sparkline';
import posture from '@/lib/fixtures/posture_seed.json';

const EVENT_TYPES = [
  { slug: 'state_mobilisation',      label: 'State mobilisation' },
  { slug: 'energy_crisis',           label: 'Regional energy crisis' },
  { slug: 'shadow_fleet_activation', label: 'Shadow-fleet activation' },
  { slug: 'capital_flight',          label: 'Currency-crisis capital flight' },
];

interface Match {
  id: string;
  event_type: string;
  label: string;
  window_start: string;
  window_end: string;
  similarity: number;
}

export default function PrecursorAnalogsWorkspace() {
  const [eventType, setEventType] = useState(EVENT_TYPES[0].slug);
  const [theatreSlug, setTheatreSlug] = useState('black-sea');
  const [matches, setMatches] = useState<Match[]>([]);
  const [source, setSource] = useState<'db' | 'fixture' | null>(null);

  useEffect(() => {
    fetch('/api/intel/precursor/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theatre_slug: theatreSlug, event_type: eventType, top_k: 8 }),
    })
      .then(r => r.json())
      .then(j => {
        setMatches(j.matches ?? []);
        setSource(j.source ?? null);
      });
  }, [eventType, theatreSlug]);

  const theatre = posture.theatres.find(t => t.slug === theatreSlug);
  const currentSeries = theatre?.last_30d_composite ?? [];

  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: '300px 1fr 320px',
        gap: 1,
        background: 'var(--rule-soft)',
        minHeight: 620,
      }}
    >
      <aside style={{ background: 'var(--bg-navy)', padding: 14 }}>
        <Head accent="var(--teal)">Event Type</Head>
        <div className="flex flex-col" style={{ gap: 4, marginTop: 10 }}>
          {EVENT_TYPES.map(t => (
            <button
              key={t.slug}
              onClick={() => setEventType(t.slug)}
              style={{
                textAlign: 'left',
                padding: '8px 10px',
                background: eventType === t.slug ? 'rgba(25,208,184,0.08)' : 'var(--bg-panel)',
                border: `1px solid ${eventType === t.slug ? 'var(--teal)' : 'var(--rule-soft)'}`,
                color: eventType === t.slug ? 'var(--ink)' : 'var(--ink-dim)',
                fontSize: 12,
                cursor: 'pointer',
                borderRadius: 2,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <Head accent="var(--teal)" margin={14}>Theatre</Head>
        <div className="flex flex-col" style={{ gap: 4, marginTop: 10 }}>
          {posture.theatres.map(t => (
            <button
              key={t.slug}
              onClick={() => setTheatreSlug(t.slug)}
              style={{
                textAlign: 'left',
                padding: '6px 10px',
                background: theatreSlug === t.slug ? 'rgba(25,208,184,0.08)' : 'transparent',
                border: `1px solid ${theatreSlug === t.slug ? 'var(--teal)' : 'var(--rule-soft)'}`,
                color: theatreSlug === t.slug ? 'var(--ink)' : 'var(--ink-dim)',
                fontFamily: 'var(--f-mono)',
                fontSize: 11,
                cursor: 'pointer',
                borderRadius: 2,
              }}
            >
              {t.label} · {t.composite.toFixed(2)}
            </button>
          ))}
        </div>
      </aside>

      <section style={{ background: 'var(--bg-navy)', padding: 16 }}>
        <Head accent="var(--teal)">Current theatre · {theatre?.label}</Head>
        <div style={{ background: 'var(--bg-panel)', padding: 14, border: '1px solid var(--rule-soft)', marginTop: 10 }}>
          <Sparkline values={currentSeries} width={600} height={100} stroke="var(--teal)" fill="rgba(25, 208, 184, 0.14)" min={0} max={1} />
          <p style={{ fontSize: 11.5, color: 'var(--ink-dim)', marginTop: 8 }}>
            30-day composite trajectory. Current value: {theatre?.composite.toFixed(2)}.
          </p>
        </div>

        <Head accent="var(--teal)" margin={14}>Top matches</Head>
        <div className="flex flex-col" style={{ gap: 6, marginTop: 10 }}>
          {matches.map(m => (
            <div
              key={m.id}
              style={{
                padding: 12,
                background: 'var(--bg-panel)',
                border: '1px solid var(--rule-soft)',
                borderLeft: m.similarity >= 0.85 ? '2px solid var(--red)' : m.similarity >= 0.7 ? '2px solid var(--amber)' : '2px solid var(--teal-dim)',
              }}
            >
              <div className="flex items-baseline justify-between">
                <span style={{ fontFamily: 'var(--f-display)', fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
                  {m.label}
                </span>
                <span className="num-lg" style={{ fontSize: 14, color: m.similarity >= 0.85 ? 'var(--red)' : m.similarity >= 0.7 ? 'var(--amber)' : 'var(--teal)' }}>
                  {(m.similarity * 100).toFixed(1)}%
                </span>
              </div>
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 4, letterSpacing: '0.06em' }}>
                {m.window_start} — {m.window_end} · {m.event_type.replaceAll('_', ' ')}
              </div>
            </div>
          ))}
        </div>
      </section>

      <aside style={{ background: 'var(--bg-navy)', padding: 14 }}>
        <Head accent="var(--teal)">Notes</Head>
        <p style={{ fontSize: 11.5, color: 'var(--ink-dim)', lineHeight: 1.55, marginTop: 8 }}>
          Similarity is cosine against the library vectors.{' '}
          {source === 'db'
            ? 'Library loaded from Supabase — pgvector will replace this JS cosine when the extension is enabled.'
            : 'Library loaded from fixture JSON — run db:seed to load the library into Supabase.'}
        </p>
        <p style={{ fontSize: 11.5, color: 'var(--ink-dim)', lineHeight: 1.55, marginTop: 10 }}>
          Thresholds: <span style={{ color: 'var(--red)' }}>≥ 0.85 alert</span> · <span style={{ color: 'var(--amber)' }}>≥ 0.7 watch</span>.
        </p>
      </aside>
    </div>
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
