'use client';
import { useEffect, useState } from 'react';
import Glyph5Segment from '@/components/intel/shared/Glyph5Segment';
import Sparkline from '@/components/intel/shared/Sparkline';
import ScoreBar from '@/components/intel/shared/ScoreBar';

type Mode = 'globe' | 'mercator' | 'grid';

interface Theatre {
  slug: string;
  label: string;
  composite: number;
  trend?: 'up' | 'down' | 'flat';
  air: number;
  sea: number;
  conflict: number;
  grid: number;
  imagery: number;
  precursor_match_id?: string | null;
  precursor_similarity?: number | null;
  last_30d_composite?: number[];
  bbox?: { lat_min: number; lat_max: number; lon_min: number; lon_max: number };
}

/** Approximate mercator projection mapping bbox centroids onto a 0..1 grid. */
function project(bbox: Theatre['bbox']): { x: number; y: number } | null {
  if (!bbox) return null;
  const cLat = (bbox.lat_min + bbox.lat_max) / 2;
  const cLon = (bbox.lon_min + bbox.lon_max) / 2;
  return {
    x: (cLon + 180) / 360,
    y: 1 - (cLat + 90) / 180,
  };
}

export default function PostureViewport() {
  const [theatres, setTheatres] = useState<Theatre[]>([]);
  const [mode, setMode] = useState<Mode>('globe');
  const [selected, setSelected] = useState<string | null>('black-sea');

  useEffect(() => {
    fetch('/api/intel/posture')
      .then(r => (r.ok ? r.json() : null))
      .then((j: { theatres: Theatre[] } | null) => j && setTheatres(j.theatres))
      .catch(() => setTheatres([]));
  }, []);

  const active = theatres.find(t => t.slug === selected) ?? theatres[0];

  return (
    <div className="flex flex-col" style={{ gap: 12 }}>
      {/* Mode toggle */}
      <div className="flex items-center justify-between">
        <div
          className="flex"
          style={{
            background: 'var(--bg-panel)',
            border: '1px solid var(--rule)',
            borderRadius: 2,
            padding: 2,
          }}
        >
          {(['globe', 'mercator', 'grid'] as Mode[]).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 10.5,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                padding: '5px 12px',
                background: mode === m ? 'var(--teal)' : 'transparent',
                color: mode === m ? 'var(--bg-void)' : 'var(--ink-dim)',
                border: 0,
                borderRadius: 2,
                cursor: 'pointer',
                fontWeight: mode === m ? 500 : 400,
              }}
            >
              {m === 'globe' ? 'Globe' : m === 'mercator' ? 'Mercator' : 'Theatre Grid'}
            </button>
          ))}
        </div>
        <span className="eyebrow" style={{ color: 'var(--ink-faint)' }}>
          {theatres.length} theatres pinned
        </span>
      </div>

      {/* Map area */}
      {mode !== 'grid' ? (
        <StylizedMap theatres={theatres} mode={mode} selected={selected} onSelect={setSelected} />
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, padding: 14 }}>
          {theatres.map(t => (
            <button
              key={t.slug}
              onClick={() => setSelected(t.slug)}
              className="flex flex-col items-center"
              style={{
                padding: 14,
                background: 'var(--bg-panel)',
                border: `1px solid ${selected === t.slug ? 'var(--teal)' : 'var(--rule)'}`,
                cursor: 'pointer',
                gap: 6,
              }}
            >
              <Glyph5Segment
                composite={t.composite}
                air={t.air}
                sea={t.sea}
                conflict={t.conflict}
                grid={t.grid}
                imagery={t.imagery}
                precursorMatch={(t.precursor_similarity ?? 0) >= 0.85}
                active={selected === t.slug}
                size={96}
                label={t.label}
              />
            </button>
          ))}
        </div>
      )}

      {/* Decompose */}
      {active && <PostureDecompose theatre={active} />}
    </div>
  );
}

