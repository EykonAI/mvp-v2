import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import TopNav from '@/components/TopNav';
import { getCurrentUser } from '@/lib/auth/session';
import { loadRadar, type RadarItem, type RadarCall, type RadarAuthor } from '@/lib/comm/radar';

export const metadata: Metadata = {
  title: 'Radar — eYKON.ai',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

export default async function RadarPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/signin?next=/radar');

  const { followingCount, items } = await loadRadar(user.id, 40);

  return (
    <>
      <TopNav />
      <section style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px 80px', color: 'var(--ink)' }}>
        <div className="eyebrow" style={{ color: 'var(--teal)' }}>·· Radar ··</div>
        <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 28, marginTop: 8, marginBottom: 6 }}>
          Your radar
        </h1>
        <p style={{ fontSize: 13, color: 'var(--ink-dim)', margin: '0 0 22px', lineHeight: 1.5 }}>
          Calls and notes from the analysts you follow, newest first.
        </p>

        {followingCount === 0 ? (
          <EmptyBox>
            You&rsquo;re not following anyone yet.
            <br />
            Find sharp forecasters on the{' '}
            <Link href="/leaderboard" style={teal}>
              leaderboard
            </Link>{' '}
            and follow them to build your radar.
          </EmptyBox>
        ) : items.length === 0 ? (
          <EmptyBox>
            Quiet so far — the {followingCount} analyst{followingCount === 1 ? '' : 's'} you follow
            haven&rsquo;t posted calls or notes yet.
          </EmptyBox>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((item) => (
              <RadarCard key={`${item.kind}:${item.id}`} item={item} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

const teal = { color: 'var(--teal)', textDecoration: 'none' } as const;

function EmptyBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 28,
        textAlign: 'center',
        border: '1px dashed var(--rule)',
        borderRadius: 8,
        color: 'var(--ink-faint)',
        fontSize: 13,
        lineHeight: 1.7,
      }}
    >
      {children}
    </div>
  );
}

function RadarCard({ item }: { item: RadarItem }) {
  return (
    <Link
      href={`/u/${item.author.slug}`}
      style={{
        display: 'block',
        padding: '13px 15px',
        borderRadius: 8,
        textDecoration: 'none',
        border: '1px solid var(--rule-soft)',
        background: 'var(--bg-panel)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <Avatar author={item.author} />
        <span
          style={{
            color: 'var(--ink)',
            fontSize: 13,
            fontWeight: 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.author.name}
        </span>
        <KindChip kind={item.kind} />
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--ink-faint)', flexShrink: 0 }}>
          {fmtWhen(item.ts)}
        </span>
      </div>

      {item.kind === 'call' ? (
        <CallBody c={item} />
      ) : (
        <p style={{ color: 'var(--ink)', fontSize: 14, lineHeight: 1.5, margin: 0, whiteSpace: 'pre-wrap' }}>
          {item.body}
        </p>
      )}
    </Link>
  );
}

function CallBody({ c }: { c: RadarCall }) {
  const future = c.resolvesAt != null && new Date(c.resolvesAt).getTime() > Date.now();
  return (
    <>
      <p style={{ color: 'var(--ink)', fontSize: 14, lineHeight: 1.5, margin: 0 }}>
        {c.statement ?? <span style={{ color: 'var(--ink-faint)' }}>(sealed call)</span>}
      </p>
      <div
        style={{
          marginTop: 6,
          fontFamily: 'var(--f-mono)',
          fontSize: 10.5,
          color: 'var(--ink-dim)',
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        {c.predictedMean != null && <span>p = {Math.round(c.predictedMean * 100)}%</span>}
        {c.status === 'resolved' ? (
          <span style={{ color: 'var(--teal)' }}>
            resolved{c.brier != null ? ` · Brier ${c.brier.toFixed(2)}` : ''}
          </span>
        ) : (
          <span>{future ? `resolves ${fmtDate(c.resolvesAt!)}` : 'open'}</span>
        )}
      </div>
    </>
  );
}

function KindChip({ kind }: { kind: 'call' | 'note' }) {
  const isCall = kind === 'call';
  return (
    <span
      style={{
        fontFamily: 'var(--f-mono)',
        fontSize: 9,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        padding: '2px 6px',
        borderRadius: 3,
        flexShrink: 0,
        color: isCall ? 'var(--teal)' : 'var(--ink-dim)',
        border: `1px solid ${isCall ? 'var(--teal-dim)' : 'var(--rule)'}`,
      }}
    >
      {isCall ? 'Call' : 'Note'}
    </span>
  );
}

function Avatar({ author }: { author: RadarAuthor }) {
  const initial = author.name.replace(/^@/, '').charAt(0).toUpperCase() || '?';
  return (
    <span
      aria-hidden
      style={{
        width: 28,
        height: 28,
        borderRadius: '50%',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--f-display)',
        fontSize: 12,
        color: 'var(--ink-dim)',
        border: '1px solid var(--rule)',
        background: author.avatarUrl ? `center/cover no-repeat url("${author.avatarUrl}")` : 'var(--bg-raised)',
      }}
    >
      {author.avatarUrl ? '' : initial}
    </span>
  );
}

function fmtWhen(iso: string): string {
  const then = new Date(iso).getTime();
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return fmtDate(iso);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
