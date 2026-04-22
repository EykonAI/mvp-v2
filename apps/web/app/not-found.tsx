import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Not found — eYKON.ai',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '60px 24px',
        background: 'var(--bg-void)',
        color: 'var(--ink)',
      }}
    >
      <Link
        href="/"
        className="flex items-center gap-2.5 no-underline"
        style={{ textDecoration: 'none', marginBottom: 36 }}
      >
        <svg viewBox="0 0 28 18" width="28" height="18" aria-hidden="true">
          <path
            d="M2 9 L14 2 L26 9 L14 16 Z"
            fill="none"
            stroke="var(--teal)"
            strokeWidth="1.4"
          />
          <circle cx="14" cy="9" r="1.8" fill="var(--teal)" />
        </svg>
        <span
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: 18,
            fontWeight: 500,
            letterSpacing: '0.12em',
            color: 'var(--ink)',
          }}
        >
          eYKON
          <sup
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 10,
              color: 'var(--teal)',
              letterSpacing: '0.15em',
              marginLeft: 2,
            }}
          >
            .ai
          </sup>
        </span>
      </Link>

      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 11,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color: 'var(--teal)',
          marginBottom: 14,
        }}
      >
        ·· 404 — Off the map ··
      </div>

      <h1
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 'clamp(32px, 5vw, 44px)',
          fontWeight: 600,
          letterSpacing: '-0.5px',
          textAlign: 'center',
          maxWidth: 600,
          marginBottom: 14,
        }}
      >
        That coordinate doesn&apos;t resolve.
      </h1>

      <p
        style={{
          color: 'var(--ink-dim)',
          fontSize: 15,
          lineHeight: 1.6,
          maxWidth: 480,
          textAlign: 'center',
          marginBottom: 28,
        }}
      >
        The page you&apos;re looking for has moved, expired, or never existed.
        Try one of these instead.
      </p>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link
          href="/"
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 12,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--bg-void)',
            background: 'var(--teal)',
            padding: '12px 22px',
            borderRadius: 4,
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          Back to landing →
        </Link>
        <Link
          href="/app"
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 12,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--teal)',
            background: 'transparent',
            border: '1px solid var(--teal)',
            padding: '11px 22px',
            borderRadius: 4,
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          Open the globe
        </Link>
        <Link
          href="/pricing"
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 12,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--ink-dim)',
            background: 'transparent',
            border: '1px solid var(--rule-strong)',
            padding: '11px 22px',
            borderRadius: 4,
            textDecoration: 'none',
          }}
        >
          See pricing
        </Link>
      </div>
    </div>
  );
}
