import { Link, Text } from '@react-email/components';
import { EmailLayout, styles } from './EmailLayout';
import { APP_URL } from '@/lib/url';

// Email body for a fired Notification Center rule. Generic across
// rule types — single-event in PR 6, multi-event in PR 7, AI rules
// in PR 8 — so the body lines change but the chrome stays steady.
//
// `summary` is a one-sentence headline ("Refinery offline detected
// in Iran"). `detailLines` is up to ~6 short bullets with the event
// payload. `rationale` is the AI-generated explanation for outcome /
// cross-data rules; renders only when present.

export type NotificationFiredProps = {
  ruleName: string;
  ruleType: 'single_event' | 'multi_event' | 'outcome_ai' | 'cross_data_ai';
  summary: string;
  detailLines?: string[];
  rationale?: string | null;
  firedAtIso: string;
};

export function NotificationFired({
  ruleName,
  ruleType,
  summary,
  detailLines,
  rationale,
  firedAtIso,
}: NotificationFiredProps) {
  const firedAt = new Date(firedAtIso);
  const formattedTime = firedAt.toUTCString();

  return (
    <EmailLayout preview={summary}>
      <Text style={styles.kicker}>·· Notification fired ··</Text>
      <Text style={styles.h1}>{ruleName}</Text>
      <Text style={styles.paragraph}>{summary}</Text>

      {detailLines && detailLines.length > 0 && (
        <div style={styles.panel}>
          <Text style={styles.panelLabel}>Event detail</Text>
          {detailLines.map((line, idx) => (
            <Text key={idx} style={{ ...styles.meta, margin: '0 0 4px' }}>
              · {line}
            </Text>
          ))}
        </div>
      )}

      {rationale && (
        <div style={styles.panel}>
          <Text style={styles.panelLabel}>AI rationale</Text>
          <Text style={{ ...styles.paragraph, margin: 0 }}>{rationale}</Text>
        </div>
      )}

      <Text style={styles.meta}>
        Fired at {formattedTime} · type: {ruleType.replace('_', ' ')}
      </Text>

      <Link href={`${APP_URL}/notif?filter=recent`} style={styles.button}>
        Open Notification Center
      </Link>

      <Text style={styles.meta}>
        Manage or pause this rule any time from{' '}
        <Link href={`${APP_URL}/notif`} style={{ color: '#19D0B8' }}>
          /notif
        </Link>
        .
      </Text>
    </EmailLayout>
  );
}
