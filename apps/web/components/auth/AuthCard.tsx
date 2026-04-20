import Link from 'next/link';

export function AuthCard({
  title,
  subtitle,
  children,
  footerHref,
  footerLabel,
  footerAction,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footerHref?: string;
  footerLabel?: string;
  footerAction?: string;
}) {
  return (
    <div>
      <div
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--rule)',
          borderRadius: 6,
          padding: 32,
        }}
      >
        <h1
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: 24,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            marginBottom: subtitle ? 8 : 20,
            color: 'var(--ink)',
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <p
            style={{
              color: 'var(--ink-dim)',
              fontSize: 13,
              marginBottom: 24,
              lineHeight: 1.5,
            }}
          >
            {subtitle}
          </p>
        )}
        {children}
      </div>
      {footerHref && footerLabel && (
        <p
          style={{
            textAlign: 'center',
            marginTop: 20,
            fontFamily: 'var(--f-mono)',
            fontSize: 11,
            letterSpacing: '0.1em',
            color: 'var(--ink-dim)',
          }}
        >
          {footerLabel}{' '}
          <Link
            href={footerHref}
            style={{ color: 'var(--teal)', textDecoration: 'none', fontWeight: 500 }}
          >
            {footerAction}
          </Link>
        </p>
      )}
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      style={{
        background: 'rgba(224, 93, 80, 0.08)',
        border: '1px solid rgba(224, 93, 80, 0.3)',
        color: 'var(--red)',
        padding: '10px 12px',
        borderRadius: 4,
        fontSize: 12.5,
        lineHeight: 1.4,
        marginBottom: 16,
      }}
    >
      {message}
    </div>
  );
}

export function FormNotice({ message, tone = 'info' }: { message: string; tone?: 'info' | 'success' }) {
  const isSuccess = tone === 'success';
  return (
    <div
      role="status"
      style={{
        background: isSuccess ? 'rgba(74, 191, 138, 0.08)' : 'rgba(25, 208, 184, 0.08)',
        border: `1px solid ${isSuccess ? 'rgba(74, 191, 138, 0.3)' : 'rgba(25, 208, 184, 0.3)'}`,
        color: isSuccess ? 'var(--green)' : 'var(--teal)',
        padding: '10px 12px',
        borderRadius: 4,
        fontSize: 12.5,
        lineHeight: 1.4,
        marginBottom: 16,
      }}
    >
      {message}
    </div>
  );
}