function StylizedMap({
  theatres,
  mode,
  selected,
  onSelect,
}: {
  theatres: Theatre[];
  mode: Mode;
  selected: string | null;
  onSelect: (slug: string) => void;
}) {
  const W = 760;
  const H = 360;

  return (
    <div style={{ position: 'relative', background: 'var(--bg-panel)', border: '1px solid var(--rule-soft)' }}>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        {/* Stylised continents — simple polygons inspired by the wireframe */}
        <g opacity={0.18}>
          <path
            d="M80,180 Q130,120 210,130 Q280,100 330,160 Q310,230 260,240 Q200,260 140,240 Q100,220 80,180 Z"
            fill="var(--teal-deep)"
            stroke="var(--rule-strong)"
            strokeWidth="0.6"
          />
          <path
            d="M310,90 Q400,70 480,100 Q560,110 620,160 Q620,220 560,240 Q480,260 400,240 Q350,220 320,180 Q300,130 310,90 Z"
            fill="var(--teal-deep)"
            stroke="var(--rule-strong)"
            strokeWidth="0.6"
          />
          <path
            d="M520,210 Q600,220 680,260 Q700,300 660,330 Q600,340 560,320 Q520,280 520,210 Z"
            fill="var(--teal-deep)"
            stroke="var(--rule-strong)"
            strokeWidth="0.6"
          />
          <path
            d="M170,260 Q220,280 260,320 Q240,350 200,345 Q160,330 150,300 Q140,280 170,260 Z"
            fill="var(--teal-deep)"
            stroke="var(--rule-strong)"
            strokeWidth="0.6"
          />
        </g>

        {/* Latitude grid (mercator variant gets a denser grid) */}
        {mode === 'mercator' && (
          <g opacity={0.2}>
            {[60, 120, 180, 240, 300].map(y => (
              <line key={y} x1={0} y1={y} x2={W} y2={y} stroke="var(--rule)" strokeWidth={0.5} />
            ))}
            {[100, 200, 300, 400, 500, 600, 700].map(x => (
              <line key={x} x1={x} y1={0} x2={x} y2={H} stroke="var(--rule)" strokeWidth={0.5} />
            ))}
          </g>
        )}

        {/* Theatre glyphs */}
        {theatres.map(t => {
          const p = project(t.bbox);
          if (!p) return null;
          const x = p.x * W;
          const y = p.y * H;
          return (
            <g key={t.slug} transform={`translate(${x - 44} ${y - 44})`}>
              <foreignObject width={88} height={110} style={{ overflow: 'visible' }}>
                <button
                  onClick={() => onSelect(t.slug)}
                  style={{ background: 'transparent', border: 0, padding: 0, cursor: 'pointer' }}
                  aria-label={`Select ${t.label}`}
                >
                  <Glyph5Segment
                    composite={t.composite}
                    air={t.air}
                    sea={t.sea}
                    conflict={t.conflict}
                    grid={t.grid}
                    imagery={t.imagery}
                    precursorMatch={(t.precursor_similarity ?? 0) >= 0.85}
                    active={selected === t.slug}
                    size={88}
                    label={t.label}
                  />
                </button>
              </foreignObject>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function PostureDecompose({ theatre }: { theatre: Theatre }) {
  const segs = [
    { key: 'air',      label: 'Air',      value: theatre.air },
    { key: 'sea',      label: 'Sea',      value: theatre.sea },
    { key: 'conflict', label: 'Conflict', value: theatre.conflict },
    { key: 'grid',     label: 'Grid',     value: theatre.grid },
    { key: 'imagery',  label: 'Imagery',  value: theatre.imagery },
  ];

  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: 1,
        background: 'var(--rule-soft)',
        border: '1px solid var(--rule-soft)',
      }}
    >
      <section style={{ background: 'var(--bg-panel)', padding: 12 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>5-Domain Score</div>
        <div className="flex flex-col" style={{ gap: 6 }}>
          {segs.map(s => (
            <div key={s.key} className="flex items-center" style={{ gap: 10 }}>
              <span className="num-lg" style={{ width: 64, fontSize: 10.5, color: 'var(--ink-dim)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                {s.label}
              </span>
              <ScoreBar value={s.value} width={120} />
              <span className="num-lg" style={{ fontSize: 11, color: 'var(--ink)' }}>
                {s.value.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section style={{ background: 'var(--bg-panel)', padding: 12 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Precursor Analogs · Top 3</div>
        <div className="flex flex-col" style={{ gap: 6 }}>
          {(theatre.precursor_match_id && theatre.precursor_similarity
            ? [{ id: theatre.precursor_match_id, sim: theatre.precursor_similarity }]
            : []
          )
            .concat([
              { id: 'oct-2023-gaza', sim: 0.72 },
              { id: 'mar-2021-suez', sim: 0.58 },
            ])
            .slice(0, 3)
            .map((p, i) => (
              <div key={i} className="flex items-center justify-between" style={{ fontSize: 11 }}>
                <span style={{ color: 'var(--ink-dim)', fontFamily: 'var(--f-body)' }}>{p.id}</span>
                <span className="num-lg" style={{ color: 'var(--ink)' }}>{(p.sim as number).toFixed(2)}</span>
              </div>
            ))}
        </div>
      </section>

      <section style={{ background: 'var(--bg-panel)', padding: 12 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>30-Day Trajectory</div>
        <Sparkline
          values={theatre.last_30d_composite ?? []}
          width={260}
          height={60}
          stroke="var(--teal)"
          fill="rgba(25, 208, 184, 0.12)"
          min={0}
          max={1}
        />
        <div className="flex items-baseline justify-between" style={{ marginTop: 8 }}>
          <span className="eyebrow">Composite</span>
          <span className="num-lg" style={{ fontSize: 18, color: 'var(--ink)' }}>
            {theatre.composite.toFixed(2)}
          </span>
        </div>
      </section>
    </div>
  );
}
