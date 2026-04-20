'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { AuthCard, FormError, FormNotice } from '@/components/auth/AuthCard';
import { AuthInput, AuthButton } from '@/components/auth/AuthControls';

/**
 * When a user clicks the password-reset link in the email, Supabase sets a
 * short-lived recovery session on this URL (via the hash fragment). The SSR
 * browser client picks it up automatically; we just need the user to set a
 * new password and then redirect them back to sign-in.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    // Supabase auto-exchanges the hash token; onAuthStateChange fires PASSWORD_RECOVERY.
    const supabase = getSupabaseBrowser();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setSessionReady(true);
      }
    });
    // Fallback: check immediately in case event already fired.
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setSessionReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    setError(null);
    const supabase = getSupabaseBrowser();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }
    setDone(true);
    setLoading(false);
    setTimeout(() => router.push('/auth/signin'), 1800);
  }

  if (done) {
    return (
      <AuthCard title="Password updated">
        <FormNotice
          tone="success"
          message="Your new password is set. Redirecting to sign in…"
        />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Set a new password"
      subtitle="Choose a password you haven't used on other sites."
      footerHref="/auth/signin"
      footerLabel="Don't need to reset?"
      footerAction="Sign in →"
    >
      <form onSubmit={onSubmit} noValidate>
        <FormError message={error} />
        {!sessionReady && (
          <FormNotice
            message="Verifying reset link… if this persists for more than a few seconds, request a new link from /auth/forgot."
          />
        )}
        <AuthInput
          id="password"
          label="New password (min 8 characters)"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
        />
        <AuthInput
          id="confirm"
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="••••••••"
        />
        <AuthButton type="submit" disabled={loading || !sessionReady}>
          {loading ? 'Updating…' : 'Update password'}
        </AuthButton>
      </form>
    </AuthCard>
  );
}
