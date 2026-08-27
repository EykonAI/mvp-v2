import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { isFounder } from '@/lib/admin/access';
import { createServerSupabase } from '@/lib/supabase-server';
import { listDrafts, countPendingDrafts, type ReviewDraft } from '@/lib/newsjack/store';
import Link from 'next/link';
import NewsjackActions from './Actions';
import Filters from './Filters';
import { parseFacets, filterDrafts, buildGroups, activeCount } from '@/lib/newsjack/review-filters';

export const metadata: Metadata = { title: 'Newsjack review — eYKON.ai', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

// The queue reads a WINDOW, not the table. Facet counts are computed over
// exactly this many rows and the bar says so, because a count whose
// population is unstated is the same defect as a metric with no window.
// Raise it when six channels per event make 400 rows cover too few days.
const SCAN = 400;
// Rendering is capped separately: 400 cards is a slow page and nobody
// reviews 400 drafts in one sitting. The bar reports both numbers.
const SHOW = 60;

const windowNote: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--amber)',
  marginBottom: 14,
  maxWidth: 620,
};

const emptyBox: React.CSSProperties = {
  padding: 28,
  textAlign: 'center',
  border: '1px dashed var(--rule)',
  borderRadius: 8,
  color: 'var(--ink-faint)',
  fontSize: 13,
};

const STATUS_COLOR: Record<string, string> = {
  draft: 'var(--teal)',
  blocked: 'var(--amber)',
  approved: 'var(--teal)',
  published: 'var(--ink-faint)',
  rejected: 'var(--ink-faint)',
};

export default async function NewsjackReviewPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/signin?next=/admin/newsjack');
  if (!isFounder(user)) redirect('/app');

  const supabase = createServerSupabase();
  const [all, pendingTotal] = await Promise.all([
    listDrafts(supabase, SCAN),
    countPendingDrafts(supabase),
  ]);
  const facets = parseFacets(searchParams);
  const groups = buildGroups(all, facets);
  const matched = filterDrafts(all, facets);
  const drafts = matched.slice(0, SHOW);
  // The headline stays the count of everything pending, on every channel,
  // regardless of the filter. It is the number the founder came here for,
  // and making it move with the chips would turn a workload into a
  // reflection of whatever was clicked last.
  // Pending WITHIN the scanned window — used only to tell the founder how
  // much of the backlog this page is actually showing.
  const pendingInWindow = all.filter((d) => d.event_status === 'drafted' && d.status === 'draft').length;
  const hidden = pendingTotal === null ? 0 : Math.max(0, pendingTotal - pendingInWindow);

  return (
    <>
      <section style={{ maxWidth: 820, margin: '0 auto', padding: '40px 24px 80px', color: 'var(--ink)' }}>
        <div className="eyebrow" style={{ color: 'var(--teal)' }}>·· Admin · Newsjack review ··</div>
        <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 28, marginTop: 8, marginBottom: 6 }}>
          Drafts ({pendingTotal ?? '—'} pending)
        </h1>
        {hidden > 0 && (
          <p style={windowNote}>
            This page reads the {SCAN} most recent drafts, which covers {pendingInWindow} of them —
            {' '}{hidden} older pending draft{hidden === 1 ? '' : 's'} {hidden === 1 ? 'is' : 'are'} outside the window
            and {hidden === 1 ? 'is' : 'are'} not counted in the chips below.
          </p>
        )}
        <p style={{ fontSize: 13, color: 'var(--ink-dim)', marginBottom: 24, maxWidth: 620 }}>
          Each draft is auto-built from a live anomaly and has already passed the voice, coverage and value gates.
          Approve to publish (or copy and post manually). Blocked drafts show why; nothing here has gone public.
        </p>
        <p style={{ fontSize: 13, color: 'var(--ink-dim)', marginBottom: 24 }}>
          <Link href="/admin/newsjack/recompose" style={{ color: 'var(--teal)' }}>
            Dry-run recompose
          </Link>{' '}
          — re-write recent drafts through the copywriter and compare, without changing anything here.
        </p>

        {all.length > 0 && (
          <Filters
            groups={groups}
            facets={facets}
            showing={drafts.length}
            matched={matched.length}
            scanned={all.length}
            scanCapped={all.length === SCAN}
          />
        )}

        {all.length === 0 ? (
          <div style={emptyBox}>
            No drafts yet. The newsjack-detect cron writes here when a fresh, high-severity anomaly fires.
          </div>
        ) : drafts.length === 0 ? (
          <div style={emptyBox}>
            No draft matches this filter.{' '}
            <Link href="/admin/newsjack" style={{ color: 'var(--teal)' }}>
              Clear {activeCount(facets)} filter{activeCount(facets) === 1 ? '' : 's'}
            </Link>{' '}
            to see all {all.length}.
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
        <span style={{ ...meta, color: 'var(--ink-dim)' }}>{d.channel}</span>
        <span style={meta}>{d.severity ?? '?'} · {d.domain ?? '?'}</span>
        <span style={meta}>{d.region ?? 'unknown region'}</span>
        {!d.covered && <span style={{ ...meta, color: 'var(--amber)' }}>analytical (not live-covered)</span>}
        <span style={{ ...meta, color: d.value_pass ? 'var(--teal)' : 'var(--amber)' }}>value {d.value_pass ? 'pass' : 'fail'}</span>
        {d.revision > 0 && (
          <span
            style={{ ...meta, color: 'var(--teal)' }}
            title={`recomposed from draft ${d.supersedes_draft_id ?? 'unknown'} — the original is still in this list`}
          >
            rev {d.revision}
          </span>
        )}
        {d.composer && (
          <span
            style={{ ...meta, color: d.composer === 'agent' ? 'var(--teal)' : 'var(--ink-faint)' }}
            title={
              d.composer === 'agent'
                ? `written by the copywriter · ${d.composer_model ?? 'model unknown'} · codex ${d.codex_version ?? '?'}`
                : 'written by the deterministic template'
            }
          >
            {d.composer === 'agent' ? 'agent' : 'template'}
          </span>
        )}
        <span style={{ ...meta, marginLeft: 'auto' }}>{d.created_at.slice(0, 16).replace('T', ' ')}</span>
      </div>

      {d.event_status === 'blocked' && d.blocked_reason && (
        <div style={{ fontSize: 12, color: 'var(--amber)', marginBottom: 10 }}>Blocked: {d.blocked_reason}</div>
      )}

      {/* The fallback alarm. The agent silently reverting to the template
          on every run is indistinguishable from the agent working, unless
          the reason is shown. Three of these in a row means it is down. */}
      {d.fallback_reason && (
        <div style={{ fontSize: 12, color: 'var(--amber)', marginBottom: 10 }}>
          Copywriter fell back to the template: {d.fallback_reason}
        </div>
      )}

      {d.first_attempt_violations.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--ink-dim)', marginBottom: 10 }}>
          Retried — first attempt failed: {d.first_attempt_violations.join(' · ')}
        </div>
      )}

      {d.craft_warnings.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--ink-dim)', marginBottom: 10 }}>
          Craft notes: {d.craft_warnings.join(' · ')}
        </div>
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
        <NewsjackActions draftId={d.draft_id} posts={d.posts} channel={d.channel} />
      ) : (
        <div style={{ ...meta, marginTop: 10 }}>{d.status}</div>
      )}
    </div>
  );
}
