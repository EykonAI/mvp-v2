import { createServerSupabase } from '@/lib/supabase-server';
import { isFounder } from '@/lib/admin/access';
import { isMember } from '@/lib/comm/dm';

// Paid spaces (COMM E1 — scaffold, no payments). A space is a comm_rooms
// row with kind='space' plus comm_spaces metadata. Access = creator OR an
// active subscription; in E1 only the creator is a member (subscriptions
// arrive in E2 via Unlock Protocol). All reads use the service-role client.

type SB = ReturnType<typeof createServerSupabase>;

const TITLE_MAX = 80;
const BLURB_MAX = 280;
const MIN_PERCENTILE = 0.5; // must sit in the top half of the cohort to charge

// E2 checkout feature flag — gates the on-chain subscription path (enable +
// checkout). Off until the founder has runtime-tested on Base.
export function spacesCheckoutEnabled(): boolean {
  const v = (process.env.COMM_SPACES_CHECKOUT ?? '').toLowerCase();
  return v === 'on' || v === 'true' || v === '1';
}

export interface SpaceCreator {
  id: string;
  slug: string; // handle ?? public_id — the /u/<slug> route param
  name: string;
}
export interface SpaceSummary {
  id: string;
  title: string | null;
  blurb: string | null;
  price_usdc: number;
  cadence: string;
  creator: SpaceCreator | null;
  subscriber_count: number;
  is_creator: boolean;
  is_subscribed: boolean;
}
export interface SpaceDetail {
  id: string;
  title: string | null;
  blurb: string | null;
  price_usdc: number;
  cadence: string;
  creator: SpaceCreator | null;
  subscriber_count: number;
  is_creator: boolean;
  is_member: boolean; // creator or active subscriber (comm_room_members)
  lock_address: string | null;
}

interface SpaceRow {
  space_id: string;
  creator_id: string;
  price_usdc: number | string;
  cadence: string;
  blurb: string | null;
  status?: string;
  created_at?: string;
  lock_address?: string | null;
  comm_rooms: { title: string | null } | { title: string | null }[] | null;
}
interface ProfRow {
  id: string;
  handle: string | null;
  display_name: string | null;
  public_id: string | null;
}

function creatorFrom(p: ProfRow | undefined | null): SpaceCreator | null {
  if (!p) return null;
  const slug = p.handle ?? p.public_id;
  if (!slug) return null;
  return { id: p.id, slug, name: p.display_name || (p.handle ? `@${p.handle}` : slug) };
}
function roomTitle(row: SpaceRow): string | null {
  const room = Array.isArray(row.comm_rooms) ? row.comm_rooms[0] : row.comm_rooms;
  return room?.title ?? null;
}

// Reputation gate: who may open a paid space. The founder is always
// allowed (Phase-1 allowlist); otherwise the user needs a shown reputation
// (n_resolved >= MIN_SAMPLE) that beats the crowd and sits in the top half.
export async function canCreateSpace(
  supabase: SB,
  user: { id: string; email?: string | null },
): Promise<{ ok: boolean; reason: string }> {
  if (isFounder(user)) return { ok: true, reason: 'founder' };
  try {
    const { data } = await supabase
      .from('user_reputation')
      .select('brier_skill, rank_percentile')
      .eq('author_id', user.id)
      .eq('feature', '_all')
      .eq('shown', true)
      .maybeSingle();
    if (!data) {
      return { ok: false, reason: 'You need a shown calibration score (10+ resolved calls) to open a paid space.' };
    }
    const skill = Number((data as { brier_skill: number | null }).brier_skill ?? -1);
    const pct = Number((data as { rank_percentile: number | null }).rank_percentile ?? 0);
    if (skill >= 0 && pct >= MIN_PERCENTILE) return { ok: true, reason: 'calibrated' };
    return { ok: false, reason: 'Your calibration is not yet high enough to open a paid space.' };
  } catch {
    return { ok: false, reason: 'Reputation check is unavailable right now.' };
  }
}

export async function createSpace(
  supabase: SB,
  creatorId: string,
  input: { title: string; priceUsdc: number; cadence: 'monthly' | 'annual'; blurb?: string },
): Promise<string | null> {
  const title = input.title.trim().slice(0, TITLE_MAX);
  if (!title) return null;
  if (!Number.isFinite(input.priceUsdc) || input.priceUsdc < 0) return null;

  const { data: room, error: rErr } = await supabase
    .from('comm_rooms')
    .insert({ kind: 'space', title, created_by: creatorId })
    .select('id')
    .single();
  if (rErr || !room) return null;
  const spaceId = (room as { id: string }).id;

  const { error: sErr } = await supabase.from('comm_spaces').insert({
    space_id: spaceId,
    creator_id: creatorId,
    price_usdc: input.priceUsdc,
    cadence: input.cadence,
    blurb: input.blurb?.trim().slice(0, BLURB_MAX) || null,
  });
  if (sErr) {
    await supabase.from('comm_rooms').delete().eq('id', spaceId); // roll back the orphan room
    return null;
  }

  await supabase
    .from('comm_room_members')
    .upsert({ room_id: spaceId, user_id: creatorId }, { onConflict: 'room_id,user_id', ignoreDuplicates: true });
  return spaceId;
}

