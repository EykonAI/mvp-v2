import { createServerSupabase } from '@/lib/supabase-server';

// Moderation helpers (COMM B3): blocks + reports.

type SB = ReturnType<typeof createServerSupabase>;

export async function blockedByMe(supabase: SB, me: string): Promise<string[]> {
  const { data } = await supabase.from('comm_blocks').select('blocked_id').eq('blocker_id', me);
  return ((data as { blocked_id: string }[] | null) ?? []).map((r) => r.blocked_id);
}

// True if either user has blocked the other (used to forbid new DMs).
export async function isBlockedBetween(supabase: SB, a: string, b: string): Promise<boolean> {
  const { data } = await supabase
    .from('comm_blocks')
    .select('blocker_id, blocked_id')
    .in('blocker_id', [a, b])
    .in('blocked_id', [a, b])
    .limit(2);
  const rows = (data as { blocker_id: string; blocked_id: string }[] | null) ?? [];
  return rows.some(
    (r) => (r.blocker_id === a && r.blocked_id === b) || (r.blocker_id === b && r.blocked_id === a),
  );
}

// Self-contained (own client) — used by the profile page like isFollowing.
export async function isBlockedByMe(viewerId: string, targetId: string): Promise<boolean> {
  try {
    const supabase = createServerSupabase();
    const { data } = await supabase
      .from('comm_blocks')
      .select('blocked_id')
      .eq('blocker_id', viewerId)
      .eq('blocked_id', targetId)
      .maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

export async function blockUser(supabase: SB, me: string, target: string): Promise<boolean> {
  if (me === target) return false;
  await supabase
    .from('comm_blocks')
    .upsert({ blocker_id: me, blocked_id: target }, { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true });
  return true;
}

export async function unblockUser(supabase: SB, me: string, target: string): Promise<void> {
  await supabase.from('comm_blocks').delete().eq('blocker_id', me).eq('blocked_id', target);
}

const REPORT_TYPES = new Set(['user', 'message', 'room']);

export async function createReport(
  supabase: SB,
  reporter: string,
  targetType: string,
  targetId: string,
  reason: string,
): Promise<boolean> {
  if (!REPORT_TYPES.has(targetType) || !targetId) return false;
  const { error } = await supabase.from('comm_reports').insert({
    reporter_id: reporter,
    target_type: targetType,
    target_id: targetId,
    reason: reason.slice(0, 500) || null,
  });
  return !error;
}
