// Section §8 of the landing page (per the Engineering Execution Prompt).
// Full-bleed prominent block carrying PARAGRAPH 2 verbatim. The single
// strongest differentiator on the page; doubles as the conversion
// closer just before the final CTA / pricing sequence.
//
// PARAGRAPH 2 is verbatim — including the "Audit us" voice that
// appears nowhere else on the page.

import Link from 'next/link';

export function CalibrationAnchor() {
  return (
    <section
      style={{
        position: 'relative',
        margin: '32px 0 0',
        padding: '64px 32px',
        background:
          'linear-gradient(180deg, var(--cyan-soft) 0%, rgba(25,208,184,0.04) 100%)',
        borderTop: '1px solid var(--cyan)',
        borderBottom: '1px solid var(--cyan)',
      }}
    >
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <div
          style={{
            fontFamily: 'IBM Plex Mono, monospace',
            fontSize: 11,
            letterSpacing: '2.2px',
            textTransform: 'uppercase',
            color: 'var(--cyan)',
            marginBottom: 14,
          }}
        >
          ·· Calibration Ledger ··
        </div>
        <h2
          style={{
            fontFamily: 'Jura, sans-serif',
            fontSize: 44,
            fontWeight: 700,
            lineHeight: 1.05,
            letterSpacing: '-0.8px',
            marginBottom: 20,
          }}
        >
          Don&rsquo;t trust us. <span style={{ color: 'var(--cyan)' }}>Audit us.</span>
        </h2>
        <p
          style={{
            color: 'var(--text-primary)',
            fontSize: 17,
            lineHeight: 1.65,
            marginBottom: 28,
          }}
        >
          Every probabilistic claim eYKON makes is logged, scored against ground truth, and
          published on a public Calibration Ledger — Brier and log-loss across 7-, 30-, and
          90-day windows. The intelligence industry doesn&rsquo;t do this. We do. Don&rsquo;t
          trust us, Audit us,
        </p>
        <Link
          href="/intel/calibration"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 22px',
            borderRadius: 4,
            background: 'var(--cyan)',
            color: 'var(--bg-base)',
            textDecoration: 'none',
            fontFamily: 'IBM Plex Mono, monospace',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
          }}
        >
          View the public Calibration Ledger →
        </Link>
      </div>
    </section>
  );
}
