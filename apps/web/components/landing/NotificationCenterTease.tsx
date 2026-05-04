// Section §7 of the landing page. Compact tease for the just-shipped
// Notification Center: persona-aware suggestion library, three channels
// (email · SMS · WhatsApp), four rule types, fully-audited fire log.
// Visually intentional in a single row of pill-stats with a one-line
// kicker — not a hero.

import Link from 'next/link';

const STATS = [
  { value: '3', label: 'Channels · email · SMS · WhatsApp' },
  { value: '4', label: 'Rule types · single · multi · outcome AI · cross-data AI' },
  { value: '49', label: 'Starter rules across two visible personas' },
  { value: '100%', label: 'Fires audited in a per-user log' },
];

export function NotificationCenterTease() {
  return (
    <section
      style={{
        maxWidth: 1180,
        margin: '0 auto',
        padding: '40px 32px 12px',
      }}
    >
      <div
        style={{
          background: 'var(--bg-panel, rgba(255,255,255,0.03))',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '28px 32px',
        }}
      >
        <div
          style={{
            fontFamily: 'IBM Plex Mono, monospace',
            fontSize: 11,
            letterSpacing: '1.8px',
            textTransform: 'uppercase',
            color: 'var(--cyan)',
            marginBottom: 8,
          }}
        >
          ·· Notification Center ··
        </div>
        <h2
          style={{
            fontFamily: 'Jura, sans-serif',
            fontSize: 26,
            fontWeight: 700,
            lineHeight: 1.2,
            letterSpacing: '-0.3px',
            marginBottom: 14,
          }}
        >
          Tell us what to watch. We&rsquo;ll tell you when it happens.
        </h2>
        <p
          style={{
            color: 'var(--text-secondary)',
            fontSize: 15,
            lineHeight: 1.6,
            maxWidth: 820,
            marginBottom: 22,
          }}
        >
          A persona-aware rule builder that pre-fills the most-likely starter rules for your
          workflow. Single-event, multi-event, outcome-driven AI, and cross-data AI rule types.
          Fires through your verified channels with a 6-hour cooldown and per-tier monthly caps.
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 14,
            marginBottom: 22,
          }}
        >
          {STATS.map(s => (
            <div
              key={s.label}
              style={{
                background: 'var(--bg-base, transparent)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: '14px 16px',
              }}
            >
              <div
                style={{
                  fontFamily: 'IBM Plex Mono, monospace',
                  fontSize: 22,
                  fontWeight: 600,
                  color: 'var(--cyan)',
                  marginBottom: 4,
                }}
              >
                {s.value}
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: 'var(--text-secondary)',
                  lineHeight: 1.45,
                }}
              >
                {s.label}
              </div>
            </div>
          ))}
        </div>

        <Link
          href="/auth/signup"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontFamily: 'IBM Plex Mono, monospace',
            fontSize: 11,
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            color: 'var(--cyan)',
            textDecoration: 'none',
          }}
        >
          Open your Notification Center →
        </Link>
      </div>
    </section>
  );
}
