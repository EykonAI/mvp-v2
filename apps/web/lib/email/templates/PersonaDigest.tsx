import { Button, Link, Text } from '@react-email/components';
import { EmailLayout, styles } from './EmailLayout';
import { APP_URL } from '@/lib/url';
import type { DigestData } from '@/lib/notifications/digest';

// Zero-config persona digest (PR 2 of 3). Renders the DigestData the
// builder composes from the global intelligence streams. Sections are
// conditional — a quiet section disappears rather than rendering an
// empty shell. The unsubscribe link is mandatory (the send cron also
// sets the RFC-8058 List-Unsubscribe headers pointing at the same URL).

export type PersonaDigestProps = {
  data: DigestData;
  unsubscribeUrl: string;
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#FF6B6B',
  high: '#FF9F6B',
  medium: '#E8C76B',
  low: '#8BA3B8',
};

function severityColor(severity: string | null | undefined): string {
  return SEVERITY_COLORS[(severity || '').toLowerCase()] ?? '#8BA3B8';
}

function arrow(delta: number): string {
  return delta > 0 ? '▲' : delta < 0 ? '▼' : '·';
}

export function PersonaDigest({ data, unsubscribeUrl }: PersonaDigestProps) {
  const cadenceWord = data.cadence === 'daily' ? 'daily' : 'weekly';
  const windowWord = data.cadence === 'daily' ? 'past 24 hours' : 'past 7 days';

  return (
    <EmailLayout
      preview={`Your ${cadenceWord} intelligence digest — ${windowWord}.`}
    >
      <Text style={styles.kicker}>
        {data.personaLabel} · {cadenceWord} digest
      </Text>
      <Text style={styles.h1}>What moved in the {windowWord}</Text>

      {data.isEmpty ? (
        <Text style={styles.paragraph}>
          A quiet period — no notable anomalies, infrastructure incidents,
          or conflict spikes in your areas this window. The feeds keep
          watching; you will hear from us when something moves.
        </Text>
      ) : null}

      {data.convergences.length > 0 ? (
        <div style={{ ...styles.panel, borderColor: '#19D0B8' }}>
          <Text style={styles.panelLabel}>
            ·· Convergence — independent feeds agreeing ··
          </Text>
          {data.convergences.map((c, i) => (
            <Text key={i} style={{ ...styles.paragraph, margin: i === 0 ? 0 : '10px 0 0' }}>
              <strong style={{ color: '#E6EDF7' }}>{c.location}</strong>
              <br />
              {c.synthesis}
            </Text>
          ))}
        </div>
      ) : null}

      {data.anomalies.length > 0 ? (
        <div style={styles.panel}>
          <Text style={styles.panelLabel}>·· Anomaly flags ··</Text>
          <Text style={{ ...styles.paragraph, margin: 0 }}>
            {data.anomalies.map((a, i) => (
              <span key={i}>
                {i > 0 ? <br /> : null}
                <span style={{ color: severityColor(a.severity), fontWeight: 600 }}>
                  {a.severity.toUpperCase()}
                </span>{' '}
                · {a.domain} · {a.place} —{' '}
                <span style={styles.mono}>{a.flagType}</span>
              </span>
            ))}
          </Text>
        </div>
      ) : null}

      {data.infraIncidents.length > 0 ? (
        <div style={styles.panel}>
          <Text style={styles.panelLabel}>·· Infrastructure incidents ··</Text>
          <Text style={{ ...styles.paragraph, margin: 0 }}>
            {data.infraIncidents.map((e, i) => (
              <span key={i}>
                {i > 0 ? <br /> : null}
                <strong style={{ color: '#E6EDF7' }}>{e.country}</strong> ·{' '}
                {e.eventType} / {e.infraType}
                {e.title ? <> — {e.title}</> : null}
              </span>
            ))}
          </Text>
        </div>
      ) : null}

      {data.conflictTop.length > 0 ? (
        <div style={styles.panel}>
          <Text style={styles.panelLabel}>·· Notable conflict events ··</Text>
          <Text style={{ ...styles.paragraph, margin: 0 }}>
            {data.conflictTop.map((e, i) => (
              <span key={i}>
                {i > 0 ? <br /> : null}
                <strong style={{ color: '#E6EDF7' }}>{e.country}</strong> ·{' '}
                {e.eventType}
                {e.fatalities > 0 ? <> · {e.fatalities} fatalities</> : null}
                {e.eventDate ? <> · {e.eventDate}</> : null}
              </span>
            ))}
          </Text>
        </div>
      ) : null}

      {data.postureMovers.length > 0 ? (
        <div style={styles.panel}>
          <Text style={styles.panelLabel}>·· Theatre posture movers ··</Text>
          <Text style={{ ...styles.paragraph, margin: 0 }}>
            {data.postureMovers.map((m, i) => (
              <span key={i}>
                {i > 0 ? <br /> : null}
                <span style={{ color: m.delta > 0 ? '#FF9F6B' : '#19D0B8' }}>
                  {arrow(m.delta)}
                </span>{' '}
                <strong style={{ color: '#E6EDF7' }}>{m.theatre}</strong> ·{' '}
                {m.from.toFixed(2)} → {m.to.toFixed(2)}
              </span>
            ))}
          </Text>
        </div>
      ) : null}

      <Button href={`${APP_URL}/notif`} style={styles.button}>
        Open the Notification Center →
      </Button>

      <Text style={styles.meta}>
        Want alerts the moment these fire, not a digest later? Add a
        one-click rule from the suggestion library in the app.
      </Text>

      <Text style={styles.meta}>
        You receive this {cadenceWord} digest because email updates are
        enabled for your account.{' '}
        <Link href={unsubscribeUrl} style={{ color: '#19D0B8' }}>
          Unsubscribe from digests
        </Link>{' '}
        — one click, effective immediately.
      </Text>
    </EmailLayout>
  );
}
