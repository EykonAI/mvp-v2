'use client';
import { useState } from 'react';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { AuthButton } from './AuthControls';
import { FormError } from './AuthCard';

type Provider = 'google' | 'github';

export function OAuthButtons({
  next = '/app',
  referralCode,
}: {
  next?: string;
  referralCode?: string | null;
}) {
  const [loading, setLoading] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signInWith(provider: Provider) {
    setLoading(provider);
    setError(null);
    const supabase = getSupabaseBrowser();
    const callback = new URL('/auth/callback', window.location.origin);
    callback.searchParams.set('next', next);
    if (referralCode) callback.searchParams.set('ref', referralCode);

    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: callback.toString() },
    });
    if (error) {
      setError(error.message);
      setLoading(null);
    }
    // success → Supabase handles the redirect
  }

  return (
    <div>
      <FormError message={error} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <AuthButton
          type="button"
          variant="secondary"
          onClick={() => signInWith('google')}
          disabled={loading !== null}
        >
          <GoogleIcon />
          {loading === 'google' ? 'Opening Google…' : 'Continue with Google'}
        </AuthButton>
        <AuthButton
          type="button"
          variant="secondary"
          onClick={() => signInWith('github')}
          disabled={loading !== null}
        >
          <GitHubIcon />
          {loading === 'github' ? 'Opening GitHub…' : 'Continue with GitHub'}
        </AuthButton>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.1H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3L37.6 9.7C34.1 6.5 29.3 4.5 24 4.5 12.9 4.5 4 13.4 4 24.5s8.9 20 20 20c11 0 19.5-8.9 19.5-20 0-1.5-.2-2.9-.4-4.4z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12.5 24 12.5c3.1 0 5.8 1.2 7.9 3L37.6 9.7C34.1 6.5 29.3 4.5 24 4.5c-7.8 0-14.5 4.4-17.7 10.2z"
      />
      <path
        fill="#4CAF50"
        d="M24 44.5c5.2 0 10-2 13.5-5.2l-6.2-5.3c-2 1.3-4.5 2.1-7.3 2.1-5.2 0-9.6-3.3-11.3-8l-6.6 5.1C9.4 40 16.1 44.5 24 44.5z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.1 4.1-3.9 5.5l6.2 5.3c4-3.7 6.4-9.2 6.4-15.3 0-1.5-.2-2.9-.4-4.4z"
      />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
