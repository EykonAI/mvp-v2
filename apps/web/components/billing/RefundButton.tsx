'use client';
import { useState } from 'react';
import { captureBrowser } from '@/lib/analytics/client';

interface Props {
  // Days since the most recent completed purchase. Computed server-side
  // on /billing — when >= 14 the button is not rendered at all.
  daysSincePurchase: number;
  // Number of refund-window days that remain. Pure presentation.
  daysRemaining: number;
}

/**
 * "Request refund" button on /billing. Visible when the most recent
 * completed purchase is within the 14-day window (trial-mechanism
 * brief §6.4). Single-click opens an inline form with a one-field
 * optional "why?" textarea; submit POSTs /api/billing/refund and
 * surfaces the server response.
 */
export function RefundButton({ daysSincePurchase, daysRemaining }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<
    | { kind: 'ok'; etaBusinessDays: number }
    | { kind: 'err'; message: string }
    | null
  >(null);

  async function onSubmit() {
    setSubmitting(true);
    setResult(null);
    captureBrowser({ event: 'page_viewed', path: '/billing#refund-submit' });
    try {
      const res = await fetch('/api/billing/refund', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult({
          kind: 'err',
          message:
            (body?.hint as string) ??
            (body?.error as string) ??
            'Request failed. Please try again.',
        });
        return;
      }
      setResult({
        kind: 'ok',
        etaBusinessDays: (body?.eta_business_days as number) ?? 5,
      });
    } catch (e) {
      setResult({ kind: 'err', message: 'Network error. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  }

  if (result?.kind === 'ok') {
    return (
      <p
        style={{
          fontSize: 13,
          color: 'var(--teal)',
          margin: 0,
          lineHeight: 1.6,
          flexBasis: '100%',
        }}
      >
        Refund request received. You will receive the USDC equivalent of your
        purchase within {result.etaBusinessDays} business days at the wallet
        address on file. Your subscription stays active until the refund is
        sent, then downgrades to Observer. We will email you when the on-chain
        transfer is broadcast.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
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
          fontWeight: 600,
        }}
      >
        Request refund ({daysRemaining}d left)
      </button>
    );
  }

  return (
    <div
      style={{
        flexBasis: '100%',
        marginTop: 6,
        padding: 16,
        border: '1px solid var(--rule-soft)',
        borderRadius: 6,
        background: 'var(--bg-void)',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10.5,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--ink-faint)',
          marginBottom: 10,
        }}
      >
        Refund request · {daysSincePurchase}d since purchase
      </div>
      <p style={{ fontSize: 13, color: 'var(--ink-dim)', marginBottom: 12, lineHeight: 1.6 }}>
        We will send the USDC equivalent of your purchase to the wallet address
        on file within 5 business days. Your subscription stays active until
        the refund is sent. One refund per user lifetime.
      </p>
      <label
        style={{
          display: 'block',
          fontFamily: 'var(--f-mono)',
          fontSize: 10.5,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--ink-faint)',
          marginBottom: 6,
        }}
      >
        Optional — tell us why (helps us improve)
      </label>
      <textarea
        value={reason}
        onChange={e => setReason(e.target.value.slice(0, 500))}
        rows={3}
        placeholder="It would have been more useful if..."
        style={{
          width: '100%',
          padding: 10,
          fontSize: 13,
          background: 'var(--bg-panel)',
          border: '1px solid var(--rule)',
          borderRadius: 4,
          color: 'var(--ink)',
          fontFamily: 'var(--f-body)',
          resize: 'vertical',
          marginBottom: 12,
        }}
      />
      {result?.kind === 'err' && (
        <p style={{ fontSize: 12, color: 'var(--red)', marginBottom: 10 }}>
          {result.message}
        </p>
      )}
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 12,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--bg-void)',
            background: submitting ? 'var(--rule-strong)' : 'var(--teal)',
            border: 'none',
            borderRadius: 4,
            padding: '10px 16px',
            cursor: submitting ? 'not-allowed' : 'pointer',
            fontWeight: 600,
          }}
        >
          {submitting ? 'Submitting…' : 'Confirm refund request'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={submitting}
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 12,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--ink-dim)',
            background: 'transparent',
            border: 'none',
            padding: '10px 6px',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
