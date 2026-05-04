import Link from 'next/link';

// Section §5 of the landing page. Three Hero workspaces in fixed
// order — Calibration Ledger, Shadow Fleet, Regime Shifts. Marketing
// surface narrowed per the workspace-tiering decision (BACKEND/Intel
// workspaces update). Order is locked by JSX, not sort: Calibration
// first because it underwrites the other two.

const HERO_WORKSPACES = [
  {
    label: 'Calibration Ledger',
    href: '/intel/calibration',
    body: 'Brier and log-loss across 7-, 30-, and 90-day windows. Every probabilistic claim is logged, scored, and published — defensible by audit.',
  },
  {
    label: 'Shadow Fleet',
    href: '/intel/shadow-fleet',
    body: 'Ranked vessel leads with composite score across multiple indicators. The strongest analyst-persona workspace; the workspace traders use to anticipate sanctions and supply disruptions.',
  },
  {
    label: 'Regime Shifts',
    href: '/intel/regime-shifts',
    body: '30-day-vs-60-day statistical test with p-values and effect sizes. The trader-persona artefact: quantitative, confidence-framed, converts naturally into a trade hypothesis.',
  },
];

export function HeroWorkspaceShowcase() {
  return (
    <section
      style={{
        maxWidth: 1180,
        margin: '0 auto',
        padding: '32px 32px 24px',
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
        ·· Hero workspaces ··
      </div>
      <h2
        style={{
          fontFamily: 'Jura, sans-serif',
          fontSize: 36,
          fontWeight: 700,
          lineHeight: 1.1,
          letterSpacing: '-0.5px',
          textAlign: 'center',
          marginBottom: 14,
        }}
      >
        Three workspaces that <span style={{ color: 'var(--cyan)' }}>do the conversion</span>.
      </h2>
      <p
        style={{
          maxWidth: 720,
          margin: '0 auto 36px',
          color: 'var(--text-secondary)',
          fontSize: 15.5,
          lineHeight: 1.6,
          textAlign: 'center',
        }}
      >
        Calibration underwrites the trustworthiness of the other two. Shadow Fleet is the analyst
        hero. Regime Shifts is the trader hero. Together they tell a coherent story without
        requiring the user to learn seven different workspace concepts.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 16,
        }}
      >
        {HERO_WORKSPACES.map(w => (
          <Link
            key={w.href}
            href={w.href}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              padding: '22px 24px',
              background: 'var(--bg-panel, rgba(255,255,255,0.03))',
              border: '1px solid var(--border)',
              borderRadius: 6,
              textDecoration: 'none',
              color: 'var(--text-primary)',
              minHeight: 180,
              transition: 'border-color 120ms, transform 120ms',
            }}
          >
            <div
              style={{
                fontFamily: 'IBM Plex Mono, monospace',
                fontSize: 10.5,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: 'var(--cyan)',
              }}
            >
              Workspace
            </div>
            <div
              style={{
                fontFamily: 'Jura, sans-serif',
                fontSize: 19,
                fontWeight: 600,
                letterSpacing: '0.02em',
              }}
            >
              {w.label}
            </div>
            <div
              style={{
                fontSize: 13.5,
                color: 'var(--text-secondary)',
                lineHeight: 1.55,
              }}
            >
              {w.body}
            </div>
            <div
              style={{
                marginTop: 'auto',
                fontFamily: 'IBM Plex Mono, monospace',
                fontSize: 10.5,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'var(--cyan)',
              }}
            >
              Open →
            </div>
          </Link>
        ))}
      </div>

      <p
        style={{
          marginTop: 22,
          textAlign: 'center',
          color: 'var(--text-tertiary)',
          fontSize: 13,
          fontStyle: 'italic',
        }}
      >
        Plus deeper workspaces for Commodities and Critical Minerals — visible in the Intelligence Center
        navigation when you sign in.
      </p>
    </section>
  );
}
