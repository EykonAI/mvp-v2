import Link from 'next/link';
import { TIER_LABELS, type Tier, type BillingCycle, formatUsd } from '@/lib/pricing';
import { CancelButton } from './CancelButton';

type Subscription = {
  id: string;
  payment_provider: 'lemon_squeezy' | 'nowpayments';
  variant_id: string;
  tier: Tier;
  billing_cycle: BillingCycle;
  status: 'active' | 'past_due' | 'cancelled' | 'expired';
  current_period_start: string;
  current_period_end: string;
  cancel_at: string | null;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}

export function BillingSummary({
  subscription,
  amountCents,
  foundingLocked,
}: {
  subscription: Subscription | null;
  amountCents: number;
  foundingLocked: boolean;
}) {
  if (!subscription) {
    return (
      <section
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--rule)',
          borderRadius: 6,
          padding: '28px 32px',
          marginBottom: 20,
        }}
      >
        <h2
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: 22,
            fontWeight: 600,
            color: 'var(--ink)',
            marginBottom: 10,
          }}
        >
          You&apos;re on the Citizen tier
        </h2>
        <p
          style={{
            color: 'var(--ink-dim)',
            fontSize: 14,
            lineHeight: 1.6,
            marginBottom: 18,
          }}
        >
          Free access to the operational globe and daily briefing. Upgrade to
          Pro for the full Intelligence Menu, real-time feeds, and the AI
          analyst.
        </p>
        <Link
          href="/pricing"
          style={{
            display: 'inline-block',
            fontFamily: 'var(--f-mono)',
            fontSize: 12,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--bg-void)',
            background: 'var(--teal)',
            padding: '11px 22px',
            borderRadius: 4,
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          Upgrade to Pro →
        </Link>
      </section>
    );
  }

  const { payment_provider, tier, billing_cycle, status, current_period_end, cancel_at } =
    subscription;
  const isCrypto = payment_provider === 'nowpayments';
  const isFiat = payment_provider === 'lemon_squeezy';
  const willExpire = cancel_at !== null || status === 'cancelled' || status === 'expired';
  const daysLeft = Math.max(0, daysBetween(new Date().toISOString(), current_period_end));

  const statusPill = (() => {
    if (status === 'expired') return { label: 'Expired', color: 'var(--ink-faint)' };
    if (status === 'cancelled' || cancel_at) {
      return { label: 'Ends ' + formatDate(current_period_end), color: 'var(--amber)' };
    }
    if (status === 'past_due') return { label: 'Past due', color: 'var(--red)' };
    return { label: 'Active', color: 'var(--green)' };
  })();

  return (
    <section
      style={{
        background: 'var(--bg-panel)',
        border: '1px solid var(--rule)',
        borderRadius: 6,
        padding: '28px 32px',
        marginBottom: 20,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 14,
          marginBottom: 14,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 10.5,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--teal)',
              marginBottom: 6,
            }}
          >
            ·· Current plan ··
          </div>
          <h2
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: 24,
              fontWeight: 600,
              color: 'var(--ink)',
            }}
          >
            eYKON {TIER_LABELS[tier]}
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
                  verticalAlign: 'middle',
                }}
              >
                FOUNDING · LOCKED
              </span>
            )}
          </h2>
        </div>
        <span
          style={{
            padding: '5px 12px',
            border: `1px solid ${statusPill.color}`,
            borderRadius: 20,
            fontSize: 11,
            fontFamily: 'var(--f-mono)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: statusPill.color,
            whiteSpace: 'nowrap',
          }}
        >
          {statusPill.label}
        </span>
      </div>

      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: '160px 1fr',
          rowGap: 10,
          fontSize: 14,
          marginBottom: 20,
        }}
      >
        <dt style={{ color: 'var(--ink-faint)' }}>Billing cycle</dt>
        <dd style={{ color: 'var(--ink)', margin: 0, textTransform: 'capitalize' }}>
          {billing_cycle}
        </dd>

        <dt style={{ color: 'var(--ink-faint)' }}>Payment method</dt>
        <dd style={{ color: 'var(--ink)', margin: 0 }}>
          {isCrypto ? 'Crypto (annual, no auto-renewal)' : 'Card (auto-renewal via Lemon Squeezy)'}
        </dd>

        <dt style={{ color: 'var(--ink-faint)' }}>Amount</dt>
        <dd style={{ color: 'var(--ink)', margin: 0 }}>
          {amountCents > 0 ? `${formatUsd(amountCents)} / ${billing_cycle === 'annual' ? 'year' : 'month'}` : '—'}
        </dd>

        <dt style={{ color: 'var(--ink-faint)' }}>
          {willExpire ? 'Access until' : 'Next renewal'}
        </dt>
        <dd style={{ color: 'var(--ink)', margin: 0 }}>
          {formatDate(current_period_end)}
          <span style={{ color: 'var(--ink-dim)', fontSize: 12, marginLeft: 8 }}>
            ({daysLeft} days)
          </span>
        </dd>
      </dl>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {isCrypto && status === 'active' && !cancel_at && (
          <>
            <Link
              href={`/pricing?plan=${encodeURIComponent(subscription.variant_id)}&renew=1`}
              style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 12,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'var(--teal)',
                border: '1px solid var(--teal)',
                borderRadius: 4,
                padding: '11px 18px',
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              Renew early →
            </Link>
            <CancelButton subscriptionId={subscription.id} tier={tier} />
          </>
        )}

        {isFiat && (
          <p
            style={{
              fontSize: 13,
              color: 'var(--ink-dim)',
              margin: 0,
              lineHeight: 1.6,
            }}
          >
            Card management, invoices, and cancellation live in the Lemon
            Squeezy billing portal. Deep-link activates in Week 2 post-launch —
            until then, email{' '}
            <a href="mailto:support@eykon.ai" style={{ color: 'var(--teal)' }}>
              support@eykon.ai
            </a>{' '}
            and we&apos;ll handle manually within 1 business day.
          </p>
        )}

        {willExpire && status !== 'expired' && (
          <p
            style={{
              fontSize: 13,
              color: 'var(--amber)',
              margin: 0,
              lineHeight: 1.6,
            }}
          >
            Your subscription is set to end on {formatDate(current_period_end)}. You
            keep full access until then. To change your mind, email{' '}
            <a href="mailto:support@eykon.ai" style={{ color: 'var(--teal)' }}>
              support@eykon.ai
            </a>
            .
          </p>
        )}
      </div>
    </section>
  );
}
