import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CommChatShell } from '@/components/comm/CommChatShell';
import { getCurrentUser } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase-server';
import { listThreads } from '@/lib/comm/dm';

export const metadata: Metadata = { title: 'Messages — eYKON.ai', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function MessagesPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/signin');

  const supabase = createServerSupabase();
  const threads = await listThreads(supabase, user.id);

  return (
    <CommChatShell>
      <section style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px 80px', color: 'var(--ink)' }}>
        <div className="eyebrow" style={{ color: 'var(--teal)' }}>·· Messages ··</div>
        <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 28, marginTop: 8, marginBottom: 20 }}>Direct messages</h1>

        {threads.length === 0 ? (
          <div style={{ padding: 28, textAlign: 'center', border: '1px dashed var(--rule)', borderRadius: 8, color: 'var(--ink-faint)', fontSize: 13 }}>
            No conversations yet. Open someone’s profile and hit Message to start one.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {threads.map((t) => {
              const name = t.other?.display_name || (t.other?.handle ? `@${t.other.handle}` : 'Analyst');
              return (
                <Link
                  key={t.room_id}
                  href={`/messages/${t.room_id}`}
                  style={{ display: 'flex', gap: 12, padding: '12px 14px', borderRadius: 8, textDecoration: 'none', border: '1px solid var(--rule-soft)', background: 'var(--bg-panel)', alignItems: 'center' }}
                >
                  <div
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: '50%',
                      flexShrink: 0,
                      border: '1px solid var(--rule)',
                      background: t.other?.avatar_url ? `center/cover no-repeat url("${t.other.avatar_url}")` : 'var(--bg-raised)',
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                      <span style={{ color: 'var(--ink)', fontSize: 14, fontWeight: 600 }}>
                        {name}
                        {t.unread ? (
                          <span style={{ marginLeft: 8, width: 7, height: 7, borderRadius: '50%', background: 'var(--teal)', display: 'inline-block' }} />
                        ) : null}
                      </span>
                      <span style={{ color: 'var(--ink-faint)', fontFamily: 'var(--f-mono)', fontSize: 10 }}>
                        {t.last_at ? t.last_at.slice(0, 10) : ''}
                      </span>
                    </div>
                    <div style={{ color: 'var(--ink-dim)', fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.last_body ?? 'No messages yet'}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </CommChatShell>
  );
}
