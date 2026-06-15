import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import TopNav from '@/components/TopNav';
import { getCurrentUser } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase-server';
import { listRooms } from '@/lib/comm/rooms';
import { RoomCreate } from '@/components/comm/RoomCreate';

export const metadata: Metadata = { title: 'Rooms — eYKON.ai', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function RoomsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/signin');

  const supabase = createServerSupabase();
  const rooms = await listRooms(supabase, user.id);

  return (
    <>
      <TopNav />
      <section style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px 80px', color: 'var(--ink)' }}>
        <div className="eyebrow" style={{ color: 'var(--teal)' }}>·· Rooms ··</div>
        <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 28, marginTop: 8, marginBottom: 16 }}>Group rooms</h1>

        <RoomCreate />

        {rooms.length === 0 ? (
          <div style={{ padding: 28, textAlign: 'center', border: '1px dashed var(--rule)', borderRadius: 8, color: 'var(--ink-faint)', fontSize: 13 }}>
            No rooms yet — create the first one above.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {rooms.map((r) => (
              <Link
                key={r.id}
                href={`/rooms/${r.id}`}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 8, textDecoration: 'none', border: '1px solid var(--rule-soft)', background: 'var(--bg-panel)' }}
              >
                <span style={{ color: 'var(--ink)', fontSize: 14, fontWeight: 600 }}>{r.title ?? 'Untitled room'}</span>
                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--ink-faint)' }}>
                  {r.member_count} member{r.member_count === 1 ? '' : 's'}
                  {r.is_member ? ' · joined' : ''}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
