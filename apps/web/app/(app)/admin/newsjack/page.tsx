import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import TopNav from '@/components/TopNav';
import { getCurrentUser } from '@/lib/auth/session';
import { isFounder } from '@/lib/admin/access';
import { createServerSupabase } from '@/lib/supabase-server';
import { listDrafts, type ReviewDraft } from '@/lib/newsjack/store';
import NewsjackActions from './Actions';

export const metadata: Metadata = { title: 'Newsjack review — eYKON.ai', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const STATUS_COLOR: Record<string, string> = {
  draft: 'var(--teal)',
  blocked: 'var(--amber)',
  approved: 'var(--teal)',
  published: 'var(--ink-faint)',
  rejected: 'var(--ink-faint)',
};

export default async function NewsjackReviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/signin?next=/admin/newsjack');
  if (!isFounder(user)) redirect('/app');

  const supabase = createServerSupabase();
  const drafts = await listDrafts(supabase, 50);
  const pending = drafts.filter((d) => d.event_status === 'drafted' && d.status === 'draft');

  return (
    <>
      <TopNav />
      <section style={{ maxWidth: 820, margin: '0 auto', padding: '40px 24px 80px', color: 'var(--ink)' }}>
        <div className="eyebrow" style={{ color: 'var(--teal)' }}>·· Admin · Newsjack review ··</div>
        <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 28, marginTop: 8, marginBottom: 6 }}>
          Drafts ({pending.length} pending)
        </h1>
        <p style={{ fontSize: 13, color: 'var(--ink-dim)', marginBottom: 24, maxWidth: 620 }}>
          Each draft is auto-built from a live anomaly and has already passed the voice, coverage and value gates.
          Approve to publish (or copy and post manually). Blocked drafts show why; nothing here has gone public.
        </p>

        {drafts.length === 0 ? (
          <div style={{ padding: 28, textAlign: 'center', border: '1px dashed var(--rule)', borderRadius: 8, color: 'var(--ink-faint)', fontSize: 13 }}>
            No drafts yet. The newsjack-detect cron writes here when a fresh, high-severity anomaly fires.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {drafts.map((d) => (
              <DraftCard key={d.draft_id} d={d} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function DraftCard({ d }: { d: ReviewDraft }) {
  const meta: React.CSSProperties = { fontFamily: 'var(--f-mono)', fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-faint)' };
  const isPending = d.event_status === 'drafted' && d.status === 'draft';
  return (
    <div style={{ border: '1px solid var(--rule)', borderRadius: 10, padding: '16px 18px', background: 'var(--surface, transparent)' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ ...meta, color: STATUS_COLOR[d.event_status] ?? 'var(--ink-faint)' }}>{d.event_status}</span>
        <span style={meta}>{d.severity ?? '?'} · {d.domain ?? '?'}</span>
        <span style={meta}>{d.region ?? 'unknown region'}</span>
        {!d.covered && <span style={{ ...meta, color: 'var(--amber)' }}>analytical (not live-covered)</span>}
        <span style={{ ...meta, color: d.value_pass ? 'var(--teal)' : 'var(--amber)' }}>value {d.value_pass ? 'pass' : 'fail'}</span>
        <span style={{ ...meta, marginLeft: 'auto' }}>{d.created_at.slice(0, 16).replace('T', ' ')}</span>
      </div>

      {d.event_status === 'blocked' && d.blocked_reason && (
        <div style={{ fontSize: 12, color: 'var(--amber)', marginBottom: 10 }}>Blocked: {d.blocked_reason}</div>
      )}

      <ol style={{ listStyle: 'decimal', paddingLeft: 20, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {d.posts.map((p, i) => (
          <li key={i} style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink)' }}>{p}</li>
        ))}
      </ol>

      {d.ref_url && (
        <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--ink-dim)', marginTop: 10, wordBreak: 'break-all' }}>{d.ref_url}</div>
      )}

      {isPending ? (
        <NewsjackActions draftId={d.draft_id} posts={d.posts} />
      ) : (
        <div style={{ ...meta, marginTop: 10 }}>{d.status}</div>
      )}
    </div>
  );
}
