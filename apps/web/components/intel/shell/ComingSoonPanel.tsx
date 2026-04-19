interface Props {
  phase: string;
  description: string;
}

/**
 * Placeholder panel used during phased rollout. Tells the operator
 * which implementation phase delivers the content.
 */
export default function ComingSoonPanel({ phase, description }: Props) {
  return (
    <div className="flex flex-col items-center justify-center" style={{ minHeight: 400, gap: 14, padding: 24 }}>
      <span
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 9.5,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color: 'var(--ink-faint)',
        }}
      >
        {phase}
      </span>
      <p
        style={{
          fontFamily: 'var(--f-body)',
          fontSize: 13,
          lineHeight: 1.55,
          color: 'var(--ink-dim)',
          maxWidth: 520,
          textAlign: 'center',
        }}
      >
        {description}
      </p>
    </div>
  );
}
