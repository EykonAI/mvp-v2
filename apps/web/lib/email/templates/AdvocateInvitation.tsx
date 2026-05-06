import { Section, Text, Link } from '@react-email/components';
import { EmailLayout, styles } from './EmailLayout';
import { APP_URL } from '@/lib/url';

export type AdvocateInvitationProps = {
  displayName: string | null;
  partnershipDocUrl: string | null;
};

/**
 * Sent when the founder transitions a candidate from 'none' to
 * 'invited' in the admin panel. The body links to the partnership
 * document (which the recipient signs out-of-band and returns by
 * email). On receipt, the founder transitions them to 'active'.
 */
export function AdvocateInvitation({ displayName, partnershipDocUrl }: AdvocateInvitationProps) {
  const greeting = displayName ? `Hi ${displayName},` : 'Hi,';
  return (
    <EmailLayout preview="An invitation to the eYKON founder advocate program.">
      <Section>
        <Text style={styles.kicker}>Founder advocate program</Text>
        <Text style={styles.h1}>An invitation, by hand.</Text>
        <Text style={styles.paragraph}>{greeting}</Text>
        <Text style={styles.paragraph}>
          Your sharing of eYKON content has been visible enough on our side that
          we&apos;d like to invite you into our founder advocate program. It is
          hand-curated and small — a partnership rather than an open affiliate
          channel — and the commercial terms are described in the partnership
          document linked below.
        </Text>
        {partnershipDocUrl && (
          <Section style={{ textAlign: 'left' }}>
            <Link href={partnershipDocUrl} style={styles.button}>
              Read the partnership document →
            </Link>
          </Section>
        )}
        <Text style={styles.paragraph}>
          If the terms work for you, sign and reply to this email and
          we&apos;ll onboard you. If they don&apos;t, no hard feelings — let us
          know and we&apos;ll pass for now without removing your audience-side
          access.
        </Text>
        <Text style={styles.meta}>
          The invitation stays open for 14 days. Beyond that we&apos;ll
          assume the timing wasn&apos;t right and revisit later.
        </Text>
        <Text style={styles.meta}>
          Questions? Reply directly — this email reaches the founder.
        </Text>
        <Text style={styles.meta}>
          eYKON.ai — <Link href={APP_URL} style={{ color: '#19D0B8' }}>{APP_URL}</Link>
        </Text>
      </Section>
    </EmailLayout>
  );
}
