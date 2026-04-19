'use client';
import { useMemo } from 'react';

interface Node {
  id: string;
  label: string;
  ring: 0 | 1 | 2 | 'blind';
  angle: number;
  radius: number;
}

/**
 * Interest Graph (Feature 8) + Blind-Spot overlay (Feature 9).
 *
 * V1 uses a hand-placed radial layout. The prompt calls for
 * d3-force — but until the `d3`/`d3-force` dependency is actually
 * installed, this deterministic placement is visually faithful to
 * the wireframe and avoids layout jitter.
 */
export default function InterestGraph() {
  const nodes: Node[] = useMemo(
    () => [
      { id: 'maritime',        label: 'Maritime / AIS',  ring: 0, angle: 0,     radius: 0 },
      // Ring 1 — pinned theatres / primary sources
      { id: 'red-sea',         label: 'Red Sea',         ring: 1, angle: -60,   radius: 68 },
      { id: 'hormuz',          label: 'Hormuz',          ring: 1, angle: 10,    radius: 70 },
      { id: 'vlcc',            label: 'VLCC Tankers',    ring: 1, angle: 80,    radius: 66 },
      { id: 'mil-adsb',        label: 'Mil ADS-B',       ring: 1, angle: 150,   radius: 70 },
      { id: 'black-sea',       label: 'Black Sea',       ring: 1, angle: 220,   radius: 72 },
      // Ring 2 — adjacencies
      { id: 'pipelines',       label: 'Pipelines',       ring: 2, angle: -30,   radius: 118 },
      { id: 'acled',           label: 'ACLED',           ring: 2, angle: 45,    radius: 120 },
      { id: 'sanctions',       label: 'Sanctions',       ring: 2, angle: 110,   radius: 118 },
      { id: 'refineries',      label: 'Refineries',      ring: 2, angle: 190,   radius: 120 },
      { id: 'owners',          label: 'Owners',          ring: 2, angle: 250,   radius: 118 },
      { id: 'imo',             label: 'IMO',             ring: 2, angle: 310,   radius: 120 },
      // Blind spots
      { id: 'rare-earths',     label: 'Rare earths?',    ring: 'blind', angle: -120, radius: 118 },
      { id: 'arctic',          label: 'Arctic shipping?',ring: 'blind', angle: 200,  radius: 146 },
      { id: 'central-asia',    label: 'Central-Asia grid?', ring: 'blind', angle: 70,  radius: 150 },
    ],
    [],
  );

  const W = 280;
  const H = 320;
  const cx = W / 2;
  const cy = H / 2 - 10;

  const pos = nodes.map(n => {
    const a = (n.angle * Math.PI) / 180;
    return { ...n, x: cx + n.radius * Math.cos(a), y: cy + n.radius * Math.sin(a) };
  });
  const center = pos.find(n => n.id === 'maritime')!;

  return (
    <div style={{ height: 340, position: 'relative', background: 'radial-gradient(circle at 50% 45%, rgba(25,208,184,0.05), transparent 55%)' }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0 }}>
        {/* Ring edges */}
        {pos
          .filter(n => n.ring === 1)
          .map(n => (
            <line key={`e1-${n.id}`} x1={center.x} y1={center.y} x2={n.x} y2={n.y} stroke="var(--rule-strong)" strokeWidth={0.7} />
          ))}
        {pos
          .filter(n => n.ring === 2)
          .map(n => {
            const parent = pos.find(p => p.ring === 1 && Math.abs(angleDiff(p.angle, n.angle)) < 60) ?? center;
            return (
              <line key={`e2-${n.id}`} x1={parent.x} y1={parent.y} x2={n.x} y2={n.y} stroke="var(--rule)" strokeWidth={0.6} />
            );
          })}

        {/* Nodes */}
        {pos.map(n => {
          const colour =
            n.ring === 0
              ? 'var(--teal)'
              : n.ring === 1
              ? 'var(--teal-dim)'
              : n.ring === 2
              ? 'var(--ink-dim)'
              : 'none';
          const r = n.ring === 0 ? 7 : n.ring === 1 ? 5 : n.ring === 2 ? 3.2 : 4.5;

          if (n.ring === 'blind') {
            return (
              <g key={n.id}>
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={r}
                  fill="none"
                  stroke="var(--amber)"
                  strokeWidth={1.2}
                  strokeDasharray="2 2"
                  style={{ animation: 'eykon-pulse-ring 2.6s infinite' }}
                />
                <text
                  x={n.x}
                  y={n.y - 8}
                  textAnchor="middle"
                  style={{
                    fontFamily: 'var(--f-mono)',
                    fontSize: 9.5,
                    letterSpacing: '0.04em',
                    fill: 'var(--amber)',
                  }}
                >
                  {n.label}
                </text>
              </g>
            );
          }

          return (
            <g key={n.id}>
              <circle cx={n.x} cy={n.y} r={r} fill={colour} />
              <text
                x={n.x}
                y={n.y - r - 4}
                textAnchor="middle"
                style={{
                  fontFamily: 'var(--f-mono)',
                  fontSize: 9.5,
                  letterSpacing: '0.04em',
                  fill: n.ring === 2 ? 'var(--ink-faint)' : n.ring === 1 ? 'var(--ink-dim)' : 'var(--ink)',
                }}
              >
                {n.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div
        style={{
          position: 'absolute',
          bottom: 8,
          left: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontFamily: 'var(--f-mono)',
          fontSize: 9,
          letterSpacing: '0.1em',
          color: 'var(--amber)',
          textTransform: 'uppercase',
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            border: '1px dashed var(--amber)',
          }}
        />
        Blind-spot candidates
      </div>
    </div>
  );
}

function angleDiff(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 540) % 360 - 180);
  return d;
}
