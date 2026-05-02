import { Link, Text } from '@react-email/components';
import { EmailLayout, styles } from './EmailLayout';
import { APP_URL } from '@/lib/url';

// Soft-warn email at 80 % of the SMS + WhatsApp monthly cap
// (brief §10). Sent once per calendar month per user. The body
// gives the user three things: where they are, where the hard stop
// is, and what to do (pause noisy rules or wait for the period
// to roll over).

export type NotifCapWarningProps = {
  tierLabel: string;
  count: number;
  cap: number;
  periodYm: string;
};

export function NotifCapWarning({ tierLabel, count, cap, periodYm }: NotifCapWarningProps) {
  const pct = Math.round((count / Math.max(1, cap)) * 100);
  const hardStop = Math.round(cap * 1.5);

  return (
    <EmailLayout preview={`Your eYKON ${tierLabel} SMS/WhatsApp usage is at ${pct} % this month.`}>
      <Text style={styles.kicker}>·· Notification usage ··</Text>
      <Text style={styles.h1}>You&#x2019;re past 80 % of your monthly cap.</Text>
      <Text style={styles.paragraph}>
        Your eYKON <strong style={{ color: '#E6EDF7' }}>{tierLabel}</strong> account has dispatched{' '}
        <strong style={styles.mono}>{count}</strong> SMS / WhatsApp notifications in {periodYm} —
        that&#x2019;s {pct} % of your {cap}-message cap.
      </Text>
      <div style={styles.panel}>
        <Text style={styles.panelLabel}>What happens next</Text>
        <Text style={{ ...styles.paragraph, margin: 0 }}>
          The hard stop kicks in at <strong style={styles.mono}>{hardStop}</strong> messages
          (150 % of the cap). Beyond that, SMS and WhatsApp legs are suppressed until the
          period rolls over. <strong style={{ color: '#E6EDF7' }}>Email delivery is never
          capped</strong>, so any rule with an email channel keeps firing.
        </Text>
      </div>
      <Text style={styles.paragraph}>
        If a rule is firing more than expected, the most common fix is bumping its
        cooldown or tightening its filter.
      </Text>
      <Link href={`${APP_URL}/notif`} style={styles.button}>
        Open Notification Center
      </Link>
      <Text style={styles.meta}>
        This is the only warning you&#x2019;ll get this month. Reply to{' '}
        <Link href="mailto:support@eykon.ai" style={{ color: '#19D0B8' }}>
          support@eykon.ai
        </Link>{' '}
        if you need a higher cap.
      </Text>
    </EmailLayout>
  );
}
