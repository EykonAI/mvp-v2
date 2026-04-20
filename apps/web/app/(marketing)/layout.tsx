import Link from 'next/link';

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-eykon-bg-void text-eykon-ink">
      <header
        className="sticky top-0 z-30 flex items-center gap-7 px-6 py-3 backdrop-blur"
        style={{
          background: 'rgba(10, 18, 32, 0.9)',
          borderBottom: '1px solid var(--rule-soft)',
        }}
      >
        <Link href="/" className="flex items-center gap-2.5 no-underline">
          <svg viewBox="0 0 28 18" width="28" height="18">
            <path d="M2 9 L14 2 L26 9 L14 16 Z" fill="none" stroke="var(--teal)" strokeWidth="1.4" />
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

        <nav
          className="ml-auto flex items-center gap-6"
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 11,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
          }}
        >
          <Link href="/pricing" style={{ color: 'var(--ink-dim)', textDecoration: 'none' }}>
            Pricing
          </Link>
          <Link href="/faq" style={{ color: 'var(--ink-dim)', textDecoration: 'none' }}>
            FAQ
          </Link>
          <Link
            href="/auth/signin"
            style={{ color: 'var(--ink-dim)', textDecoration: 'none' }}
          >
            Sign in
          </Link>
          <Link
            href="/app"
            style={{
              color: 'var(--bg-void)',
              background: 'var(--teal)',
              padding: '6px 14px',
              borderRadius: 2,
              textDecoration: 'none',
              fontWeight: 500,
            }}
          >
            Open app →
          </Link>
        </nav>
      </header>

      <main className="flex-1">{children}</main>

      <footer
        className="px-6 py-8 mt-auto"
        style={{
          borderTop: '1px solid var(--rule-soft)',
          background: 'var(--bg-panel, rgba(10, 18, 32, 0.6))',
          fontFamily: 'var(--f-mono)',
          fontSize: 11,
          letterSpacing: '0.1em',
          color: 'var(--ink-dim)',
        }}
      >
        <div className="flex flex-wrap gap-6 items-center justify-between">
          <span>eYKON.ai · © 2026</span>
          <nav className="flex gap-5">
            <Link href="/terms" style={{ color: 'inherit', textDecoration: 'none' }}>
              Terms
            </Link>
            <Link href="/privacy" style={{ color: 'inherit', textDecoration: 'none' }}>
              Privacy
            </Link>
            <Link href="/cookies" style={{ color: 'inherit', textDecoration: 'none' }}>
              Cookies
            </Link>
            <a
              href="https://x.com/eykon"
              target="_blank"
              rel="noreferrer"
              style={{ color: 'inherit', textDecoration: 'none' }}
            >
              Status
            </a>
            <a
              href="mailto:support@eykon.ai"
              style={{ color: 'inherit', textDecoration: 'none' }}
            >
              support@eykon.ai
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
