import { Button, Link, Text } from '@react-email/components';
import { EmailLayout, styles } from './EmailLayout';

export type CryptoRenewalReminderProps = {
  tierLabel: string;
  daysUntilRenewal: number;
  currentPeriodEndIso: string;
  renewalCheckoutUrl: string;       // freshly minted NOWPayments invoice link
  amountUsd: string;                // '$244.00'
};

export function CryptoRenewalReminder(props: CryptoRenewalReminderProps) {
  const {
    tierLabel,
    daysUntilRenewal,
    currentPeriodEndIso,
    renewalCheckoutUrl,
    amountUsd,
  } = props;

  const endDate = new Date(currentPeriodEndIso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const headline =
    daysUntilRenewal <= 1
      ? 'Your eYKON subscription ends tomorrow.'
      : daysUntilRenewal <= 7
      ? `${daysUntilRenewal} days left on your eYKON subscription.`
      : `Your eYKON subscription renews in ${daysUntilRenewal} days.`;

  return (
    <EmailLayout
      preview={`${tierLabel} renews on ${endDate}. Payment link inside.`}
    >
      <Text style={styles.kicker}>·· Renewal reminder ··</Text>
      <Text style={styles.h1}>{headline}</Text>
      <Text style={styles.paragraph}>
        Your <strong style={{ color: '#E6EDF7' }}>{tierLabel}</strong>{' '}
        subscription runs through{' '}
        <strong style={{ color: '#E6EDF7' }}>{endDate}</strong>. Crypto annual
        plans do not auto-renew — you choose whether to continue. Your
        Founding Member rate applies to the renewal if you take it.
      </Text>

      <div style={styles.panel}>
        <Text style={styles.panelLabel}>Renewal terms</Text>
        <Text style={{ ...styles.meta, margin: '2px 0' }}>
          Amount · <span style={styles.mono}>{amountUsd} USD</span>
        </Text>
        <Text style={{ ...styles.meta, margin: '2px 0' }}>
          Cycle · <span style={styles.mono}>1 year</span> · locked at Founding rate
        </Text>
        <Text style={{ ...styles.meta, margin: '2px 0' }}>
          Pay in · USDC, USDT, BTC, or ETH — quote locked for 20 minutes at
          checkout
        </Text>
      </div>

      <Button href={renewalCheckoutUrl} style={styles.button}>
        Renew in crypto →
      </Button>

      <Text style={styles.paragraph}>
        Prefer to move to fiat auto-renew? Fiat billing is live from Week 2
        post-launch — reply and we'll move you over at the Founding rate
        without a gap in service.
      </Text>

      <Text style={styles.meta}>
        No action? Your access expires on {endDate}. Your watchlists, saved
        queries, and agent reports are retained for 30 days after expiry so
        you can resume instantly if you come back.
      </Text>

      <Text style={styles.meta}>
        Questions:{' '}
        <Link href="mailto:support@eykon.ai" style={{ color: '#19D0B8' }}>
          support@eykon.ai
        </Link>
      </Text>
    </EmailLayout>
  );
}
