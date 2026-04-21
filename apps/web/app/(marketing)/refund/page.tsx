import type { Metadata } from 'next';
import { LegalPageShell } from '@/components/legal/LegalPageShell';
import { TermlyEmbed } from '@/components/legal/TermlyEmbed';

export const metadata: Metadata = {
  title: 'Refund Policy — eYKON.ai',
  description:
    '14-day no-questions refund on first purchases, plus prorated cancellations from the billing portal.',
};

export default function RefundPage() {
  // The canonical, legally-reviewed refund policy lives in Termly. The headline
  // below summarises what that policy will say so visitors, Lemon Squeezy
  // reviewers, and NOWPayments compliance can see the commitment without
  // waiting for the Termly widget to hydrate.
  return (
    <LegalPageShell
      title="Refund Policy"
      subtitle="14-day no-questions refund on first purchases. After that, cancel anytime from your billing portal — you keep access until the end of the paid period."
      currentPath="/refund"
    >
      <div
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--rule)',
          borderRadius: 6,
          padding: '24px 28px',
          marginBottom: 24,
          color: 'var(--ink)',
          lineHeight: 1.6,
          fontSize: 14.5,
        }}
      >
        <h2
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 11,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--teal)',
            marginBottom: 10,
          }}
        >
          At a glance
        </h2>
        <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--ink-dim)' }}>
          <li style={{ marginBottom: 8 }}>
            <strong style={{ color: 'var(--ink)' }}>14 days, no questions</strong> —
            full refund on any first-time subscription or lifetime purchase if you request
            it within 14 days of the charge.
          </li>
          <li style={{ marginBottom: 8 }}>
            <strong style={{ color: 'var(--ink)' }}>Cancel anytime</strong> — from the
            Lemon Squeezy billing portal. Access continues through the end of the period
            you paid for; no prorated charge-backs beyond the 14-day window.
          </li>
          <li style={{ marginBottom: 8 }}>
            <strong style={{ color: 'var(--ink)' }}>Crypto annual</strong> — the same
            14-day window applies; refunds are paid back in the same coin at the current
            exchange rate, net of network fees.
          </li>
          <li>
            <strong style={{ color: 'var(--ink)' }}>How to request</strong> — reply to
            your receipt email or email <a href="mailto:support@eykon.ai" style={{ color: 'var(--teal)' }}>support@eykon.ai</a>
            {' '}from the account's email address.
          </li>
        </ul>
      </div>

      <TermlyEmbed
        policyId={process.env.NEXT_PUBLIC_TERMLY_REFUND_UUID}
        policyName="Refund Policy"
      />
    </LegalPageShell>
  );
}
