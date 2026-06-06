'use client';
import { useState } from 'react';
import { getSupabaseBrowser } from '@/lib/supabase-browser';

/**
 * Compact "Log out" control for the signed-in top nav. Sits beside the
 * WelcomeGreeting so account actions group with the user's identity, and
 * stays clear of the width-locked right-hand tab cluster.
 *
 * Signs out via the @supabase/ssr browser client (clears the session cookie
 * that middleware + server helpers read), then hard-navigates to the landing
 * page so any cached signed-in state is fully discarded and the server
 * re-evaluates the now-absent session.
 */
export default function LogoutButton() {
  const [busy, setBusy] = useState(false);

  async function onLogout() {
    if (busy) return;
    setBusy(true);
    try {
      await getSupabaseBrowser().auth.signOut();
    } catch {
      // Sign-out is best-effort; redirect regardless so the user isn't stuck.
    }
    window.location.href = '/';
  }

  return (
    <button
      type="button"
      onClick={onLogout}
      disabled={busy}
      title="Log out"
      aria-label="Log out"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: 'var(--f-mono)',
        fontSize: 10.5,
        letterSpacing: '0.15em',
        textTransform: 'uppercase',
        color: 'var(--ink-dim)',
        background: 'transparent',
        border: '1px solid var(--rule-strong)',
        borderRadius: 2,
        padding: '5px 10px',
        cursor: busy ? 'not-allowed' : 'pointer',
        opacity: busy ? 0.5 : 1,
        whiteSpace: 'nowrap',
      }}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
      </svg>
      <span className="hidden lg:inline">{busy ? 'Signing out…' : 'Log out'}</span>
    </button>
  );
}
