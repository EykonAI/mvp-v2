'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Account-settings affordance for the signed-in top nav. A compact gear
 * control that links to /settings (the account & security hub: email, tier,
 * billing, and the in-session change-password card).
 *
 * Deliberately kept distinct from CommMenu: that dropdown is the COMM /
 * community layer (public Profile · Radar · Leaderboard · Messages · Rooms ·
 * Spaces). This is the private account surface, so it lives beside
 * LogoutButton and mirrors its compact icon-button styling — the two read as
 * a pair (⚙ Account · ⎋ Log out), apart from the COMM text dropdown.
 *
 * Highlights only on an exact /settings match so it does not light up on
 * /settings/profile (which is the COMM public-profile editor, not account).
 */
export default function AccountMenu() {
  const pathname = usePathname();
  const active = pathname === '/settings';

  return (
    <Link
      href="/settings"
      title="Account settings"
      aria-label="Account settings"
      aria-current={active ? 'page' : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: 'var(--f-mono)',
        fontSize: 10.5,
        letterSpacing: '0.15em',
        textTransform: 'uppercase',
        color: active ? 'var(--teal)' : 'var(--ink-dim)',
        background: 'transparent',
        border: `1px solid ${active ? 'var(--teal)' : 'var(--rule-strong)'}`,
        borderRadius: 2,
        padding: '5px 10px',
        textDecoration: 'none',
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
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
      <span className="hidden lg:inline">Account</span>
    </Link>
  );
}
