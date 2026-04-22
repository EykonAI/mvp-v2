'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { AuthCard, FormError, FormNotice } from '@/components/auth/AuthCard';
import { AuthInput, AuthButton, Divider } from '@/components/auth/AuthControls';
import { OAuthButtons } from '@/components/auth/OAuthButtons';

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/app';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = getSupabaseBrowser();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }
    router.push(next);
    router.refresh();
  }

  async function sendMagicLink() {
    if (!email) {
      setError('Enter your email first.');
      return;
    }
    setLoading(true);
    setError(null);
    const supabase = getSupabaseBrowser();
    const callback = new URL('/auth/callback', window.location.origin);
    callback.searchParams.set('next', next);
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callback.toString() },
    });
    if (otpError) {
      setError(otpError.message);
    } else {
      setMagicLinkSent(true);
    }
    setLoading(false);
  }

  return (
    <AuthCard
      title="Sign in"
      subtitle="Access your eYKON workspace — globe, Intelligence Center, AI analyst."
      footerHref={`/auth/signup${params.toString() ? `?${params.toString()}` : ''}`}
      footerLabel="New to eYKON?"
      footerAction="Create an account →"
    >
      {magicLinkSent ? (
        <FormNotice
          tone="success"
          message={`Magic link sent to ${email}. Check your inbox and click the link to sign in.`}
        />
      ) : (
        <>
          <OAuthButtons next={next} />
          <Divider label="or with email" />
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
            <AuthInput
              id="password"
              label="Password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
              <AuthButton type="submit" disabled={loading}>
                {loading ? 'Signing in…' : 'Sign in'}
              </AuthButton>
              <AuthButton
                type="button"
                variant="ghost"
                onClick={sendMagicLink}
                disabled={loading}
              >
                Email me a magic link instead
              </AuthButton>
            </div>
            <p
              style={{
                textAlign: 'center',
                marginTop: 14,
                fontFamily: 'var(--f-mono)',
                fontSize: 10.5,
                letterSpacing: '0.1em',
              }}
            >
              <Link
                href="/auth/forgot"
                style={{ color: 'var(--ink-dim)', textDecoration: 'none' }}
              >
                Forgot your password?
              </Link>
            </p>
          </form>
        </>
      )}
    </AuthCard>
  );
}
