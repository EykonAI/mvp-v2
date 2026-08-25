/**
 * ProvenanceChip — states where a panel's data actually came from.
 *
 * The platform's own rule is that absence of signal is not absence of
 * activity, and that a fixture must never be mistakable for a
 * measurement. Before this component the interface had no shared way to
 * say which of those it was showing: "loading" appeared in 22 files,
 * "error" in 60, and nothing distinguished *old* from *missing* from
 * *illustrative*. A reader could not tell a live count from a stub.
 *
 * No component library ships this — freshness and provenance are
 * domain concepts, not generic UI — so it is first-party by necessity.
 *
 * Identity is carried by the label text, not by colour alone: the
 * signal palette cannot separate six hues under deuteranopia (measured
 * ΔE 3.9 on the closest pair), so every state names itself in words.
 *
 * Pure presentational, no client state — safe in server components.
 */

export type ProvenanceState = 'live' | 'cached' | 'stale' | 'fixture' | 'absent';

const STATES: Record<
  ProvenanceState,
  { label: string; colour: string; border: string; tint: string; sr: string }
> = {
  live:    { label: 'LIVE',     colour: 'var(--teal)',    border: 'var(--teal-dim)',    tint: 'rgba(25, 208, 184, 0.10)', sr: 'Live data' },
  cached:  { label: 'CACHED',   colour: 'var(--ink-dim)', border: 'var(--rule-strong)', tint: 'var(--bg-raised)',         sr: 'Cached data' },
  stale:   { label: 'STALE',    colour: 'var(--amber)',   border: 'var(--amber)',       tint: 'rgba(212, 162, 76, 0.10)', sr: 'Stale data' },
  fixture: { label: 'FIXTURE',  colour: 'var(--coral)',   border: 'var(--coral)',       tint: 'rgba(222, 127, 112, 0.12)', sr: 'Illustrative fixture, not measured data' },
  absent:  { label: 'NO DATA',  colour: 'var(--ink-dim)', border: 'var(--rule-strong)', tint: 'transparent',              sr: 'No data recorded' },
};

/** Whole hours -> a compact age string. Undefined ages render nothing. */
function formatAge(hours?: number): string | null {
  if (hours === undefined || hours === null || !isFinite(hours)) return null;
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

export default function ProvenanceChip({
  state,
  ageHours,
  label,
  title,
}: {
  state: ProvenanceState;
  /** Age of the newest row, in hours. Omitted for fixtures. */
  ageHours?: number;
  /** Override the visible label. The screen-reader text still names the state. */
  label?: string;
  title?: string;
}) {
  const s = STATES[state];
  const age = formatAge(ageHours);
  const visible = label ?? s.label;

  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontFamily: 'var(--f-mono)',
        fontSize: 9.5,
        letterSpacing: '0.13em',
        textTransform: 'uppercase',
        color: s.colour,
        background: s.tint,
        border: `1px solid ${s.border}`,
        padding: '2px 8px',
        borderRadius: 999,
        verticalAlign: 'middle',
        whiteSpace: 'nowrap',
      }}
    >
      {state === 'live' && (
        <span
          className="pulse-dot"
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'currentColor',
            boxShadow: '0 0 7px currentColor',
          }}
        />
      )}
      <span aria-hidden="true">
        {visible}
        {age ? ` ${age}` : ''}
      </span>
      <span className="sr-only">
        {s.sr}
        {age ? `, newest ${age} old` : ''}
      </span>
    </span>
  );
}
