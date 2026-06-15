import { createServerSupabase } from '@/lib/supabase-server';

// Direct-message helpers (COMM B1). A DM is a comm_rooms row with
// kind='dm' and dm_key = sorted(uidA,uidB). All functions take the
// service-role client; the API routes enforce auth + membership.

type SB = ReturnType<typeof createServerSupabase>;

export interface DmMessage {
  id: string;
  author_id: string;
  body: string;
  created_at: string;
}
export interface DmParticipant {
  id: string;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
}
export interface DmThread {
  room_id: string;
  other: DmParticipant | null;
  last_body: string | null;
  last_at: string | null;
  unread: boolean;
}

export function dmKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export async function getOrCreateDm(supabase: SB, me: string, other: string): Promise<string | null> {
  if (me === other) return null;
  const key = dmKey(me, other);

  const { data: existing } = await supabase.from('comm_rooms').select('id').eq('dm_key', key).maybeSingle();
  let roomId = (existing as { id: string } | null)?.id ?? null;

  if (!roomId) {
    const { data: created, error } = await supabase
      .from('comm_rooms')
      .insert({ kind: 'dm', dm_key: key, created_by: me })
      .select('id')
      .single();
    if (error) {
      // unique-key race: re-fetch
      const { data: again } = await supabase.from('comm_rooms').select('id').eq('dm_key', key).maybeSingle();
      roomId = (again as { id: string } | null)?.id ?? null;
    } else {
      roomId = (created as { id: string }).id;
    }
  }
  if (!roomId) return null;

  await supabase
    .from('comm_room_members')
    .upsert([{ room_id: roomId, user_id: me }, { room_id: roomId, user_id: other }], {
      onConflict: 'room_id,user_id',
      ignoreDuplicates: true,
    });
  return roomId;
}

export async function isMember(supabase: SB, roomId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('comm_room_members')
    .select('user_id')
    .eq('room_id', roomId)
    .eq('user_id', userId)
    .maybeSingle();
  return !!data;
}

export async function loadMessages(supabase: SB, roomId: string, afterIso?: string): Promise<DmMessage[]> {
  let q = supabase
    .from('comm_messages')
    .select('id, author_id, body, created_at')
    .eq('room_id', roomId)
    .order('created_at', { ascending: true })
    .limit(200);
  if (afterIso) q = q.gt('created_at', afterIso);
  const { data } = await q;
  return (data as DmMessage[] | null) ?? [];
}

export async function markRead(supabase: SB, roomId: string, userId: string): Promise<void> {
  await supabase
    .from('comm_room_members')
    .update({ last_read_at: new Date().toISOString() })
    .eq('room_id', roomId)
    .eq('user_id', userId);
}

export async function otherParticipant(supabase: SB, roomId: string, me: string): Promise<DmParticipant | null> {
  const { data: members } = await supabase.from('comm_room_members').select('user_id').eq('room_id', roomId);
  const otherId = ((members as { user_id: string }[] | null) ?? []).map((m) => m.user_id).find((id) => id !== me);
  if (!otherId) return null;
  const { data: prof } = await supabase
    .from('user_profiles')
    .select('id, handle, display_name, avatar_url')
    .eq('id', otherId)
    .maybeSingle();
  return (prof as DmParticipant | null) ?? { id: otherId, handle: null, display_name: null, avatar_url: null };
}

interface MemberRow {
  room_id: string;
  last_read_at: string | null;
  comm_rooms: { kind: string } | { kind: string }[] | null;
}

export async function listThreads(supabase: SB, me: string): Promise<DmThread[]> {
  const { data: mems } = await supabase
    .from('comm_room_members')
    .select('room_id, last_read_at, comm_rooms!inner(kind)')
    .eq('user_id', me);

  const dmRooms = ((mems as MemberRow[] | null) ?? []).filter((r) => {
    const room = Array.isArray(r.comm_rooms) ? r.comm_rooms[0] : r.comm_rooms;
    return room?.kind === 'dm';
  });

  const threads: DmThread[] = [];
  for (const r of dmRooms) {
    const other = await otherParticipant(supabase, r.room_id, me);
    const { data: last } = await supabase
      .from('comm_messages')
      .select('body, created_at, author_id')
      .eq('room_id', r.room_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const lm = last as { body: string; created_at: string; author_id: string } | null;
    const unread = !!lm && lm.author_id !== me && (!r.last_read_at || lm.created_at > r.last_read_at);
    threads.push({ room_id: r.room_id, other, last_body: lm?.body ?? null, last_at: lm?.created_at ?? null, unread });
  }
  threads.sort((a, b) => (b.last_at ?? '').localeCompare(a.last_at ?? ''));
  return threads;
}
