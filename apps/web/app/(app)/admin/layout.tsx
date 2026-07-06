'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import TopNav from '@/components/TopNav';

// Shared chrome for every /admin surface. Renders TopNav once for all admin
// pages (several sub-pages previously rendered none) plus a "← Admin console"
// backlink on every sub-page. The backlink is hidden on the /admin index —
// that IS the console it would point back to.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const onConsoleIndex = pathname === '/admin';
  return (
    <>
      <TopNav />
      {!onConsoleIndex && (
        <div style={{ padding: '16px 24px 0' }}>
          <Link
            href="/admin"
            className="admin-backlink"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              fontFamily: 'var(--f-mono)',
              fontSize: 11,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--ink-dim)',
              textDecoration: 'none',
            }}
          >
            ← Admin console
          </Link>
          <style>{`.admin-backlink:hover{color:var(--teal)}`}</style>
        </div>
      )}
      {children}
    </>
  );
}
