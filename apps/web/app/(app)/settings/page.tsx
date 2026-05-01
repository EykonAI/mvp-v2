import type { Metadata } from 'next';
import Link from 'next/link';
import { getUserProfile } from '@/lib/auth/session';
import { TIER_LABELS } from '@/lib/pricing';
import { ReferralCard } from '@/components/settings/ReferralCard';
import { ClearHistoryCard } from '@/components/settings/ClearHistoryCard';
import { APP_URL } from '@/lib/url';

export const metadata: Metadata = {
  title: 'Settings — eYKON.ai',
  robots: { index: false, follow: false },
};

export default async function SettingsPage() {
  const profile = await getUserProfile();

  // Pre-auth-activation dev fallback: getCurrentTier returns 'pro' when
  // NEXT_PUBLIC_AUTH_ENABLED=false (no profile loaded from DB). Surface a
  // helpful placeholder instead of crashing so the route is browsable.
  const displayEmail = profile?.email ?? 'you@example.com (dev)';
  const displayTier = profile?.tier ?? 'pro';
  const referralCode = profile?.referral_code ?? 'eyk-preview1';
  const foundingLocked = profile?.founding_rate_locked ?? false;
  const baseUrl = APP_URL;

  return (
    <section
      style={{
        maxWidth: 760,
        margin: '0 auto',
        padding: '56px 32px 120px',
        color: 'var(--ink)',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 11,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color: 'var(--teal)',
          marginBottom: 10,
        }}
      >
        ·· Settings ··
      </div>
      <h1
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 36,
          fontWeight: 600,
          letterSpacing: '-0.5px',
          color: 'var(--ink)',
          marginBottom: 32,
        }}
      >
        Your eYKON account
      </h1>

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
          Account
        </div>
        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: '140px 1fr',
            rowGap: 12,
            fontSize: 14,
          }}
        >
          <dt style={{ color: 'var(--ink-faint)' }}>Email</dt>
          <dd style={{ color: 'var(--ink)', margin: 0 }}>{displayEmail}</dd>

          <dt style={{ color: 'var(--ink-faint)' }}>Current tier</dt>
          <dd style={{ color: 'var(--ink)', margin: 0 }}>
            {TIER_LABELS[displayTier]}
            {foundingLocked && (
              <span
                style={{
                  marginLeft: 10,
                  padding: '2px 8px',
                  background: 'rgba(25, 208, 184, 0.12)',
                  border: '1px solid rgba(25, 208, 184, 0.35)',
                  borderRadius: 10,
                  fontSize: 10.5,
                  fontFamily: 'var(--f-mono)',
                  letterSpacing: '0.1em',
                  color: 'var(--teal)',
                }}
              >
                FOUNDING · LOCKED
              </span>
            )}
          </dd>

          <dt style={{ color: 'var(--ink-faint)' }}>Billing</dt>
          <dd style={{ color: 'var(--ink-dim)', margin: 0 }}>
            <Link href="/billing" style={{ color: 'var(--teal)' }}>
              Manage billing & invoices →
            </Link>
          </dd>
        </dl>
      </section>

      <ReferralCard referralCode={referralCode} baseUrl={baseUrl} />

      <ClearHistoryCard />

      <p
        style={{
          fontSize: 12,
          color: 'var(--ink-faint)',
          lineHeight: 1.6,
          marginTop: 20,
        }}
      >
        Need to export your data, change your email, or delete your account?
        Reply to{' '}
        <a href="mailto:support@eykon.ai" style={{ color: 'var(--teal)' }}>
          support@eykon.ai
        </a>{' '}
        and we&apos;ll handle it within 2 business days (GDPR-compliant).
      </p>
    </section>
  );
}
