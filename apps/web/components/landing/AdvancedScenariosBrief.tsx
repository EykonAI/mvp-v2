// Section §9 of the landing page. Brief tease for the four advanced
// workspaces — chips only, no card treatment. Framing copy mirrors
// the institutional banner inside the product (apps/web/components/
// intel/AdvancedScenariosBanner.tsx) so the user reads the same
// positioning before and after signup.
//
// Verbatim per the engineering execution prompt §6 — do not paraphrase.

import Link from 'next/link';

const CHIPS = [
  { label: 'Chokepoint Simulator', icon: '⚓' },
  { label: 'Sanctions Wargame', icon: '⚖' },
  { label: 'Cascade Propagation', icon: '⇶' },
  { label: 'Precursor Analogs', icon: '◑' },
];

export function AdvancedScenariosBrief() {
  return (
    <section
      style={{
        maxWidth: 1080,
        margin: '0 auto',
        padding: '24px 32px 48px',
      }}
    >
      <div
        style={{
          fontFamily: 'IBM Plex Mono, monospace',
          fontSize: 11,
          letterSpacing: '1.8px',
          textTransform: 'uppercase',
          color: 'var(--cyan)',
          marginBottom: 10,
        }}
      >
        ·· Advanced Scenarios ··
      </div>
      <h3
        style={{
          fontFamily: 'Jura, sans-serif',
          fontSize: 22,
          fontWeight: 700,
          lineHeight: 1.25,
          marginBottom: 12,
        }}
      >
        Built for institutional analysis.
      </h3>
      <p
        style={{
          color: 'var(--text-secondary)',
          fontSize: 14.5,
          lineHeight: 1.6,
          marginBottom: 18,
          maxWidth: 760,
        }}
      >
        Advanced Scenarios are designed for institutional analysis — sanctions cascades,
        chokepoint stress tests, multi-domain pattern matching. They&rsquo;re available to all
        paid users; dedicated institutional support is part of our Enterprise tier.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {CHIPS.map(c => (
          <Link
            key={c.label}
            href="/intel/advanced"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 14px',
              borderRadius: 999,
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              textDecoration: 'none',
              fontFamily: 'IBM Plex Mono, monospace',
              fontSize: 11,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
            }}
          >
            <span aria-hidden="true" style={{ color: 'var(--cyan)', fontSize: 13 }}>
              {c.icon}
            </span>
            {c.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
