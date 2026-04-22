'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { AuthCard, FormError, FormNotice } from '@/components/auth/AuthCard';
import { AuthButton } from '@/components/auth/AuthControls';

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailView />
    </Suspense>
  );
}

function VerifyEmailView() {
  const params = useSearchParams();
  const email = params.get('email') ?? '';
  const [resent, setResent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resend() {
    if (!email) return;
    setLoading(true);
    setError(null);
    const supabase = getSupabaseBrowser();
    const callback = new URL('/auth/callback', window.location.origin);
    callback.searchParams.set('next', params.get('next') ?? '/app');
    const { error: resendError } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: callback.toString() },
    });
    if (resendError) {
      setError(resendError.message);
    } else {
      setResent(true);
    }
    setLoading(false);
  }

  return (
    <AuthCard
      title="Check your inbox"
      subtitle={
        email
          ? `We sent a confirmation link to ${email}. Click it to activate your account.`
          : 'We sent a confirmation link to your email address. Click it to activate your account.'
      }
      footerHref="/auth/signin"
      footerLabel="Already confirmed?"
      footerAction="Sign in →"
    >
      <FormError message={error} />
      {resent && (
        <FormNotice
          tone="success"
          message="A fresh confirmation email is on its way. Check your inbox (and spam folder)."
        />
      )}
      <p
        style={{
          fontSize: 12.5,
          color: 'var(--ink-dim)',
          lineHeight: 1.55,
          marginBottom: 18,
        }}
      >
        No email after a minute? Check spam, or request a new link below.
      </p>
      <AuthButton
        type="button"
        variant="secondary"
        onClick={resend}
        disabled={loading || !email}
      >
        {loading ? 'Sending…' : 'Resend confirmation email'}
      </AuthButton>
    </AuthCard>
  );
}
