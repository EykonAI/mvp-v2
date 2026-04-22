import { Button, Link, Text } from '@react-email/components';
import { EmailLayout, styles } from './EmailLayout';

export type ReceiptCryptoProps = {
  tierLabel: string;                 // 'Pro · Founding' etc.
  variantId: string;                 // 'pro_founding_annual'
  amountUsd: string;                 // '$244.00' formatted
  payCurrency: string;               // 'USDC' | 'BTC' ...
  txHash?: string | null;
  periodStartIso: string;            // ISO date
  periodEndIso: string;
  grantedFounding: boolean;
};

export function ReceiptCrypto(props: ReceiptCryptoProps) {
  const {
    tierLabel,
    variantId,
    amountUsd,
    payCurrency,
    txHash,
    periodStartIso,
    periodEndIso,
    grantedFounding,
  } = props;

  const periodStart = new Date(periodStartIso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const periodEnd = new Date(periodEndIso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  return (
    <EmailLayout
      preview={`Payment confirmed — your ${tierLabel} subscription is active through ${periodEnd}.`}
    >
      <Text style={styles.kicker}>·· Payment confirmed ··</Text>
      <Text style={styles.h1}>Welcome to eYKON {tierLabel}.</Text>
      <Text style={styles.paragraph}>
        Your crypto payment has been confirmed on-chain. Your subscription is
        active now and runs through{' '}
        <strong style={{ color: '#E6EDF7' }}>{periodEnd}</strong>.
        {grantedFounding && (
          <>
            {' '}
            Your <strong style={{ color: '#19D0B8' }}>Founding Member rate
            is locked for life</strong> — we won't re-price you at renewal.
          </>
        )}
      </Text>

      <div style={styles.panel}>
        <Text style={styles.panelLabel}>Receipt</Text>
        <Text style={{ ...styles.meta, margin: '2px 0' }}>
          Plan · <span style={styles.mono}>{variantId}</span>
        </Text>
        <Text style={{ ...styles.meta, margin: '2px 0' }}>
          Amount · <span style={styles.mono}>{amountUsd} USD</span> (paid in{' '}
          <span style={styles.mono}>{payCurrency.toUpperCase()}</span>)
        </Text>
        <Text style={{ ...styles.meta, margin: '2px 0' }}>
          Period · <span style={styles.mono}>{periodStart}</span> →{' '}
          <span style={styles.mono}>{periodEnd}</span>
        </Text>
        {txHash && (
          <Text style={{ ...styles.meta, margin: '2px 0' }}>
            Tx ·{' '}
            <span style={{ ...styles.mono, wordBreak: 'break-all' }}>
              {txHash}
            </span>
          </Text>
        )}
      </div>

      <Button href="https://mvp.eykon.ai/app" style={styles.button}>
        Open the platform →
      </Button>

      <Text style={styles.paragraph}>
        A few starting points worth the first five minutes: the{' '}
        <Link href="https://mvp.eykon.ai/intel/chokepoint" style={{ color: '#19D0B8' }}>
          Chokepoint Monitor
        </Link>{' '}
        (IM-08) and the{' '}
        <Link href="https://mvp.eykon.ai/intel/cascade" style={{ color: '#19D0B8' }}>
          Cascade Analyzer
        </Link>{' '}
        (IM-18) show the clearest signal-to-trade loop. Your AI analyst budget
        resets monthly — ask it anything about the live feed.
      </Text>

      <Text style={styles.meta}>
        Need this receipt as a PDF, or have a billing question? Reply to this
        email or write to{' '}
        <Link href="mailto:support@eykon.ai" style={{ color: '#19D0B8' }}>
          support@eykon.ai
        </Link>
        .
      </Text>
    </EmailLayout>
  );
}
