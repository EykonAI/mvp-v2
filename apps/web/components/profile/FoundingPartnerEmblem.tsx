import type { CSSProperties } from 'react';

// The "eYKON Founding Partner" emblem (Founding Partner build-prompt
// §5, founder cosmetic spec 2026-07-05): a circle of the SAME diameter
// and stroke style as the Reputation Note's ScoreRing (114/9),
// rendered on the OPPOSITE side of the hero band. Same design
// language, deliberately different axis: the ring is EARNED
// (epistemic), the emblem is VETTED (curatorial) — the subcaption
// says so out loud, because the OSINT audience will check.

const RING_SIZE = 114; // keep in lockstep with ScoreRing in ReputationNote.tsx
const RING_STROKE = 9;

export function FoundingPartnerEmblem({ grantedYear }: { grantedYear: number }) {
  const r = (RING_SIZE - RING_STROKE) / 2;
  return (
    <section
      aria-label="eYKON Founding Partner"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 24,
        background: 'var(--bg-panel)',
        border: '1px solid var(--rule)',
        borderRadius: 8,
        padding: '22px 26px',
      }}
    >
      <div style={{ minWidth: 0, textAlign: 'right', flex: 1 }}>
        <div className="eyebrow" style={{ color: 'var(--teal)' }}>
          eYKON Founding Partner
        </div>
        <div
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: 15,
            color: 'var(--ink)',
            marginTop: 6,
          }}
        >
          Vetted {grantedYear} · 1 of 20, ever
        </div>
        <p
          style={{
            fontSize: 10.5,
            color: 'var(--ink-faint)',
            marginTop: 10,
            lineHeight: 1.5,
          }}
          title="Vetted partner — not a score"
        >
          Vetted partner — not a score. The ring on the left is earned;
          this emblem is chosen.
        </p>
      </div>
      <svg
        width={RING_SIZE}
        height={RING_SIZE}
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        style={{ flexShrink: 0 }}
        aria-hidden="true"
      >
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={r}
          fill="none"
          stroke="var(--teal)"
          strokeWidth={RING_STROKE}
        />
        <text
          x="50%"
          y="44%"
          dominantBaseline="central"
          textAnchor="middle"
          style={{ fontFamily: 'var(--f-display)', fontSize: 26, fill: 'var(--teal)' }}
        >
          FP
        </text>
        <text
          x="50%"
          y="63%"
          dominantBaseline="central"
          textAnchor="middle"
          style={{ fontFamily: 'var(--f-mono)', fontSize: 9, letterSpacing: '0.14em', fill: 'var(--ink-dim)' }}
        >
          eYKON
        </text>
      </svg>
    </section>
  );
}

// Small chip for Space cards / space pages / the embed card — same
// family as the profile Pill, distinct label so it is never confused
// with the (separate) Founding Analyst pill.
export function FoundingPartnerChip({ style }: { style?: CSSProperties }) {
  return (
    <span
      title="eYKON Founding Partner — vetted partner, not a score"
      style={{
        fontFamily: 'var(--f-mono)',
        fontSize: 10,
        letterSpacing: '0.05em',
        padding: '3px 9px',
        borderRadius: 999,
        color: 'var(--teal)',
        background: 'var(--teal-glow)',
        border: '1px solid var(--teal-deep)',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      Founding Partner
    </span>
  );
}
