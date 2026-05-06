import { notFound } from 'next/navigation';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { createServerSupabase } from '@/lib/supabase-server';
import { isValidShareToken } from '@/lib/share';
import { redactAnalystRow, type PublicAnalystView } from '@/lib/share/redact';
import { AttributionCapture } from '@/components/referral/AttributionCapture';
import { EYKON_REF_COOKIE, isValidPublicId } from '@/lib/referral/attribution';

// /analyst/{share_token} — public, unauthenticated view of an AI
// Analyst conversation that the owner explicitly shared. The row's
// share_token field is the access key; revoking just NULLs it.
//
// Read happens via the service-role client because anonymous viewers
// have no RLS path into user_queries (the table is "self read"
// scoped per migration 021). Service-role bypasses RLS; the
// share_token = $1 lookup is the access control.
//
// Mounts <AttributionCapture artifactType="A2"> so the recipient's
// arrival via the shared link logs into attribution_events and
// (if they're authenticated free-tier with no prior attribution)
// lands the eykon_ref pointer on their referred_by_pending column.

export const dynamic = 'force-dynamic';

type Params = { params: { token: string } };

export default async function AnalystSharePage({ params }: Params) {
  if (!isValidShareToken(params.token)) {
    notFound();
  }

  const view = await loadShared(params.token);
  if (!view) notFound();

  const ref = cookies().get(EYKON_REF_COOKIE)?.value;
  const refParam = isValidPublicId(ref) ? `?ref=${ref}` : '';
  const ctaHref = `/auth/signup${refParam}`;

  return (
    <article
      style={{
        maxWidth: 760,
        margin: '0 auto',
        padding: '40px 24px 64px',
      }}
    >
      <AttributionCapture artifactType="A2" artifactId={view.share_token} />

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
          AI Analyst conversation · shared
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
          {view.query_text}
        </h1>
        {view.domain_tags.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
            {view.domain_tags.map((tag) => (
              <span
                key={tag}
                style={{
                  fontFamily: 'var(--f-mono)',
                  fontSize: 9,
                  letterSpacing: '0.05em',
                  color: 'var(--ink-dim)',
                  background: 'var(--bg-raised)',
                  border: '1px solid var(--rule)',
                  borderRadius: 2,
                  padding: '2px 6px',
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </header>

      <section
        style={{
          fontFamily: 'var(--f-body)',
          fontSize: 14,
          lineHeight: 1.6,
          color: 'var(--ink)',
          whiteSpace: 'pre-wrap',
        }}
      >
        {view.response_text}
      </section>

      {view.tool_calls.length > 0 && (
        <section style={{ marginTop: 32 }}>
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
            Tool calls
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
            {view.tool_calls.map((c, i) => (
              <li
                key={i}
                style={{
                  fontFamily: 'var(--f-mono)',
                  fontSize: 11,
                  color: 'var(--ink-dim)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  borderBottom: '1px solid var(--rule-soft)',
                  padding: '4px 0',
                }}
              >
                <span style={{ color: 'var(--teal)' }}>{c.name}</span>
                <span>{c.row_count == null ? '—' : `${c.row_count} rows`}</span>
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
            Run your own analyst conversations.
          </div>
          <div
            style={{
              fontFamily: 'var(--f-body)',
              fontSize: 12,
              color: 'var(--ink-dim)',
            }}
          >
            eYKON.ai is the geopolitical intelligence platform behind this view.
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

async function loadShared(token: string): Promise<PublicAnalystView | null> {
  const admin = createServerSupabase();
  const { data, error } = await admin
    .from('user_queries')
    .select('share_token, shared_at, query_text, response_text, tool_calls, domain_tags, last_run_at')
    .eq('share_token', token)
    .maybeSingle();

  if (error || !data) return null;
  return redactAnalystRow(
    data as {
      share_token: string | null;
      shared_at: string | null;
      query_text: string | null;
      response_text: string | null;
      tool_calls: unknown;
      domain_tags: string[] | null;
      last_run_at: string | null;
    },
  );
}
