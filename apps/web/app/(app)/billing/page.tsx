import type { Metadata } from 'next';
import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase-server';
import { getCurrentUser, getUserProfile } from '@/lib/auth/session';
import { BillingSummary } from '@/components/billing/BillingSummary';
import { PurchaseHistory } from '@/components/billing/PurchaseHistory';
import { getCryptoVariant } from '@/lib/pricing';

export const metadata: Metadata = {
  title: 'Billing — eYKON.ai',
  robots: { index: false, follow: false },
};

// Always render on demand — the subscription + purchase reads are per-user
// and must never be cached at the edge.
export const dynamic = 'force-dynamic';

export default async function BillingPage() {
  const user = await getCurrentUser();
  const profile = await getUserProfile();

  // Admin client bypasses RLS so we can read purchases by user_id even when
  // the tier gate above this layout is letting a dev user through without a
  // real auth session. Falls back to empty lists when no user is present.
  const admin = createServerSupabase();

  let subscription = null;
  let purchases: Array<Record<string, unknown>> = [];

  if (user) {
    const { data: subs } = await admin
      .from('subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1);
    subscription = subs?.[0] ?? null;

    const { data: purchaseRows } = await admin
      .from('purchases')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);
    purchases = purchaseRows ?? [];
  }

  // For the BillingSummary "Amount" line, derive from pricing.ts when we
  // know the variant (keeps the number accurate even if the stored
  // amount_cents drifts due to crypto FX rounding).
  const variant = subscription
    ? getCryptoVariant(
        (subscription as unknown as { variant_id: string }).variant_id,
      )
    : null;
  const amountCents = variant?.crypto_total_usd_cents ?? 0;

  return (
    <section
      style={{
        maxWidth: 820,
        margin: '0 auto',
        padding: '56px 32px 120px',
        color: 'var(--ink)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 18,
          marginBottom: 24,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 11,
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              color: 'var(--teal)',
              marginBottom: 6,
            }}
          >
            ·· Billing ··
          </div>
          <h1
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: 36,
              fontWeight: 600,
              letterSpacing: '-0.5px',
              color: 'var(--ink)',
            }}
          >
            Billing & payments
          </h1>
        </div>
        <Link
          href="/settings"
          style={{
            marginLeft: 'auto',
            fontFamily: 'var(--f-mono)',
            fontSize: 11,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--ink-dim)',
            textDecoration: 'none',
            borderBottom: '1px dashed var(--rule-strong)',
            paddingBottom: 2,
          }}
        >
          ← Back to settings
        </Link>
      </div>

      <BillingSummary
        subscription={
          subscription
            ? (subscription as unknown as Parameters<typeof BillingSummary>[0]['subscription'])
            : null
        }
        amountCents={amountCents}
        foundingLocked={profile?.founding_rate_locked ?? false}
      />

      <PurchaseHistory
        purchases={
          purchases as unknown as Parameters<typeof PurchaseHistory>[0]['purchases']
        }
      />

      <p
        style={{
          fontSize: 12,
          color: 'var(--ink-faint)',
          lineHeight: 1.6,
          marginTop: 20,
        }}
      >
        Need a VAT invoice, a refund inside the 14/30-day window, or help
        switching from crypto to fiat? Reply to{' '}
        <a href="mailto:support@eykon.ai" style={{ color: 'var(--teal)' }}>
          support@eykon.ai
        </a>{' '}
        with your order id and we&apos;ll respond within 1 business day. Full
        terms: <Link href="/refund" style={{ color: 'var(--teal)' }}>Refund Policy</Link>.
      </p>
    </section>
  );
}
