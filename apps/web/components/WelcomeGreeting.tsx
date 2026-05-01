'use client';
import { useEffect, useState } from 'react';

// "WELCOME {firstName}" element rendered in the top-nav, between the
// brand wordmark and the GLOBE tab. Always visible while signed in
// (unlike the AI Chat panel's last-active hint, which dismisses on
// first interaction). Reuses the existing welcome endpoint from the
// Intelligence Analyst Personalisation work — no new server logic.

export default function WelcomeGreeting() {
  const [firstName, setFirstName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/intelligence-analyst/welcome', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (cancelled) return;
        if (data && typeof data.firstName === 'string') setFirstName(data.firstName);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!firstName) return null;

  return (
    <span
      className="hidden md:inline"
      style={{
        fontFamily: 'var(--f-mono)',
        fontSize: 10.5,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: 'var(--ink)',
      }}
    >
      Welcome <span style={{ color: 'var(--teal)' }}>{firstName.toUpperCase()}</span>
    </span>
  );
}
