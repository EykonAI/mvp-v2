interface Props {
  composite: number;
  air: number;
  sea: number;
  conflict: number;
  grid: number;
  imagery: number;
  size?: number;
  label?: string;
  active?: boolean;
  precursorMatch?: boolean;
}

/**
 * Radial 5-segment glyph. Each segment's fill intensity is the
 * domain score (0..1). The composite colour band (teal/amber/red)
 * frames the inner disc, with the composite value in tabular mono.
 */
export default function Glyph5Segment({
  composite,
  air,
  sea,
  conflict,
  grid,
  imagery,
  size = 100,
  label,
  active,
  precursorMatch,
}: Props) {
  const r = size / 2;
  const cx = r;
  const cy = r;
  const innerR = r * 0.44;

  const bandColour =
    composite < 0.5 ? 'var(--teal)' : composite < 0.75 ? 'var(--amber)' : 'var(--red)';

  const segments = [
    { key: 'air',      value: air,      start: -90, end: -18, label: 'Air' },
    { key: 'sea',      value: sea,      start: -18, end: 54,  label: 'Sea' },
    { key: 'conflict', value: conflict, start: 54,  end: 126, label: 'Conflict' },
    { key: 'grid',     value: grid,     start: 126, end: 198, label: 'Grid' },
    { key: 'imagery',  value: imagery,  start: 198, end: 270, label: 'Imagery' },
  ];

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label ? `${label}: composite ${composite.toFixed(2)}` : `composite ${composite.toFixed(2)}`}
      style={{ overflow: 'visible' }}
    >
      {/* Outer ring */}
      <circle cx={cx} cy={cy} r={r - 1} fill="none" stroke="var(--rule)" strokeWidth="1" />
      {/* Precursor pulse */}
      {precursorMatch && (
        <circle
          cx={cx}
          cy={cy}
          r={r + 3}
          fill="none"
          stroke="var(--red)"
          strokeWidth="1"
          strokeDasharray="3 2"
          style={{ animation: 'eykon-pulse-ring 2.6s infinite' }}
        />
      )}
      {/* Active ring */}
      {active && (
        <circle cx={cx} cy={cy} r={r + 1} fill="none" stroke="var(--teal)" strokeWidth="1.5" />
      )}

      {/* Segments */}
      {segments.map(s => (
        <path
          key={s.key}
          d={wedgePath(cx, cy, innerR, r - 2, s.start, s.end)}
          fill={segmentColour(s.value)}
          stroke="var(--bg-navy)"
          strokeWidth="0.8"
        />
      ))}

      {/* Composite centre */}
      <circle cx={cx} cy={cy} r={innerR - 1} fill="var(--bg-panel)" stroke={bandColour} strokeWidth="1.2" />
      <text
        x={cx}
        y={cy + 4}
        textAnchor="middle"
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: Math.max(10, innerR * 0.6),
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 500,
          fill: 'var(--ink)',
        }}
      >
        {composite.toFixed(2)}
      </text>

      {/* Label under glyph */}
      {label && (
        <text
          x={cx}
          y={size + 14}
          textAnchor="middle"
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            fill: 'var(--ink-dim)',
          }}
        >
          {label}
        </text>
      )}
    </svg>
  );
}

function segmentColour(v: number): string {
  if (v == null) return 'var(--bg-raised)';
  const alpha = Math.max(0.15, Math.min(1, v));
  if (v < 0.5) return `rgba(25, 208, 184, ${alpha})`;
  if (v < 0.75) return `rgba(212, 162, 76, ${alpha})`;
  return `rgba(224, 93, 80, ${alpha})`;
}

function wedgePath(
  cx: number,
  cy: number,
  ri: number,
  ro: number,
  startDeg: number,
  endDeg: number,
): string {
  const a1 = (startDeg * Math.PI) / 180;
  const a2 = (endDeg * Math.PI) / 180;
  const p1 = [cx + ro * Math.cos(a1), cy + ro * Math.sin(a1)];
  const p2 = [cx + ro * Math.cos(a2), cy + ro * Math.sin(a2)];
  const p3 = [cx + ri * Math.cos(a2), cy + ri * Math.sin(a2)];
  const p4 = [cx + ri * Math.cos(a1), cy + ri * Math.sin(a1)];
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${p1[0]} ${p1[1]} A ${ro} ${ro} 0 ${large} 1 ${p2[0]} ${p2[1]} L ${p3[0]} ${p3[1]} A ${ri} ${ri} 0 ${large} 0 ${p4[0]} ${p4[1]} Z`;
}
