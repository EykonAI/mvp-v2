import { Section, Text, Link } from '@react-email/components';
import { EmailLayout, styles } from './EmailLayout';
import { APP_URL } from '@/lib/url';

export type AdvocateWelcomeProps = {
  displayName: string | null;
  rewardfulPayoutSetupUrl: string | null;
  channelUrl: string | null;
};

/**
 * Sent when the founder transitions an invited candidate to 'active'
 * after the partnership document is countersigned. Carries the
 * Rewardful payout-setup link (W-9/W-8BEN + Stripe Connect) and an
 * optional channel link (Slack / Discord) for the advocate-only
 * community if one is configured.
 */
export function AdvocateWelcome({
  displayName,
  rewardfulPayoutSetupUrl,
  channelUrl,
}: AdvocateWelcomeProps) {
  const greeting = displayName ? `Hi ${displayName},` : 'Hi,';
  return (
    <EmailLayout preview="Welcome to the eYKON founder advocate program.">
      <Section>
        <Text style={styles.kicker}>Founder advocate · onboarded</Text>
        <Text style={styles.h1}>Welcome aboard.</Text>
        <Text style={styles.paragraph}>{greeting}</Text>
        <Text style={styles.paragraph}>
          Your partnership document has been countersigned and you&apos;re now
          formally part of the eYKON founder advocate program. From this
          point, every paid conversion attributed to you triggers a commission
          per the terms you signed.
        </Text>
        <Text style={styles.paragraph}>
          One short administrative step before the first payout. Rewardful
          handles our payouts, tax forms (W-9 / W-8BEN), and Stripe Connect.
          Use the link below to complete your payout setup — without it,
          accruals will sit pending.
        </Text>
        {rewardfulPayoutSetupUrl && (
          <Section style={{ textAlign: 'left' }}>
            <Link href={rewardfulPayoutSetupUrl} style={styles.button}>
              Complete payout setup →
            </Link>
          </Section>
        )}
        {channelUrl && (
          <Section style={styles.panel}>
            <Text style={styles.panelLabel}>Advocate-only channel</Text>
            <Text style={{ ...styles.paragraph, margin: 0 }}>
              We run a small private channel for advocates to share what
              they&apos;re working on and to flag platform requests early. Join
              us:{' '}
              <Link href={channelUrl} style={{ color: '#19D0B8' }}>
                {channelUrl}
              </Link>
            </Text>
          </Section>
        )}
        <Text style={styles.meta}>
          A reminder of the headline terms: 50% of subscription revenue, 24
          months per referred user, 60 consecutive paid days before the first
          accrual is released. If a referred user pauses before the 60-day
          threshold the streak resets and the pre-threshold accrual is
          forfeited — this protects the program against pause-arbitrage. Full
          mechanics are in the partnership document we co-signed.
        </Text>
        <Text style={styles.meta}>
          Questions? Reply directly — this reaches the founder.
        </Text>
        <Text style={styles.meta}>
          eYKON.ai — <Link href={APP_URL} style={{ color: '#19D0B8' }}>{APP_URL}</Link>
        </Text>
      </Section>
    </EmailLayout>
  );
}
