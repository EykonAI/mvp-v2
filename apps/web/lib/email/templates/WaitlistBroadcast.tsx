import { Link, Text } from '@react-email/components';
import { EmailLayout, styles } from './EmailLayout';

export type WaitlistBroadcastProps = {
  heading: string;
  /** Body split into paragraphs (rendered in order). Plain text only. */
  bodyParagraphs: string[];
  /** Per-recipient one-click unsubscribe URL (token-based). Required. */
  unsubscribeUrl: string;
};

/**
 * Transactional broadcast to fiat-waitlist contacts (e.g. "fiat billing is
 * now open — here's your founding payment link"). Composed by a founder in
 * the /admin/waitlist dashboard. Every send carries the unsubscribe link
 * below AND a matching List-Unsubscribe header (see lib/email/send.tsx).
 */
export function WaitlistBroadcast({
  heading,
  bodyParagraphs,
  unsubscribeUrl,
}: WaitlistBroadcastProps) {
  return (
    <EmailLayout preview={heading}>
      <Text style={styles.kicker}>·· eYKON fiat waitlist ··</Text>
      <Text style={styles.h1}>{heading}</Text>
      {bodyParagraphs.map((p, i) => (
        <Text key={i} style={styles.paragraph}>
          {p}
        </Text>
      ))}
      <Text style={{ ...styles.meta, marginTop: 18 }}>
        You're receiving this because you joined the eYKON fiat billing waitlist.{' '}
        <Link href={unsubscribeUrl} style={{ color: '#19D0B8' }}>
          Unsubscribe
        </Link>
        .
      </Text>
    </EmailLayout>
  );
}
