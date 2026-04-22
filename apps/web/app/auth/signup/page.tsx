'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { AuthCard, FormError } from '@/components/auth/AuthCard';
import { AuthInput, AuthButton, Divider } from '@/components/auth/AuthControls';
import { OAuthButtons } from '@/components/auth/OAuthButtons';
import { isValidReferralCode } from '@/lib/auth/referral';
import { getRewardfulReferral } from '@/components/referral/RewardfulScript';

export default function SignUpPage() {
  return (
    <Suspense fallback={null}>
      <SignUpForm />
    </Suspense>
  );
}

function SignUpForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/app';
  const plan = params.get('plan');
  const rawRef = (params.get('ref') ?? params.get('via') ?? '').trim().toLowerCase();
  const referralCode = isValidReferralCode(rawRef) ? rawRef : null;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!acceptTerms) {
      setError('You must accept the Terms and Privacy Policy.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    setError(null);

    const supabase = getSupabaseBrowser();
    const callback = new URL('/auth/callback', window.location.origin);
    callback.searchParams.set('next', next);
    if (plan) callback.searchParams.set('plan', plan);

    const metadata: Record<string, string> = {};
    if (referralCode) metadata.referral_code = referralCode;
    // Rewardful runs independently: its JS sets a cookie when the visitor
    // arrived via ?via=<affiliate-id>. We forward that id through
    // user_metadata so the Week-2 Rewardful-LS webhook can match it to the
    // paying user even if the internal eyk- referral code is absent.
    const rewardful = getRewardfulReferral();
    if (rewardful) metadata.rewardful_referral = rewardful;

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: callback.toString(),
        data: metadata,
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    if (data.session) {
      // Email confirmation is disabled → we already have a session.
      router.push(next);
      router.refresh();
      return;
    }

    // Confirmation email sent; route to verify page.
    const verify = new URL('/auth/verify-email', window.location.origin);
    verify.searchParams.set('email', email);
    if (plan) verify.searchParams.set('plan', plan);
    router.push(verify.pathname + verify.search);
  }

  const referralBadge = referralCode ? (
    <div
      style={{
        background: 'rgba(25, 208, 184, 0.08)',
        border: '1px solid rgba(25, 208, 184, 0.3)',
        padding: '8px 12px',
        borderRadius: 4,
        marginBottom: 18,
        fontFamily: 'var(--f-mono)',
        fontSize: 11,
        letterSpacing: '0.08em',
        color: 'var(--teal)',
      }}
    >
      Referred by <strong>{referralCode}</strong> — your referrer earns when you upgrade.
    </div>
  ) : null;

  const planBadge = plan ? (
    <div
      style={{
        fontFamily: 'var(--f-mono)',
        fontSize: 11,
        letterSpacing: '0.08em',
        color: 'var(--ink-dim)',
        marginBottom: 18,
      }}
    >
      Plan selected: <strong style={{ color: 'var(--ink)' }}>{plan}</strong> · continues to
      checkout after signup.
    </div>
  ) : null;

  return (
    <AuthCard
      title="Create your account"
      subtitle="Free to start. No card required for the Citizen tier."
      footerHref={`/auth/signin${params.toString() ? `?${params.toString()}` : ''}`}
      footerLabel="Already have an account?"
      footerAction="Sign in →"
    >
      {planBadge}
      {referralBadge}

      <OAuthButtons next={next} referralCode={referralCode} />
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
          label="Password (min 8 characters)"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
        />

        <label
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'flex-start',
            fontSize: 12,
            color: 'var(--ink-dim)',
            margin: '4px 0 16px',
            lineHeight: 1.4,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={acceptTerms}
            onChange={(e) => setAcceptTerms(e.target.checked)}
            style={{ marginTop: 3, accentColor: 'var(--teal)' }}
          />
          <span>
            I agree to the{' '}
            <a href="/terms" style={{ color: 'var(--teal)' }}>
              Terms
            </a>{' '}
            and{' '}
            <a href="/privacy" style={{ color: 'var(--teal)' }}>
              Privacy Policy
            </a>
            .
          </span>
        </label>

        <AuthButton type="submit" disabled={loading}>
          {loading ? 'Creating account…' : 'Create account'}
        </AuthButton>
      </form>
    </AuthCard>
  );
}
