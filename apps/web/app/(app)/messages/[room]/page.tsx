import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { CommChatShell } from '@/components/comm/CommChatShell';
import { getCurrentUser } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase-server';
import { isMember, loadMessages, otherParticipant, markRead } from '@/lib/comm/dm';
import { Thread } from '@/components/comm/Thread';

export const metadata: Metadata = { title: 'Message — eYKON.ai', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function ThreadPage({ params }: { params: { room: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/signin');

  const supabase = createServerSupabase();
  if (!(await isMember(supabase, params.room, user.id))) notFound();

  const [other, initial] = await Promise.all([
    otherParticipant(supabase, params.room, user.id),
    loadMessages(supabase, params.room, undefined, user.id),
  ]);
  await markRead(supabase, params.room, user.id);

  const otherName = other?.display_name || (other?.handle ? `@${other.handle}` : 'Analyst');
  const otherSlug = other?.handle ?? other?.id ?? '';

  return (
    <CommChatShell>
      <section style={{ maxWidth: 720, margin: '0 auto', padding: '24px', color: 'var(--ink)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <Link href="/messages" style={{ color: 'var(--ink-dim)', textDecoration: 'none', fontFamily: 'var(--f-mono)', fontSize: 12 }}>
            ← Messages
          </Link>
          <span style={{ color: 'var(--ink-faint)' }}>/</span>
          <Link href={`/u/${otherSlug}`} style={{ color: 'var(--ink)', textDecoration: 'none', fontWeight: 600 }} prefetch={false}>
            {otherName}
          </Link>
        </div>
        <Thread roomId={params.room} me={user.id} initial={initial} />
      </section>
    </CommChatShell>
  );
}