export async function listSpaces(supabase: SB, viewerId: string): Promise<SpaceSummary[]> {
  const { data } = await supabase
    .from('comm_spaces')
    .select('space_id, creator_id, price_usdc, cadence, blurb, created_at, comm_rooms!inner(title)')
    .eq('status', 'live')
    .order('created_at', { ascending: false })
    .limit(100);
  const rows = (data as SpaceRow[] | null) ?? [];
  if (rows.length === 0) return [];

  const spaceIds = rows.map((r) => r.space_id);
  const creatorIds = Array.from(new Set(rows.map((r) => r.creator_id)));

  const { data: profs } = await supabase
    .from('user_profiles')
    .select('id, handle, display_name, public_id')
    .in('id', creatorIds);
  const profById = new Map(((profs as ProfRow[] | null) ?? []).map((p) => [p.id, p]));

  const { data: subs } = await supabase
    .from('comm_space_subscriptions')
    .select('space_id, subscriber_id')
    .eq('status', 'active')
    .in('space_id', spaceIds);
  const subRows = (subs as { space_id: string; subscriber_id: string }[] | null) ?? [];
  const countBySpace = new Map<string, number>();
  const viewerSubbed = new Set<string>();
  for (const s of subRows) {
    countBySpace.set(s.space_id, (countBySpace.get(s.space_id) ?? 0) + 1);
    if (s.subscriber_id === viewerId) viewerSubbed.add(s.space_id);
  }

  return rows.map((r) => ({
    id: r.space_id,
    title: roomTitle(r),
    blurb: r.blurb,
    price_usdc: Number(r.price_usdc),
    cadence: r.cadence,
    creator: creatorFrom(profById.get(r.creator_id)),
    subscriber_count: countBySpace.get(r.space_id) ?? 0,
    is_creator: r.creator_id === viewerId,
    is_subscribed: viewerSubbed.has(r.space_id),
  }));
}

export async function loadSpace(supabase: SB, spaceId: string, viewerId: string): Promise<SpaceDetail | null> {
  const { data } = await supabase
    .from('comm_spaces')
    .select('space_id, creator_id, price_usdc, cadence, blurb, status, lock_address, comm_rooms!inner(title)')
    .eq('space_id', spaceId)
    .maybeSingle();
  if (!data) return null;
  const row = data as SpaceRow;

  const { data: prof } = await supabase
    .from('user_profiles')
    .select('id, handle, display_name, public_id')
    .eq('id', row.creator_id)
    .maybeSingle();

  const member = await isMember(supabase, spaceId, viewerId);
  const { count } = await supabase
    .from('comm_space_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('space_id', spaceId)
    .eq('status', 'active');

  return {
    id: spaceId,
    title: roomTitle(row),
    blurb: row.blurb,
    price_usdc: Number(row.price_usdc),
    cadence: row.cadence,
    creator: creatorFrom(prof as ProfRow | null),
    subscriber_count: count ?? 0,
    is_creator: row.creator_id === viewerId,
    is_member: member,
    lock_address: row.lock_address ?? null,
  };
}

// ── E2 plumbing (no payments) ───────────────────────────────────

// Grant (or renew) an active subscription + room membership. The E2
// checkout-confirmation path calls this once a key purchase is verified.
// Idempotent per (space, subscriber). Granting membership is what makes the
// existing Thread / message API / in-room analyst work for the subscriber.
export async function grantSubscription(
  supabase: SB,
  spaceId: string,
  subscriberId: string,
  opts: { providerRef?: string; amountUsdc?: number; startedAt?: string; expiresAt?: string } = {},
): Promise<boolean> {
  const { error } = await supabase.from('comm_space_subscriptions').upsert(
    {
      space_id: spaceId,
      subscriber_id: subscriberId,
      status: 'active',
      provider_ref: opts.providerRef ?? null,
      amount_usdc: opts.amountUsdc ?? null,
      started_at: opts.startedAt ?? new Date().toISOString(),
      expires_at: opts.expiresAt ?? null,
    },
    { onConflict: 'space_id,subscriber_id' },
  );
  if (error) return false;
  await supabase
    .from('comm_room_members')
    .upsert({ room_id: spaceId, user_id: subscriberId }, { onConflict: 'room_id,user_id', ignoreDuplicates: true });
  return true;
}

// Record the deployed Unlock lock for a space (E2b, after the platform
// deploys it on Base with the creator as beneficiary).
export async function setSpaceLock(
  supabase: SB,
  spaceId: string,
  lockAddress: string,
  network: string,
): Promise<boolean> {
  const { error } = await supabase.from('comm_spaces').update({ lock_address: lockAddress, network }).eq('space_id', spaceId);
  return !error;
}

export async function hasActiveSubscription(supabase: SB, spaceId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('comm_space_subscriptions')
    .select('id')
    .eq('space_id', spaceId)
    .eq('subscriber_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  return !!data;
}
