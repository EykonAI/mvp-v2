'use client';
import { useState } from 'react';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { AuthCard, FormError, FormNotice } from '@/components/auth/AuthCard';
import { AuthInput, AuthButton } from '@/components/auth/AuthControls';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = getSupabaseBrowser();
    const redirectTo = `${window.location.origin}/auth/reset`;
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    if (resetError) {
      setError(resetError.message);
    } else {
      setSent(true);
    }
    setLoading(false);
  }

  return (
    <AuthCard
      title="Reset your password"
      subtitle="Enter your email and we'll send you a link to set a new password."
      footerHref="/auth/signin"
      footerLabel="Remembered it?"
      footerAction="Back to sign in →"
    >
      {sent ? (
        <FormNotice
          tone="success"
          message={`If an account exists for ${email}, a reset link is now in your inbox.`}
        />
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <FormError message={error} />
          <AuthInput
            id="email"
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
          <AuthButton type="submit" disabled={loading}>
            {loading ? 'Sending…' : 'Send reset link'}
          </AuthButton>
        </form>
      )}
    </AuthCard>
  );
}
