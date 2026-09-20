'use client';
import { useId } from 'react';
import ChartFigure from '@/components/intel/shared/ChartFigure';
import { stripMax, gapCount, num1, type StripBar } from '@/lib/reality-check/board';

/**
 * A nightly sensor strip (build prompt §3.3).
 *
 * THE ONE RULE. A night that was not looked at is drawn as a HATCHED GAP,
 * never as a zero bar. Radiance of exactly 0 occurs 18 times in genuine
 * observations (§2.3), so a zero-height bar would be indistinguishable from
 * a real measured zero — and a cloudy night rendered as a zero is how a
 * chart manufactures an outage. The hatch is a different mark, not a
 * shorter one.
 *
 * SVG rather than divs, deliberately: the bars are dynamic values, and an
 * SVG carries them as attributes instead of as inline style objects, which
 * keeps the a11y structural ratchet from being spent on a chart. The figure
 * is named through ChartFigure and carries a data table, so the series is
 * readable without seeing it.
 */
export default function SensorStrip({
  title,
  desc,
  bars,
  windowFrom,
  tone,
  unit,
}: {
  title: string;
  desc: string;
  bars: StripBar[];
  windowFrom: string;
  tone: 'light' | 'heat';
  unit: string;
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const max = stripMax(bars);
  const gaps = gapCount(bars);
  const W = Math.max(bars.length * 9, 120);
  const H = 64;
  const bw = 7;
  const scale = (v: number) => (max && max > 0 ? Math.max(1, (v / max) * (H - 10)) : 1);
  const colour = tone === 'heat' ? 'var(--amber)' : 'var(--teal)';
  const baseColour = tone === 'heat' ? 'var(--teal-deep)' : 'var(--teal-deep)';

  return (
    <ChartFigure
      title={title}
      desc={`${desc} ${gaps} of ${bars.length} nights were not looked at and are drawn as hatched gaps, never as zeros.`}
      table={{
        columns: ['Night', 'Phase', unit, 'State'],
        rows: bars.map((b) => [
          b.night.slice(5),
          b.phase,
          b.value === null ? '—' : tone === 'heat' ? String(b.value) : num1(b.value),
          b.state,
        ]),
      }}
    >
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        className="rc-strip-svg"
      >
        <defs>
          <pattern id={`hatch-${id}`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="4" height="4" fill="transparent" />
            <line x1="0" y1="0" x2="0" y2="4" stroke="var(--rule-strong)" strokeWidth="1.4" />
          </pattern>
        </defs>
        {bars.map((b, i) => {
          const x = i * 9;
          if (b.gap) {
            // a night not looked at: full-height hatch, so it reads as
            // "no look", not as "a small number"
            return (
              <rect
                key={b.night}
                x={x}
                y={4}
                width={bw}
                height={H - 10}
                fill={`url(#hatch-${id})`}
                stroke="var(--rule-strong)"
                strokeWidth="0.5"
                strokeDasharray="2 2"
              />
            );
          }
          const v = b.value ?? 0;
          const h = tone === 'heat' && v === 0 ? 1.5 : scale(v);
          return (
            <rect
              key={b.night}
              x={x}
              y={H - 6 - h}
              width={bw}
              height={h}
              fill={b.phase === 'window' ? colour : baseColour}
            />
          );
        })}
        <line
          x1={Math.max(0, bars.findIndex((b) => b.night >= windowFrom) * 9 - 1)}
          y1="0"
          x2={Math.max(0, bars.findIndex((b) => b.night >= windowFrom) * 9 - 1)}
          y2={H - 4}
          stroke="var(--ink-ghost)"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
        <line x1="0" y1={H - 5} x2={W} y2={H - 5} stroke="var(--rule)" strokeWidth="1" />
      </svg>
    </ChartFigure>
  );
}
