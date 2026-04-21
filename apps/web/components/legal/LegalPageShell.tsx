import Link from 'next/link';

const LEGAL_PAGES: Array<{ href: string; label: string }> = [
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/cookies', label: 'Cookies' },
  { href: '/dpa', label: 'DPA' },
  { href: '/refund', label: 'Refund' },
];

export function LegalPageShell({
  title,
  subtitle,
  currentPath,
  children,
}: {
  title: string;
  subtitle?: string;
  currentPath: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        maxWidth: 920,
        margin: '0 auto',
        padding: '80px 32px 120px',
      }}
    >
      <h1
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 'clamp(32px, 5vw, 48px)',
          fontWeight: 700,
          lineHeight: 1.1,
          letterSpacing: '-0.02em',
          color: 'var(--ink)',
          marginBottom: subtitle ? 12 : 32,
        }}
      >
        {title}
      </h1>
      {subtitle && (
        <p
          style={{
            color: 'var(--ink-dim)',
            fontSize: 16,
            lineHeight: 1.55,
            marginBottom: 32,
            maxWidth: 680,
          }}
        >
          {subtitle}
        </p>
      )}

      <nav
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
          borderBottom: '1px solid var(--rule)',
          marginBottom: 40,
          paddingBottom: 0,
        }}
      >
        {LEGAL_PAGES.map((p) => {
          const active = p.href === currentPath;
          return (
            <Link
              key={p.href}
              href={p.href}
              style={{
                padding: '10px 16px',
                fontFamily: 'var(--f-mono)',
                fontSize: 11,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: active ? 'var(--teal)' : 'var(--ink-dim)',
                borderBottom: active ? '2px solid var(--teal)' : '2px solid transparent',
                textDecoration: 'none',
                marginBottom: -1,
                fontWeight: active ? 600 : 500,
              }}
            >
              {p.label}
            </Link>
          );
        })}
      </nav>

      <article>{children}</article>
    </section>
  );
}
