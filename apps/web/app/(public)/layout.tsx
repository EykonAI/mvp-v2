import Link from 'next/link';
import { cookies } from 'next/headers';
import { EYKON_REF_COOKIE, isValidPublicId } from '@/lib/referral/attribution';

// Public route group — anyone, including unauthenticated visitors, can
// view artifacts shared by their owners. Intentionally minimal chrome:
// a slim top bar with the wordmark + Sign up CTA, the artifact body,
// and a slim footer. The Sign up link forwards the eykon_ref cookie
// as ?ref=<sharer's public_id> when present, so a visitor who arrived
// via a shared link is attributed back to the sharer if they convert.

export const metadata = {
  robots: { index: false, follow: false },
};

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  const ref = cookies().get(EYKON_REF_COOKIE)?.value;
  const refParam = isValidPublicId(ref) ? `?ref=${ref}` : '';
  const signupHref = `/auth/signup${refParam}`;

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-void)',
        color: 'var(--ink)',
      }}
    >
      <header
        style={{
          padding: '14px 24px',
          borderBottom: '1px solid var(--rule-soft)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Link
          href="/"
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: 18,
            letterSpacing: '0.04em',
            color: 'var(--ink)',
            textDecoration: 'none',
          }}
        >
          eYKON.ai
        </Link>
        <Link
          href={signupHref}
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 11,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--bg-void)',
            background: 'var(--teal)',
            border: '1px solid var(--teal-dim)',
            borderRadius: 2,
            padding: '8px 14px',
            textDecoration: 'none',
          }}
        >
          Sign up →
        </Link>
      </header>

      <main style={{ flex: 1 }}>{children}</main>

      <footer
        style={{
          padding: '20px 24px',
          borderTop: '1px solid var(--rule-soft)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          letterSpacing: '0.06em',
          color: 'var(--ink-faint)',
        }}
      >
        <div>Shared from eYKON.ai · geopolitical intelligence platform</div>
        <div style={{ display: 'flex', gap: 16 }}>
          <Link href="/terms" style={{ color: 'var(--ink-faint)' }}>
            Terms
          </Link>
          <Link href="/privacy" style={{ color: 'var(--ink-faint)' }}>
            Privacy
          </Link>
        </div>
      </footer>
    </div>
  );
}
