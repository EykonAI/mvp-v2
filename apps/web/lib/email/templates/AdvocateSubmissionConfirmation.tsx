import { Section, Text, Link } from '@react-email/components';
import { EmailLayout, styles } from './EmailLayout';
import { APP_URL } from '@/lib/url';

export type AdvocateSubmissionConfirmationProps = {
  fullName: string | null;
};

/**
 * Sent to the submitter on inbound /grow form submission. Spec §3.3:
 * "Confirmation email is sent to preferred_contact_email via Resend
 * within 60 seconds." No promises about acceptance — just that we
 * received it and someone reviews every entry.
 */
export function AdvocateSubmissionConfirmation({
  fullName,
}: AdvocateSubmissionConfirmationProps) {
  const greeting = fullName ? `Hi ${fullName},` : 'Hi,';
  return (
    <EmailLayout preview="We received your eYKON advocate program submission.">
      <Section>
        <Text style={styles.kicker}>Submission received</Text>
        <Text style={styles.h1}>Thanks for the note.</Text>
        <Text style={styles.paragraph}>{greeting}</Text>
        <Text style={styles.paragraph}>
          We received your submission for the eYKON founder advocate
          program. Every entry is reviewed by hand, usually within a
          week. If we see a strong fit, we&apos;ll reach out to the email
          you provided with the partnership document and an invitation.
          If the fit isn&apos;t right we&apos;ll reply honestly — every
          response comes from the founder.
        </Text>
        <Text style={styles.meta}>
          A few practical notes while you wait. The program is
          hand-curated, not open-enrolment, so volume isn&apos;t the
          metric — fit is. We don&apos;t auto-reject; if you don&apos;t
          hear back inside two weeks, the queue is just running long
          and a follow-up is welcome.
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
