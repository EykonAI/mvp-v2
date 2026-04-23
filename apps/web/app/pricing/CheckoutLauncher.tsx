'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getRewardfulReferral } from '@/components/referral/RewardfulScript';

type Status = 'starting' | 'error';

/**
 * Client-side launcher. On mount: POST /api/checkout/nowpayments with the
 * selected variant, then `window.location.replace()` to the hosted invoice.
 * We use replace (not href =) so the /pricing entry is kicked out of history
 * and the NOWPayments cancel button doesn't loop back into a re-trigger.
 */
export function CheckoutLauncher({
  variantId,
  variantLabel,
}: {
  variantId: string;
  variantLabel: string;
}) {
  const [status, setStatus] = useState<Status>('starting');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const rewardful = getRewardfulReferral();
        const res = await fetch('/api/checkout/nowpayments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            variant: variantId,
            ...(rewardful ? { rewardful_referral: rewardful } : {}),
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;

        if (!res.ok) {
          const msg =
            (json && typeof json.error === 'string' && json.error) ||
            `Checkout failed (HTTP ${res.status})`;
          setError(msg);
          setStatus('error');
          return;
        }

        const invoiceUrl = typeof json.invoice_url === 'string' ? json.invoice_url : '';
        if (!invoiceUrl) {
          setError('Checkout response missing invoice URL.');
          setStatus('error');
          return;
        }

        window.location.replace(invoiceUrl);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : 'Network error contacting checkout.';
        setError(msg);
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [variantId]);

  return (
    <section
      style={{
        maxWidth: 520,
        margin: '120px auto',
        padding: '40px 36px',
        background: 'var(--bg-panel)',
        border: '1px solid var(--rule)',
        borderRadius: 6,
        textAlign: 'left',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10.5,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color: 'var(--teal)',
          marginBottom: 16,
        }}
      >
        {status === 'error' ? 'Checkout failed' : 'Preparing checkout'}
      </div>
      <h1
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 26,
          fontWeight: 600,
          lineHeight: 1.2,
          letterSpacing: '-0.01em',
          color: 'var(--ink)',
          marginBottom: 14,
        }}
      >
        {variantLabel}
      </h1>

      {status === 'starting' && (
        <p style={{ color: 'var(--ink-dim)', fontSize: 14.5, lineHeight: 1.6 }}>
          Redirecting you to the secure NOWPayments invoice. This should take a moment —
          the USD price is locked for 20 minutes once the invoice opens.
        </p>
      )}

      {status === 'error' && (
        <>
          <p style={{ color: 'var(--ink-dim)', fontSize: 14.5, lineHeight: 1.6, marginBottom: 8 }}>
            We couldn&apos;t start the checkout. You have not been charged.
          </p>
          {error && (
            <p
              style={{
                color: 'var(--ink-faint)',
                fontSize: 12.5,
                lineHeight: 1.5,
                fontFamily: 'var(--f-mono)',
                background: 'var(--bg-void)',
                border: '1px solid var(--rule)',
                padding: '10px 12px',
                borderRadius: 3,
                marginBottom: 16,
              }}
            >
              {error}
            </p>
          )}
          <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
            <Link
              href={`/pricing?plan=${encodeURIComponent(variantId)}`}
              style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 12,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'var(--bg-void)',
                background: 'var(--teal)',
                padding: '12px 22px',
                borderRadius: 3,
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              Try again →
            </Link>
            <Link
              href="/#pricing"
              style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 12,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'var(--ink-dim)',
                padding: '11px 22px',
                border: '1px solid var(--rule-strong)',
                borderRadius: 3,
                textDecoration: 'none',
              }}
            >
              Back to pricing
            </Link>
          </div>
        </>
      )}
    </section>
  );
}
