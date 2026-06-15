import type { CSSProperties } from 'react';

// The Calibration Passport — a designed reputation asset that lives on
// the profile. Built now in its score-deferred "calibrating" state: the
// layout, per-domain bars and sparkline are all here, but no number is
// fabricated. When the §9 Reputation Engine lands (user_reputation), the
// loader passes a `reputation` object and the same component lights up.

export interface ReputationDomain {
  key: string;
  label: string;
  value: number | null; // brier-skill in [-1,1], or null while calibrating
}

export interface ReputationData {
  brierSkill: number | null;
  percentile: number | null; // 0..1
  domains: ReputationDomain[];
  spark: number[];
}

const MIN_SAMPLE = 10;
const DEFAULT_DOMAINS: ReputationDomain[] = [
  { key: 'maritime', label: 'Maritime', value: null },
  { key: 'energy', label: 'Energy', value: null },
  { key: 'conflict', label: 'Conflict', value: null },
];

const card: CSSProperties = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--rule)',
  borderRadius: 6,
  padding: '16px 18px',
};

export function ReputationPassport({
  resolvedCount,
  reputation = null,
}: {
  resolvedCount: number;
  reputation?: ReputationData | null;
}) {
  const calibrating = !reputation || reputation.brierSkill == null;
  const skill = reputation?.brierSkill ?? null;
  const domains = reputation?.domains?.length ? reputation.domains : DEFAULT_DOMAINS;
  const spark = reputation?.spark?.length ? reputation.spark : null;

  return (
    <section style={card}>
      <div className="eyebrow" style={{ color: 'var(--teal)' }}>
        Calibration Passport
      </div>

      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 22,
          color: calibrating ? 'var(--ink-dim)' : 'var(--ink)',
          marginTop: 8,
        }}
      >
        {skill == null ? 'Calibrating' : `Brier-skill ${fmtSkill(skill)}`}
      </div>
      <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--ink-dim)', marginTop: 4 }}>
        {calibrating
          ? `${resolvedCount} resolved · score at ≥ ${MIN_SAMPLE}`
          : `${pctRank(reputation!.percentile)} · ${resolvedCount} resolved`}
      </div>

      <Sparkline points={spark} />

      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {domains.map((d) => (
          <DomainBar key={d.key} label={d.label} value={d.value} />
        ))}
      </div>

      <p style={{ fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 12, lineHeight: 1.5 }}>
        Reputation is earned by predictions, scored against live data — provable, not performative.
      </p>
    </section>
  );
}

function DomainBar({ label, value }: { label: string; value: number | null }) {
  // map brier-skill [-1,1] → bar fill [0,1], clamped; null = empty track.
  const fill = value == null ? 0 : Math.max(0, Math.min(1, (value + 1) / 2));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ width: 64, fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--ink-dim)' }}>
        {label}
      </span>
      <span style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--bg-void)', overflow: 'hidden', display: 'block' }}>
        {value != null && (
          <span style={{ display: 'block', height: '100%', width: `${fill * 100}%`, background: 'var(--teal)' }} />
        )}
      </span>
      <span style={{ width: 30, textAlign: 'right', fontFamily: 'var(--f-mono)', fontSize: 10, color: value == null ? 'var(--ink-ghost)' : 'var(--ink-dim)' }}>
        {value == null ? '—' : fmtSkill(value)}
      </span>
    </div>
  );
}

function Sparkline({ points }: { points: number[] | null }) {
  const W = 220;
  const H = 26;
  if (!points || points.length < 2) {
    // placeholder: a flat, faint dashed baseline while calibrating
    return (
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ marginTop: 12, display: 'block' }}>
        <line x1="0" y1={H - 6} x2={W} y2={H - 6} stroke="var(--rule-strong)" strokeWidth="1.5" strokeDasharray="3 4" />
      </svg>
    );
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = W / (points.length - 1);
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(H - 3 - ((p - min) / span) * (H - 6)).toFixed(1)}`)
    .join(' ');
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ marginTop: 12, display: 'block' }}>
      <path d={path} fill="none" stroke="var(--teal)" strokeWidth="1.5" />
    </svg>
  );
}

function fmtSkill(v: number): string {
  const r = Math.round(v * 100) / 100;
  return `${r > 0 ? '+' : ''}${r.toFixed(2)}`;
}

function pctRank(percentile: number | null): string {
  if (percentile == null) return '—';
  const top = Math.max(1, Math.round((1 - percentile) * 100));
  return `Top ${top}%`;
}
