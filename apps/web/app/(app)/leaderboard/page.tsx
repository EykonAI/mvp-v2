import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CommChatShell } from '@/components/comm/CommChatShell';
import { getCurrentUser } from '@/lib/auth/session';
import { loadLeaderboard, type LeaderboardEntry } from '@/lib/comm/leaderboard';

export const metadata: Metadata = {
  title: 'Leaderboard — eYKON.ai',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

const MIN_SAMPLE = 10; // matches the §9 engine's shown gate

export default async function LeaderboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/signin?next=/leaderboard');

  const entries = await loadLeaderboard(100);

  return (
    <CommChatShell>
      <section style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px 80px', color: 'var(--ink)' }}>
        <div className="eyebrow" style={{ color: 'var(--teal)' }}>·· Leaderboard ··</div>
        <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 28, marginTop: 8, marginBottom: 6 }}>
          Calibration leaderboard
        </h1>
        <p style={{ fontSize: 13, color: 'var(--ink-dim)', margin: '0 0 22px', lineHeight: 1.5 }}>
          Ranked by Brier-skill — how much better than the crowd a forecaster&rsquo;s resolved calls have
          been. You appear once {MIN_SAMPLE}+ of your calls resolve. Provable, not performative.
        </p>

        {entries.length === 0 ? (
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
            No ranked analysts yet — be the first.
            <br />
            Make calls from your{' '}
            <Link href="/me" style={{ color: 'var(--teal)', textDecoration: 'none' }}>
              profile
            </Link>
            ; once {MIN_SAMPLE} resolve, you&rsquo;ll appear here.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {entries.map((e) => (
              <Row key={e.authorId} e={e} isYou={e.authorId === user.id} />
            ))}
          </div>
        )}
      </section>
    </CommChatShell>
  );
}

function Row({ e, isYou }: { e: LeaderboardEntry; isYou: boolean }) {
  const name = e.displayName || (e.handle ? `@${e.handle}` : e.slug);
  const initial = name.replace(/^@/, '').charAt(0).toUpperCase() || '?';
  const topThree = e.rank <= 3;
  return (
    <Link
      href={`/u/${e.slug}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px',
        borderRadius: 8,
        textDecoration: 'none',
        border: isYou ? '1px solid var(--teal-dim)' : '1px solid var(--rule-soft)',
        background: isYou ? 'var(--teal-glow)' : 'var(--bg-panel)',
      }}
    >
      <span
        style={{
          width: 26,
          textAlign: 'right',
          fontFamily: 'var(--f-mono)',
          fontSize: 13,
          fontWeight: topThree ? 700 : 400,
          color: topThree ? 'var(--teal)' : 'var(--ink-faint)',
        }}
      >
        {e.rank}
      </span>

      <span
        aria-hidden
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--f-display)',
          fontSize: 14,
          color: 'var(--ink-dim)',
          border: '1px solid var(--rule)',
          background: e.avatarUrl ? `center/cover no-repeat url("${e.avatarUrl}")` : 'var(--bg-raised)',
        }}
      >
        {e.avatarUrl ? '' : initial}
      </span>

      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              color: 'var(--ink)',
              fontSize: 14,
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {name}
          </span>
          {e.isFoundingAnalyst && (
            <span title="Founding analyst" style={{ color: 'var(--teal)', fontSize: 10 }}>
              ★
            </span>
          )}
          {isYou && (
            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--teal)', letterSpacing: '0.12em' }}>
              YOU
            </span>
          )}
        </span>
        <span
          style={{
            display: 'block',
            fontFamily: 'var(--f-mono)',
            fontSize: 10.5,
            color: 'var(--ink-faint)',
            marginTop: 2,
          }}
        >
          {pctRank(e.percentile)} · {e.nResolved} resolved
        </span>
      </span>

      <span style={{ textAlign: 'right', flexShrink: 0 }}>
        <span style={{ display: 'block', fontFamily: 'var(--f-mono)', fontSize: 15, fontWeight: 600, color: 'var(--teal)' }}>
          {fmtSkill(e.brierSkill)}
        </span>
        <span style={{ display: 'block', fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--ink-faint)', letterSpacing: '0.08em' }}>
          BRIER-SKILL
        </span>
      </span>
    </Link>
  );
}

function fmtSkill(v: number): string {
  const r = Math.round(v * 100) / 100;
  return `${r > 0 ? '+' : ''}${r.toFixed(2)}`;
}

function pctRank(percentile: number | null): string {
  if (percentile == null) return '—';
  const top = Math.max(1, Math.round((1 - percentile) * 100));
  return `Top ${top}%`;
}
