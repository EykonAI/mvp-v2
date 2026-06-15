import { createServerSupabase } from '@/lib/supabase-server';

// Group rooms (COMM B2). A room is a comm_rooms row with kind='room';
// membership + messages reuse comm_room_members / comm_messages and the
// /api/comm/dm/messages endpoint (membership-checked, room-agnostic).

type SB = ReturnType<typeof createServerSupabase>;
const TITLE_MAX = 80;

export interface RoomSummary {
  id: string;
  title: string | null;
  member_count: number;
  is_member: boolean;
  created_at: string | null;
  event_spawned: boolean;
}
export interface RoomDetail {
  id: string;
  title: string | null;
  is_member: boolean;
  member_count: number;
}

export async function listRooms(supabase: SB, me: string): Promise<RoomSummary[]> {
  const { data: rooms } = await supabase
    .from('comm_rooms')
    .select('id, title, created_at, source_event_kind')
    .eq('kind', 'room')
    .order('created_at', { ascending: false })
    .limit(100);
  const list =
    (rooms as
      | { id: string; title: string | null; created_at: string | null; source_event_kind: string | null }[]
      | null) ?? [];
  if (list.length === 0) return [];

  const ids = list.map((r) => r.id);
  const { data: mems } = await supabase.from('comm_room_members').select('room_id, user_id').in('room_id', ids);
  const memRows = (mems as { room_id: string; user_id: string }[] | null) ?? [];

  const countByRoom = new Map<string, number>();
  const mineByRoom = new Set<string>();
  for (const m of memRows) {
    countByRoom.set(m.room_id, (countByRoom.get(m.room_id) ?? 0) + 1);
    if (m.user_id === me) mineByRoom.add(m.room_id);
  }

  return list.map((r) => ({
    id: r.id,
    title: r.title,
    created_at: r.created_at,
    member_count: countByRoom.get(r.id) ?? 0,
    is_member: mineByRoom.has(r.id),
    event_spawned: r.source_event_kind != null,
  }));
}

export async function createRoom(supabase: SB, me: string, title: string): Promise<string | null> {
  const t = title.trim().slice(0, TITLE_MAX);
  if (!t) return null;
  const { data, error } = await supabase
    .from('comm_rooms')
    .insert({ kind: 'room', title: t, created_by: me })
    .select('id')
    .single();
  if (error || !data) return null;
  const roomId = (data as { id: string }).id;
  await supabase
    .from('comm_room_members')
    .upsert({ room_id: roomId, user_id: me }, { onConflict: 'room_id,user_id', ignoreDuplicates: true });
  return roomId;
}

export async function joinRoom(supabase: SB, me: string, roomId: string): Promise<boolean> {
  const { data: room } = await supabase.from('comm_rooms').select('id, kind').eq('id', roomId).maybeSingle();
  if (!room || (room as { kind: string }).kind !== 'room') return false;
  await supabase
    .from('comm_room_members')
    .upsert({ room_id: roomId, user_id: me }, { onConflict: 'room_id,user_id', ignoreDuplicates: true });
  return true;
}

export async function loadRoom(supabase: SB, roomId: string, me: string): Promise<RoomDetail | null> {
  const { data: room } = await supabase.from('comm_rooms').select('id, title, kind').eq('id', roomId).maybeSingle();
  if (!room || (room as { kind: string }).kind !== 'room') return null;
  const { data: mems } = await supabase.from('comm_room_members').select('user_id').eq('room_id', roomId);
  const memRows = (mems as { user_id: string }[] | null) ?? [];
  return {
    id: roomId,
    title: (room as { title: string | null }).title,
    member_count: memRows.length,
    is_member: memRows.some((m) => m.user_id === me),
  };
}

// Idempotently ensure a room exists for a given source event (COMM D2).
// Returns the room id + whether it was newly created. The spawn cron runs
// single-threaded, so a check-then-insert is race-free here; the partial
// unique index on (source_event_kind, source_event_id) is the backstop.
// created_by stays NULL — these are ownerless, system-spawned rooms.
export async function ensureEventRoom(
  supabase: SB,
  sourceKind: string,
  sourceId: string,
  title: string,
): Promise<{ id: string; created: boolean } | null> {
  const { data: existing } = await supabase
    .from('comm_rooms')
    .select('id')
    .eq('source_event_kind', sourceKind)
    .eq('source_event_id', sourceId)
    .maybeSingle();
  if (existing) return { id: (existing as { id: string }).id, created: false };

  const t = title.trim().slice(0, 120) || 'Live event';
  const { data, error } = await supabase
    .from('comm_rooms')
    .insert({ kind: 'room', title: t, source_event_kind: sourceKind, source_event_id: sourceId })
    .select('id')
    .single();
  if (error || !data) return null;
  return { id: (data as { id: string }).id, created: true };
}
