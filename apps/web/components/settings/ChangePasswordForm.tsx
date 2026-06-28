'use client';
import { useState } from 'react';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { FormError, FormNotice } from '@/components/auth/AuthCard';
import { AuthInput, AuthButton } from '@/components/auth/AuthControls';

/**
 * In-session password change (Path 1) on /settings. A logged-in user enters
 * their current password plus a new one — no email round-trip, no leaving the
 * session. Distinct from the sign-in "Forgot password?" flow (Path 2,
 * /auth/forgot → email → /auth/reset) and from the COMM profile editor
 * (/settings/profile).
 *
 * Supabase "Secure password change" requires reauthentication before a
 * logged-in user can set a new password, so a naive updateUser({ password })
 * returns "Current password required". We satisfy that explicitly:
 *
 *   1) signInWithPassword({ email, currentPassword }) — verifies the current
 *      password and refreshes the session's assurance level.
 *   2) updateUser({ password: newPassword }) — sets the new password.
 *
 * Step 1 makes step 2 succeed whether or not the Supabase "Secure password
 * change" toggle is enabled — no dependence on a dashboard setting.
 *
 * Rendered as a /settings-style card (matching ClearHistoryCard et al.) rather
 * than wrapped in AuthCard, so it sits visually with the other account cards;
 * the form controls are reused from the auth component family for consistency.
 */
export function ChangePasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);

    if (next.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (next === current) {
      setError('New password must be different from your current password.');
      return;
    }
    if (next !== confirm) {
      setError('New passwords do not match.');
      return;
    }

    setLoading(true);
    const supabase = getSupabaseBrowser();

    // Identify the signed-in user (need their email to reauthenticate).
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email) {
      setError('Could not verify your session. Please sign in again.');
      setLoading(false);
      return;
    }

    // 1) Reauthenticate with the CURRENT password (verifies it + refreshes AAL).
    const { error: reauthErr } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: current,
    });
    if (reauthErr) {
      setError('Current password is incorrect.');
      setLoading(false);
      return;
    }

    // 2) Set the new password.
    const { error: updateErr } = await supabase.auth.updateUser({ password: next });
    if (updateErr) {
      setError(updateErr.message);
      setLoading(false);
      return;
    }

    setDone(true);
    setLoading(false);
    setCurrent('');
    setNext('');
    setConfirm('');
  }

  return (
    <section
      style={{
        background: 'var(--bg-panel)',
        border: '1px solid var(--rule)',
        borderRadius: 6,
        padding: '24px 28px',
        marginBottom: 24,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10.5,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--ink-dim)',
          marginBottom: 10,
        }}
      >
        Password
      </div>
      <p style={{ fontSize: 13, color: 'var(--ink)', margin: '0 0 4px' }}>
        Change your password.
      </p>
      <p style={{ fontSize: 12, color: 'var(--ink-faint)', margin: '0 0 16px', lineHeight: 1.5 }}>
        Enter your current password and choose a new one. You&apos;ll stay signed
        in — no email needed.
      </p>

      <form onSubmit={onSubmit} noValidate style={{ maxWidth: 380 }}>
        <FormError message={error} />
        {done && <FormNotice tone="success" message="Password updated." />}
        <AuthInput
          id="current-password"
          label="Current password"
          type="password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          placeholder="••••••••"
        />
        <AuthInput
          id="new-password"
          label="New password (min 8 characters)"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          placeholder="••••••••"
        />
        <AuthInput
          id="confirm-password"
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="••••••••"
        />
        <AuthButton type="submit" fullWidth={false} disabled={loading}>
          {loading ? 'Updating…' : 'Update password'}
        </AuthButton>
      </form>
    </section>
  );
}
