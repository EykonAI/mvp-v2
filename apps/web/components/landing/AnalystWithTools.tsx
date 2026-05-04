// Section §4 of the landing page (per the Engineering Execution Prompt).
// Heading + verbatim PARAGRAPH 1 + a small symbolic flow showing the
// tool-call → cited synthesis pattern. Sits between the existing
// PLATFORM section and the Hero workspace showcase, justifying the
// workspace claims that follow.
//
// PARAGRAPH 1 is verbatim — do not paraphrase or soft-edit.

export function AnalystWithTools() {
  return (
    <section
      style={{
        maxWidth: 1080,
        margin: '0 auto',
        padding: '72px 32px 32px',
      }}
    >
      <div
        style={{
          fontFamily: 'IBM Plex Mono, monospace',
          fontSize: 11,
          letterSpacing: '1.8px',
          textTransform: 'uppercase',
          color: 'var(--cyan)',
          marginBottom: 14,
          textAlign: 'center',
        }}
      >
        ·· AI Analyst ··
      </div>
      <h2
        style={{
          fontFamily: 'Jura, sans-serif',
          fontSize: 38,
          fontWeight: 700,
          lineHeight: 1.1,
          letterSpacing: '-0.6px',
          textAlign: 'center',
          marginBottom: 28,
        }}
      >
        Not chat-with-data. <span style={{ color: 'var(--cyan)' }}>An analyst with tools.</span>
      </h2>
      <p
        style={{
          maxWidth: 780,
          margin: '0 auto 32px',
          color: 'var(--text-secondary)',
          fontSize: 16.5,
          lineHeight: 1.65,
          textAlign: 'center',
        }}
      >
        Most &lsquo;AI + data&rsquo; products are chat panels with no access to the underlying
        database. Our Chat is a Claude Opus 4.7 analyst with a catalog of 22 first-class Tools
        wired directly into the platform&rsquo;s proprietary derived datasets — convergence
        events, posture scores, precursor analogs, calibration metrics. When you ask a question,
        the analyst doesn&rsquo;t write SQL or guess from documentation. It calls the right tool,
        gets the structured answer, and synthesizes a narrative with cited sources.
      </p>

      {/* Symbolic flow — Question → Tool → Cited answer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 14,
          flexWrap: 'wrap',
        }}
      >
        <FlowChip label="Question" tone="ink" />
        <FlowArrow />
        <FlowChip label="Tool call · 1 of 22" tone="cyan" mono />
        <FlowArrow />
        <FlowChip label="Structured answer" tone="ink" />
        <FlowArrow />
        <FlowChip label="Cited synthesis" tone="cyan" />
      </div>
    </section>
  );
}

function FlowChip({
  label,
  tone,
  mono,
}: {
  label: string;
  tone: 'ink' | 'cyan';
  mono?: boolean;
}) {
  const isCyan = tone === 'cyan';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 34,
        padding: '0 14px',
        borderRadius: 4,
        background: isCyan ? 'var(--cyan-soft)' : 'var(--bg-panel, rgba(255,255,255,0.04))',
        border: `1px solid ${isCyan ? 'var(--cyan)' : 'var(--border)'}`,
        color: isCyan ? 'var(--cyan)' : 'var(--text-secondary)',
        fontFamily: mono ? 'IBM Plex Mono, monospace' : 'IBM Plex Sans, sans-serif',
        fontSize: 12.5,
        letterSpacing: mono ? '0.08em' : 'normal',
        textTransform: mono ? 'uppercase' : 'none',
      }}
    >
      {label}
    </span>
  );
}

function FlowArrow() {
  return (
    <span
      aria-hidden="true"
      style={{
        color: 'var(--text-tertiary)',
        fontFamily: 'IBM Plex Mono, monospace',
        fontSize: 16,
      }}
    >
      →
    </span>
  );
}
