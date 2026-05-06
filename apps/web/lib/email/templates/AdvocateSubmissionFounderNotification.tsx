import { Section, Text, Link } from '@react-email/components';
import { EmailLayout, styles } from './EmailLayout';
import { APP_URL } from '@/lib/url';

export type AdvocateSubmissionFounderNotificationProps = {
  submissionId: string;
  fullName: string;
  primaryHandle: string;
  professionalContext: string;
  networkDescription: string;
  whyEykon: string;
  preferredContactEmail: string;
  spamFlagged: boolean;
  spamReason: string | null;
};

/**
 * Sent to the founder address on every inbound /grow submission.
 * Carries the submission contents inline (the queue is small enough
 * that triage by email is faster than the admin panel) plus a
 * one-click deep link to the admin review surface.
 *
 * If the heuristic flagged the submission as spam, the email leads
 * with a yellow warning banner — the row still appears in the queue
 * for the founder to manually accept or reject.
 */
export function AdvocateSubmissionFounderNotification(
  props: AdvocateSubmissionFounderNotificationProps,
) {
  const reviewUrl = `${APP_URL}/admin/advocates`;
  return (
    <EmailLayout preview={`New advocate submission from ${props.fullName}`}>
      <Section>
        <Text style={styles.kicker}>New advocate submission</Text>
        <Text style={styles.h1}>{props.fullName}</Text>

        {props.spamFlagged && (
          <Section
            style={{
              background: '#3A2D14',
              border: '1px solid #6E521D',
              borderRadius: 6,
              padding: '12px 14px',
              margin: '0 0 14px',
            }}
          >
            <Text style={{ ...styles.meta, color: '#F5C66B', margin: 0 }}>
              Spam-flagged: <strong>{props.spamReason ?? 'unknown reason'}</strong>.
              Reviewed manually like every other submission — no auto-reject.
            </Text>
          </Section>
        )}

        <Section style={styles.panel}>
          <Text style={styles.panelLabel}>Primary handle</Text>
          <Text style={{ ...styles.mono, margin: 0 }}>{props.primaryHandle}</Text>
        </Section>
        <Section style={styles.panel}>
          <Text style={styles.panelLabel}>Professional context</Text>
          <Text style={{ ...styles.paragraph, margin: 0 }}>{props.professionalContext}</Text>
        </Section>
        <Section style={styles.panel}>
          <Text style={styles.panelLabel}>Network description</Text>
          <Text style={{ ...styles.paragraph, margin: 0 }}>{props.networkDescription}</Text>
        </Section>
        <Section style={styles.panel}>
          <Text style={styles.panelLabel}>Why eYKON</Text>
          <Text style={{ ...styles.paragraph, margin: 0 }}>{props.whyEykon}</Text>
        </Section>
        <Section style={styles.panel}>
          <Text style={styles.panelLabel}>Contact</Text>
          <Text style={{ ...styles.mono, margin: 0 }}>{props.preferredContactEmail}</Text>
        </Section>

        <Section style={{ textAlign: 'left' }}>
          <Link href={reviewUrl} style={styles.button}>
            Open the admin queue →
          </Link>
        </Section>

        <Text style={styles.meta}>
          Submission id: <span style={styles.mono}>{props.submissionId}</span>
        </Text>
      </Section>
    </EmailLayout>
  );
}
