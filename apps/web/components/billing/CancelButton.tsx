'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { captureBrowser } from '@/lib/analytics/client';
import type { Tier } from '@/lib/pricing';

export function CancelButton({
  subscriptionId,
  tier,
}: {
  subscriptionId: string;
  tier: Tier;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setSubmitting(true);
    setError(null);
    captureBrowser({ event: 'cancel_clicked', from_tier: tier });
    try {
      const res = await fetch('/api/billing/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription_id: subscriptionId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? 'Could not cancel. Please email support.');
        setSubmitting(false);
        return;
      }
      router.refresh();
    } catch {
      setError('Network error — please try again or email support.');
      setSubmitting(false);
    }
  }

  if (confirming) {
    return (
      <div
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: 13, color: 'var(--amber)' }}>
          Stop renewal at period end?
        </span>
        <button
          type="button"
          disabled={submitting}
          onClick={cancel}
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 11.5,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--bg-void)',
            background: 'var(--amber)',
            border: '1px solid var(--amber)',
            borderRadius: 4,
            padding: '9px 16px',
            cursor: submitting ? 'not-allowed' : 'pointer',
            fontWeight: 600,
          }}
        >
          {submitting ? 'Cancelling…' : 'Yes, stop renewal'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 11.5,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--ink-dim)',
            background: 'transparent',
            border: '1px solid var(--rule-strong)',
            borderRadius: 4,
            padding: '9px 16px',
            cursor: 'pointer',
          }}
        >
          Keep renewing
        </button>
        {error && (
          <span style={{ color: 'var(--red)', fontSize: 12.5, flexBasis: '100%' }}>
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      style={{
        fontFamily: 'var(--f-mono)',
        fontSize: 12,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: 'var(--ink-dim)',
        background: 'transparent',
        border: '1px solid var(--rule-strong)',
        borderRadius: 4,
        padding: '11px 18px',
        cursor: 'pointer',
      }}
    >
      Stop renewal
    </button>
  );
}
