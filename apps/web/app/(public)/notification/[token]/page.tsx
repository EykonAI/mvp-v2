import { notFound } from 'next/navigation';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { createServerSupabase } from '@/lib/supabase-server';
import { isValidShareToken } from '@/lib/share';
import { redactNotificationFire, type PublicNotificationView } from '@/lib/share/redact';
import { AttributionCapture } from '@/components/referral/AttributionCapture';
import { EYKON_REF_COOKIE, isValidPublicId } from '@/lib/referral/attribution';

// /notification/{share_token} — public, unauthenticated view of a
// notification fire that the owner explicitly shared. Same access
// model as /analyst: share_token IS the access control, read happens
// via the service-role client because anon has no RLS path into
// user_notification_log.
//
// Mounts <AttributionCapture artifactType="A4">. The redaction strips
// user_id, rule_id (UUID FK), channel_ids, delivery_status, and
// cap_state — all of which would leak the owner's monitoring or
// delivery configuration.

export const dynamic = 'force-dynamic';

type Params = { params: { token: string } };

const RULE_TYPE_LABEL: Record<NonNullable<PublicNotificationView['rule_type']>, string> = {
  single_event: 'Single event',
  multi_event: 'Multi-event window',
  outcome_ai: 'Outcome (AI-evaluated)',
  cross_data_ai: 'Cross-data outcome (AI-evaluated)',
};

export default async function NotificationSharePage({ params }: Params) {
  if (!isValidShareToken(params.token)) {
    notFound();
  }

  const view = await loadShared(params.token);
  if (!view) notFound();

  const ref = cookies().get(EYKON_REF_COOKIE)?.value;
  const refParam = isValidPublicId(ref) ? `?ref=${ref}` : '';
  const ctaHref = `/auth/signup${refParam}`;

  return (
    <article style={{ maxWidth: 760, margin: '0 auto', padding: '40px 24px 64px' }}>
      <AttributionCapture artifactType="A4" artifactId={view.share_token} />

      <header style={{ marginBottom: 28 }}>
        <div
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--ink-faint)',
            marginBottom: 6,
          }}
        >
          Notification fire · shared
          {view.rule_type && (
            <>
              {' · '}
              <span style={{ color: 'var(--teal)' }}>{RULE_TYPE_LABEL[view.rule_type]}</span>
            </>
          )}
        </div>
        <h1
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: 22,
            lineHeight: 1.35,
            color: 'var(--ink)',
            margin: 0,
          }}
        >
          {view.rule_name}
        </h1>
        {view.fired_day && (
          <div
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 10,
              letterSpacing: '0.06em',
              color: 'var(--ink-faint)',
              marginTop: 6,
            }}
          >
            Fired {view.fired_day}
          </div>
        )}
      </header>

      {view.summary && (
        <section
          style={{
            fontFamily: 'var(--f-body)',
            fontSize: 14,
            lineHeight: 1.6,
            color: 'var(--ink)',
            marginBottom: 24,
          }}
        >
          {view.summary}
        </section>
      )}

      {view.rationale && (
        <section style={{ marginBottom: 24 }}>
          <div
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 10,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--ink-faint)',
              marginBottom: 8,
            }}
          >
            AI rationale
          </div>
          <div
            style={{
              fontFamily: 'var(--f-body)',
              fontSize: 13.5,
              lineHeight: 1.6,
              color: 'var(--ink-dim)',
              borderLeft: '2px solid var(--teal-deep)',
              paddingLeft: 14,
            }}
          >
            {view.rationale}
          </div>
        </section>
      )}

      {view.detail_lines.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <div
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 10,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--ink-faint)',
              marginBottom: 8,
            }}
          >
            Event detail
          </div>
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            {view.detail_lines.map((line, i) => (
              <li
                key={i}
                style={{
                  fontFamily: 'var(--f-body)',
                  fontSize: 13,
                  color: 'var(--ink-dim)',
                  lineHeight: 1.5,
                }}
              >
                · {line}
              </li>
            ))}
          </ul>
        </section>
      )}

      <aside
        style={{
          marginTop: 48,
          padding: '20px 24px',
          background: 'var(--bg-raised)',
          border: '1px solid var(--rule)',
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: 14,
              color: 'var(--ink)',
              marginBottom: 4,
            }}
          >
            Build alerts on signals you watch.
          </div>
          <div
            style={{
              fontFamily: 'var(--f-body)',
              fontSize: 12,
              color: 'var(--ink-dim)',
            }}
          >
            eYKON.ai is the geopolitical intelligence platform behind this fire.
          </div>
        </div>
        <Link
          href={ctaHref}
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 11,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--bg-void)',
            background: 'var(--teal)',
            border: '1px solid var(--teal-dim)',
            borderRadius: 2,
            padding: '10px 18px',
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          Sign up →
        </Link>
      </aside>
    </article>
  );
}

async function loadShared(token: string): Promise<PublicNotificationView | null> {
  const admin = createServerSupabase();
  const { data, error } = await admin
    .from('user_notification_log')
    .select('share_token, shared_at, fired_at, payload')
    .eq('share_token', token)
    .maybeSingle();

  if (error || !data) return null;
  return redactNotificationFire(
    data as {
      share_token: string | null;
      shared_at: string | null;
      fired_at: string | null;
      payload: unknown;
    },
  );
}
