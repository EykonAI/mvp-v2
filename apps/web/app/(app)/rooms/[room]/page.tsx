import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import TopNav from '@/components/TopNav';
import { getCurrentUser } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase-server';
import { loadRoom } from '@/lib/comm/rooms';
import { loadMessages, markRead } from '@/lib/comm/dm';
import { Thread } from '@/components/comm/Thread';
import { JoinRoomButton } from '@/components/comm/JoinRoomButton';
import { AskAnalyst } from '@/components/comm/AskAnalyst';
import { getAnalystId } from '@/lib/comm/analyst';

export const metadata: Metadata = { title: 'Room — eYKON.ai', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function RoomPage({ params }: { params: { room: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/signin');

  const supabase = createServerSupabase();
  const room = await loadRoom(supabase, params.room, user.id);
  if (!room) notFound();

  const initial = room.is_member ? await loadMessages(supabase, params.room, undefined, user.id) : [];
  if (room.is_member) await markRead(supabase, params.room, user.id);
  const analystId = getAnalystId();

  return (
    <>
      <TopNav />
      <section style={{ maxWidth: 720, margin: '0 auto', padding: '24px', color: 'var(--ink)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <Link href="/rooms" style={{ color: 'var(--ink-dim)', textDecoration: 'none', fontFamily: 'var(--f-mono)', fontSize: 12 }}>
            ← Rooms
          </Link>
          <span style={{ color: 'var(--ink-faint)' }}>/</span>
          <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{room.title ?? 'Untitled room'}</span>
          <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--ink-faint)' }}>
            · {room.member_count} member{room.member_count === 1 ? '' : 's'}
          </span>
        </div>

        {room.is_member ? (
          <>
            <Thread roomId={room.id} me={user.id} initial={initial} analystId={analystId ?? undefined} />
            {analystId && <AskAnalyst roomId={room.id} />}
          </>
        ) : (
          <div style={{ padding: 28, textAlign: 'center', border: '1px dashed var(--rule)', borderRadius: 8 }}>
            <p style={{ color: 'var(--ink-dim)', fontSize: 13, marginBottom: 14 }}>Join to see the conversation and post.</p>
            <JoinRoomButton roomId={room.id} />
          </div>
        )}
      </section>
    </>
  );
}
