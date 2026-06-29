import type { CSSProperties } from 'react';
import { bandFor, NOTE_MIN_SAMPLE, type BandKey } from '@/lib/comm/reputationNote';

// The Reputation Note — eYKON's primary credibility signal (COMM UX/UI Uplift
// brief §3.2 / §3.3). One reusable component at three sizes so the SAME number
// reads identically everywhere it appears:
//   • 'hero'  — full-width band on the profile: score ring + band + breakdown
//   • 'badge' — compact "◆ 82 · SHARP" pill for Spaces cards / leaderboard rows
//   • 'chip'  — micro number-only inline next to @handles in rooms / DMs
//
// Honesty discipline: below NOTE_MIN_SAMPLE resolved calls (or with no number)
// every size renders "Calibrating", never a fabricated score. The band — and
// thus the colour — comes from the shared formula module, the single source of
// truth also used by the compute-user-reputation cron.

export interface ReputationNoteProps {
  note: number | null; // 0–100, or null = calibrating
  nResolved: number;
  percentile?: number | null; // 0..1, 1 = best
  coverage?: number | null; // 0..1
  size?: 'hero' | 'badge' | 'chip';
}

export function ReputationNote({ note, nResolved, percentile = null, coverage = null, size = 'hero' }: ReputationNoteProps) {
  const band = bandFor(note, nResolved);
  const calibrating = band.key === 'calibrating';
  const shown = !calibrating && note != null;

  if (size === 'chip') {
    return (
      <span
        title={shown ? `Reputation Note ${note} · ${band.label}` : `Calibrating (${nResolved}/${NOTE_MIN_SAMPLE})`}
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 11,
          fontWeight: 600,
          color: band.color,
          letterSpacing: '0.02em',
        }}
      >
        {shown ? `◆ ${note}` : '◆ —'}
      </span>
    );
  }

  if (size === 'badge') {
    return (
      <span
        title={shown ? `Reputation Note ${note} · ${band.label}` : `Calibrating (${nResolved}/${NOTE_MIN_SAMPLE})`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontFamily: 'var(--f-mono)',
          fontSize: 10.5,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: band.color,
          border: `1px solid ${band.color}`,
          borderRadius: 999,
          padding: '2px 9px',
          lineHeight: 1.4,
        }}
      >
        {shown ? (
          <>
            <span style={{ fontWeight: 700 }}>◆ {note}</span>
            <span style={{ opacity: 0.85 }}>{band.label}</span>
          </>
        ) : (
          <span>◆ Calibrating</span>
        )}
      </span>
    );
  }

  // hero
  return (
    <section
      aria-label="Reputation Note"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        background: 'var(--bg-panel)',
        border: '1px solid var(--rule)',
        borderRadius: 8,
        padding: '18px 22px',
      }}
    >
      <ScoreRing note={shown ? note! : null} color={band.color} />
      <div style={{ minWidth: 0 }}>
        <div className="eyebrow" style={{ color: 'var(--teal)' }}>
          Reputation Note
        </div>
        <div
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: 26,
            color: shown ? 'var(--ink)' : 'var(--ink-dim)',
            marginTop: 6,
            display: 'flex',
            alignItems: 'baseline',
            gap: 10,
          }}
        >
          <span style={{ color: band.color, fontWeight: 600 }}>{band.label}</span>
        </div>
        <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11.5, color: 'var(--ink-dim)', marginTop: 6 }}>
          {shown ? (
            <>
              {percentile != null && <>{pctRank(percentile)} · </>}
              {nResolved} resolved
              {coverage != null && <> · {Math.round(coverage * 100)}% coverage</>}
            </>
          ) : (
            <>
              {nResolved}/{NOTE_MIN_SAMPLE} resolved · score unlocks at {NOTE_MIN_SAMPLE}
            </>
          )}
        </div>
        <p style={{ fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 10, lineHeight: 1.5, maxWidth: 440 }}>
          Earned by sealed, resolved predictions — accuracy is the spine; volume only buys confidence. Provable, not
          performative.
        </p>
      </div>
    </section>
  );
}

// Circular score ring. The arc length encodes note/100 in the band colour; the
// centre shows the number, or a faint "—" while calibrating.
function ScoreRing({ note, color }: { note: number | null; color: string }) {
  const size = 76;
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = note == null ? 0 : Math.max(0, Math.min(100, note)) / 100;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-void)" strokeWidth={stroke} />
      {note != null && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(c * pct).toFixed(2)} ${c.toFixed(2)}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      )}
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        style={{ fontFamily: 'var(--f-display)', fontSize: 22, fill: note == null ? 'var(--ink-ghost)' : 'var(--ink)' }}
      >
        {note == null ? '—' : note}
      </text>
    </svg>
  );
}

function pctRank(percentile: number): string {
  const top = Math.max(1, Math.round((1 - percentile) * 100));
  return `Top ${top}%`;
}

export type { BandKey };
