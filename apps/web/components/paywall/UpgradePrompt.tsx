'use client';
import Link from 'next/link';
import { TIER_LABELS, type Tier } from '@/lib/pricing';
import { captureBrowser } from '@/lib/analytics/client';

export function UpgradePrompt({
  requiredTier,
  currentTier,
  moduleLabel,
  contextLine,
}: {
  requiredTier: Tier;
  currentTier: Tier;
  moduleLabel?: string;
  contextLine?: string;
}) {
  const isContactSales = requiredTier === 'desk' || requiredTier === 'enterprise';
  const ctaLabel = isContactSales ? 'Contact sales' : `Upgrade to ${TIER_LABELS[requiredTier]}`;
  const ctaHref = isContactSales
    ? `mailto:support@eykon.ai?subject=${encodeURIComponent(
        `${moduleLabel ?? 'eYKON'} access · ${TIER_LABELS[requiredTier]} tier`,
      )}`
    : `/pricing?plan=${requiredTier}_founding_annual&from=${encodeURIComponent(
        moduleLabel ?? 'paywall',
      )}`;

  return (
    <section
      style={{
        maxWidth: 560,
        margin: '96px auto',
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
        {TIER_LABELS[requiredTier]} tier required
      </div>
      <h1
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 30,
          fontWeight: 600,
          lineHeight: 1.15,
          letterSpacing: '-0.01em',
          color: 'var(--ink)',
          marginBottom: 14,
        }}
      >
        {moduleLabel
          ? `${moduleLabel} is part of the ${TIER_LABELS[requiredTier]} tier`
          : `This area is part of the ${TIER_LABELS[requiredTier]} tier`}
      </h1>
      <p
        style={{
          color: 'var(--ink-dim)',
          fontSize: 14.5,
          lineHeight: 1.6,
          marginBottom: 8,
        }}
      >
        You are currently on <strong style={{ color: 'var(--ink)' }}>{TIER_LABELS[currentTier]}</strong>.
        {requiredTier === 'pro' && (
          <>
            {' '}
            Pro unlocks all nine Intelligence Center workspaces, the AI analyst (500 queries
            per month), real-time feeds, and compound-signal alerts.
          </>
        )}
        {(requiredTier === 'desk' || requiredTier === 'enterprise') && (
          <>
            {' '}
            {TIER_LABELS[requiredTier]} is offered via direct contract. Reach out and we'll
            tailor seats, SLAs, and data ingestion to your team.
          </>
        )}
      </p>
      {contextLine && (
        <p style={{ color: 'var(--ink-faint)', fontSize: 13, lineHeight: 1.55, marginBottom: 8 }}>
          {contextLine}
        </p>
      )}

      <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
        <Link
          href={ctaHref}
          onClick={() =>
            captureBrowser({
              event: 'upgrade_clicked',
              from_tier: currentTier,
              target_tier: requiredTier,
              context: moduleLabel ?? 'paywall',
            })
          }
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
          {ctaLabel} →
        </Link>
        <Link
          href="/app"
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 12,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--ink-dim)',
            background: 'transparent',
            padding: '11px 22px',
            border: '1px solid var(--rule-strong)',
            borderRadius: 3,
            textDecoration: 'none',
          }}
        >
          Back to globe
        </Link>
      </div>
    </section>
  );
}
