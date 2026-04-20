import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign in — eYKON.ai',
  robots: { index: false, follow: false },
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-between px-6 py-10"
      style={{ background: 'var(--bg-void)', color: 'var(--ink)' }}
    >
      <Link
        href="/"
        className="flex items-center gap-2.5 no-underline"
        style={{ textDecoration: 'none' }}
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

      <main className="w-full max-w-[440px] my-10">{children}</main>

      <footer
        className="flex flex-wrap gap-5 justify-center"
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10.5,
          letterSpacing: '0.1em',
          color: 'var(--ink-faint)',
        }}
      >
        <Link href="/terms" style={{ color: 'inherit', textDecoration: 'none' }}>
          Terms
        </Link>
        <Link href="/privacy" style={{ color: 'inherit', textDecoration: 'none' }}>
          Privacy
        </Link>
        <a
          href="mailto:support@eykon.ai"
          style={{ color: 'inherit', textDecoration: 'none' }}
        >
          support@eykon.ai
        </a>
      </footer>
    </div>
  );
}
