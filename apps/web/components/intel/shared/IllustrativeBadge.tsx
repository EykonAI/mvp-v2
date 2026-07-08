/**
 * Small inline badge marking a widget or dataset as illustrative /
 * fixture-backed rather than live. Pure presentational — no client state.
 *
 * P0 honesty item from the INTEL grounding audit: paying analysts must be
 * able to tell real data from illustrative fixtures at a glance.
 */
export default function IllustrativeBadge({
  label = 'ILLUSTRATIVE',
  title,
}: {
  label?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      style={{
        display: 'inline-block',
        fontFamily: 'var(--f-mono)',
        fontSize: 9,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--amber)',
        border: '1px solid var(--amber)',
        padding: '1px 6px',
        borderRadius: 2,
        verticalAlign: 'middle',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}
