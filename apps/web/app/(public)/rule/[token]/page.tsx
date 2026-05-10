import { notFound } from 'next/navigation';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { createServerSupabase } from '@/lib/supabase-server';
import { isValidShareToken } from '@/lib/share';
import { redactRule, type PublicRuleView, type PublicRuleConfig } from '@/lib/share/redact';
import { AttributionCapture } from '@/components/referral/AttributionCapture';
import { EYKON_REF_COOKIE, isValidPublicId } from '@/lib/referral/attribution';

// /rule/{share_token} — public, unauthenticated view of a notification
// rule that the owner explicitly shared. Same access model as /analyst
// and /notification: share_token IS the access control, read happens
// via the service-role client because anon has no RLS path into
// user_notification_rules.
//
// Mounts <AttributionCapture artifactType="A9">. Redaction in
// lib/share/redact.ts strips user_id, channel_ids, last_fired_at,
// persona, cooldown_minutes — anything that leaks the owner's
// monitoring posture beyond the rule shape itself.

export const dynamic = 'force-dynamic';

type Params = { params: { token: string } };

const RULE_TYPE_LABEL: Record<NonNullable<PublicRuleView['rule_type']>, string> = {
  single_event: 'Single event',
  multi_event: 'Multi-event window',
  outcome_ai: 'Outcome (AI-evaluated)',
  cross_data_ai: 'Cross-data outcome (AI-evaluated)',
};

export default async function RuleSharePage({ params }: Params) {
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
      <AttributionCapture artifactType="A9" artifactId={view.share_token} />

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
          Notification rule · shared
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
        {view.created_day && (
          <div
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 10,
              letterSpacing: '0.06em',
              color: 'var(--ink-faint)',
              marginTop: 6,
            }}
          >
            Created {view.created_day}
          </div>
        )}
      </header>

      <ConfigSection config={view.config} />

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
            Track signals like this in your own account.
          </div>
          <div
            style={{
              fontFamily: 'var(--f-body)',
              fontSize: 12,
              color: 'var(--ink-dim)',
            }}
          >
            eYKON.ai is the geopolitical intelligence platform behind this rule.
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

// ─── Sections ─────────────────────────────────────────────────────

function ConfigSection({ config }: { config: PublicRuleConfig }) {
  if (config.kind === 'unknown') return null;

  return (
    <section style={{ marginBottom: 24 }}>
      <SectionLabel>Trigger</SectionLabel>
      {config.kind === 'single_event' && (
        <KeyValueBlock
          rows={[
            { k: 'Tool', v: config.tool },
            ...filtersToRows(config.filters),
          ]}
        />
      )}
      {config.kind === 'multi_event' && (
        <>
          <KeyValueBlock
            rows={[
              { k: 'Window', v: `${config.window_hours} h` },
              { k: 'Predicates', v: String(config.predicates.length) },
            ]}
          />
          <div style={{ marginTop: 12 }}>
            {config.predicates.map((p, i) => (
              <div
                key={i}
                style={{
                  marginTop: 8,
                  padding: '10px 12px',
                  background: 'var(--bg-panel)',
                  border: '1px solid var(--rule)',
                  borderRadius: 4,
                }}
              >
                <div
                  style={{
                    fontFamily: 'var(--f-mono)',
                    fontSize: 10,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: 'var(--ink-faint)',
                    marginBottom: 4,
                  }}
                >
                  Predicate {i + 1}
                </div>
                <KeyValueBlock
                  rows={[
                    { k: 'Tool', v: p.tool },
                    ...filtersToRows(p.filters),
                  ]}
                />
              </div>
            ))}
          </div>
        </>
      )}
      {config.kind === 'outcome_ai' && (
        <>
          <Quote text={config.outcome_statement} label="Outcome" />
          <div style={{ marginTop: 12 }}>
            <KeyValueBlock
              rows={[
                { k: 'k events', v: String(config.k_events) },
                {
                  k: 'Buckets',
                  v: config.buckets.length ? config.buckets.join(', ') : 'all',
                },
              ]}
            />
          </div>
        </>
      )}
      {config.kind === 'cross_data_ai' && (
        <>
          <Quote text={config.outcome_statement} label="Outcome" />
          <div style={{ marginTop: 12 }}>
            <KeyValueBlock
              rows={[
                {
                  k: 'Buckets',
                  v: config.buckets.length ? config.buckets.join(', ') : 'all',
                },
              ]}
            />
          </div>
        </>
      )}
    </section>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
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
      {children}
    </div>
  );
}

function KeyValueBlock({ rows }: { rows: Array<{ k: string; v: string }> }) {
  if (rows.length === 0) return null;
  return (
    <dl
      style={{
        margin: 0,
        display: 'grid',
        gridTemplateColumns: 'max-content 1fr',
        gap: '4px 14px',
        fontFamily: 'var(--f-body)',
        fontSize: 13,
        color: 'var(--ink)',
      }}
    >
      {rows.map(({ k, v }) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 11,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--ink-dim)',
            }}
          >
            {k}
          </dt>
          <dd style={{ margin: 0, color: 'var(--ink)' }}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Quote({ text, label }: { text: string; label: string }) {
  if (!text) return null;
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <div
        style={{
          fontFamily: 'var(--f-body)',
          fontSize: 14,
          lineHeight: 1.55,
          color: 'var(--ink-dim)',
          borderLeft: '2px solid var(--teal-deep)',
          paddingLeft: 14,
        }}
      >
        {text}
      </div>
    </div>
  );
}

function filtersToRows(filters: Record<string, string | number | boolean>): Array<{
  k: string;
  v: string;
}> {
  return Object.entries(filters)
    .filter(([, v]) => v !== '' && v !== 0 && v !== undefined && v !== null && v !== false)
    .map(([k, v]) => ({ k, v: String(v) }));
}

// ─── Loader ───────────────────────────────────────────────────────

async function loadShared(token: string): Promise<PublicRuleView | null> {
  const admin = createServerSupabase();
  const { data, error } = await admin
    .from('user_notification_rules')
    .select('share_token, shared_at, name, rule_type, config, created_at')
    .eq('share_token', token)
    .maybeSingle();

  if (error || !data) return null;
  return redactRule(
    data as {
      share_token: string | null;
      shared_at: string | null;
      name: string | null;
      rule_type: string | null;
      config: unknown;
      created_at: string | null;
    },
  );
}
