'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Client-side navigation shim. Rendering this (instead of calling the server
// `redirect()` in a Server Component) lets the page return a normal RENDER
// response — which preserves the session cookie that middleware just
// refreshed. A Server Component `redirect()` can DROP that Set-Cookie, which
// silently logs the user out (the /me → /u/<handle> Profile bug). Used where a
// route only exists to forward the viewer somewhere.
export function ClientRedirect({ dest, label = 'Loading…' }: { dest: string; label?: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(dest);
  }, [dest, router]);
  return (
    <div
      style={{
        minHeight: '60vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--ink-dim)',
        fontFamily: 'var(--f-mono)',
        fontSize: 12,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
      }}
    >
      {label}
    </div>
  );
}
