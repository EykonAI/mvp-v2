import { Button, Link, Text } from '@react-email/components';
import { EmailLayout, styles } from './EmailLayout';
import { APP_URL } from '@/lib/url';

export type WaitlistConfirmationProps = {
  email: string;
  tier: 'pro' | 'enterprise';
  position?: number;
};

export function WaitlistConfirmation({
  email,
  tier,
  position,
}: WaitlistConfirmationProps) {
  const tierLabel = tier === 'pro' ? 'Pro' : 'Enterprise (3-seat)';
  const tierPrice =
    tier === 'pro' ? '$29/mo Founding' : '$99/seat/mo Founding';

  return (
    <EmailLayout
      preview={`Your fiat waitlist seat for eYKON ${tierLabel} is reserved.`}
    >
      <Text style={styles.kicker}>·· Fiat waitlist ··</Text>
      <Text style={styles.h1}>You're on the list.</Text>
      <Text style={styles.paragraph}>
        Thanks — your seat on the eYKON fiat waitlist for{' '}
        <strong style={{ color: '#E6EDF7' }}>
          {tierLabel} at {tierPrice}
        </strong>{' '}
        is reserved.
      </Text>

      <div style={styles.panel}>
        <Text style={styles.panelLabel}>What happens next</Text>
        <Text style={{ ...styles.paragraph, margin: 0 }}>
          Fiat billing opens in Week 2 post-launch. When it does, we'll email
          the top 400 waitlist entries with a payment-authorization link at
          the Founding rate — locked for life.
          {position ? (
            <>
              {' '}
              Your current position:{' '}
              <strong style={styles.mono}>#{position}</strong>.
            </>
          ) : null}
        </Text>
      </div>

      <Text style={styles.paragraph}>
        Can't wait? <strong style={{ color: '#E6EDF7' }}>Crypto payment is already live</strong> and
        claims your founding seat instantly — annual-only, 30% cheaper than
        standard annual. Pay in USDC, USDT, BTC, or ETH.
      </Text>

      <Button
        href={
          tier === 'pro'
            ? `${APP_URL}/auth/signup?plan=pro_founding_annual`
            : `${APP_URL}/auth/signup?plan=enterprise_founding_annual`
        }
        style={styles.button}
      >
        Claim Founding Rate in Crypto →
      </Button>

      <Text style={styles.meta}>
        You received this because you submitted{' '}
        <strong style={styles.mono}>{email}</strong> to the eYKON fiat
        waitlist. If that wasn't you, ignore this email — no seat is held
        without confirmation.
      </Text>

      <Text style={styles.meta}>
        Prefer to read our refund &amp; cancellation terms first?{' '}
        <Link href={`${APP_URL}/refund`} style={{ color: '#19D0B8' }}>
          eykon.ai/refund
        </Link>
      </Text>
    </EmailLayout>
  );
}
