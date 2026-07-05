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
  note: number | null; // creator Reputation Note (null while calibrating)
  nResolved: number; // resolved-call count behind the Note (drives the band)
}
export interface SpaceSummary {
  id: string;
  title: string | null;
  blurb: string | null;
  price_usdc: number;
  cadence: string;
  status: string; // 'draft' | 'live' | 'paused' | 'archived'
  lock_status: string | null; // null | 'working' | 'ready' | 'failed' — buyable only when 'ready'
  accent_color: string | null; // Creator Pro branding (mig 074), '#rrggbb' or null
  creator: SpaceCreator | null;
  subscriber_count: number;
  is_creator: boolean;
  is_subscribed: boolean;
}

// Per-space row for the creator-only Manage tab (§4.2).
export interface ManageSpace {
  id: string;
  title: string | null;
  blurb: string | null;
  price_usdc: number;
  cadence: string;
  status: string;
  lock_address: string | null;
  lock_status: string | null;
  subscriber_count: number;
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
  lock_status: string | null; // null | 'working' | 'ready' | 'failed' (mig 065)
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
  lock_status?: string | null;
  accent_color?: string | null;
  comm_rooms: { title: string | null } | { title: string | null }[] | null;
}
interface ProfRow {
  id: string;
  handle: string | null;
  display_name: string | null;
  public_id: string | null;
}

function creatorFrom(
  p: ProfRow | undefined | null,
  rep?: { note: number | null; nResolved: number },
): SpaceCreator | null {
  if (!p) return null;
  const slug = p.handle ?? p.public_id;
  if (!slug) return null;
  return {
    id: p.id,
    slug,
    name: p.display_name || (p.handle ? `@${p.handle}` : slug),
    note: rep?.note ?? null,
    nResolved: rep?.nResolved ?? 0,
  };
}

// Creator Reputation Notes for the credibility-forward Space cards (§4.1).
// Reads only shown '_all' rows; an unshown creator stays "Calibrating".
async function loadCreatorReps(
  supabase: SB,
  ids: string[],
): Promise<Map<string, { note: number | null; nResolved: number }>> {
  const map = new Map<string, { note: number | null; nResolved: number }>();
  if (ids.length === 0) return map;
  try {
    const { data } = await supabase
      .from('user_reputation')
      .select('author_id, reputation_note, n_resolved')
      .eq('feature', '_all')
      .eq('shown', true)
      .in('author_id', ids);
    for (const r of (data as
      | { author_id: string; reputation_note: number | null; n_resolved: number | null }[]
      | null) ?? []) {
      map.set(r.author_id, {
        note: r.reputation_note == null ? null : Number(r.reputation_note),
        nResolved: Number(r.n_resolved ?? 0),
      });
    }
  } catch {
    /* no reputation yet → all calibrating */
  }
  return map;
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

const SUMMARY_COLS = 'space_id, creator_id, price_usdc, cadence, blurb, status, lock_status, accent_color, created_at, comm_rooms!inner(title)';

export async function listSpaces(supabase: SB, viewerId: string): Promise<SpaceSummary[]> {
  const { data } = await supabase
    .from('comm_spaces')
    .select(SUMMARY_COLS)
    .eq('status', 'live')
    .order('created_at', { ascending: false })
    .limit(100);
  const rows = (data as SpaceRow[] | null) ?? [];

  // Creator Pro Discover boost (monetisation review §4.3): Pro
  // creators' spaces sort first, newest-first within each group — a
  // boost term, not an exclusive section; Discover stays honest and
  // every live space remains listed.
  const creatorIds = Array.from(new Set(rows.map((r) => r.creator_id)));
  const proCreators = new Set<string>();
  if (creatorIds.length > 0) {
    const { data: grants } = await supabase
      .from('creator_pro_grants')
      .select('user_id, lifetime_free, expires_at')
      .in('user_id', creatorIds);
    for (const g of (grants as { user_id: string; lifetime_free: boolean; expires_at: string | null }[] | null) ?? []) {
      if (g.lifetime_free || (g.expires_at && new Date(g.expires_at).getTime() > Date.now())) {
        proCreators.add(g.user_id);
      }
    }
  }
  const sorted = [...rows].sort((a, b) => {
    const boost = Number(proCreators.has(b.creator_id)) - Number(proCreators.has(a.creator_id));
    if (boost !== 0) return boost;
    return (b.created_at ?? '').localeCompare(a.created_at ?? '');
  });
  return hydrateSummaries(supabase, viewerId, sorted);
}

// Spaces the viewer actively subscribes to (§4.1 — the "My subscriptions" tab).
export async function listMySubscriptions(supabase: SB, viewerId: string): Promise<SpaceSummary[]> {
  const { data: subs } = await supabase
    .from('comm_space_subscriptions')
    .select('space_id')
    .eq('subscriber_id', viewerId)
    .eq('status', 'active');
  const ids = Array.from(new Set(((subs as { space_id: string }[] | null) ?? []).map((s) => s.space_id)));
  if (ids.length === 0) return [];
  const { data } = await supabase
    .from('comm_spaces')
    .select(SUMMARY_COLS)
    .in('space_id', ids)
    .neq('status', 'archived')
    .order('created_at', { ascending: false });
  return hydrateSummaries(supabase, viewerId, (data as SpaceRow[] | null) ?? []);
}

// Shared builder: comm_spaces rows → SpaceSummary[] with creator (+ Reputation
// Note), live subscriber counts, and the viewer's creator/subscribed flags.
async function hydrateSummaries(supabase: SB, viewerId: string, rows: SpaceRow[]): Promise<SpaceSummary[]> {
  if (rows.length === 0) return [];
  const spaceIds = rows.map((r) => r.space_id);
  const creatorIds = Array.from(new Set(rows.map((r) => r.creator_id)));

  const [{ data: profs }, reps, { data: subs }] = await Promise.all([
    supabase.from('user_profiles').select('id, handle, display_name, public_id').in('id', creatorIds),
    loadCreatorReps(supabase, creatorIds),
    supabase
      .from('comm_space_subscriptions')
      .select('space_id, subscriber_id')
      .eq('status', 'active')
      .in('space_id', spaceIds),
  ]);
  const profById = new Map(((profs as ProfRow[] | null) ?? []).map((p) => [p.id, p]));
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
    status: r.status ?? 'live',
    lock_status: r.lock_status ?? null,
    accent_color: r.accent_color ?? null,
    creator: creatorFrom(profById.get(r.creator_id), reps.get(r.creator_id)),
    subscriber_count: countBySpace.get(r.space_id) ?? 0,
    is_creator: r.creator_id === viewerId,
    is_subscribed: viewerSubbed.has(r.space_id),
  }));
}

// The creator's own spaces for the Manage tab (§4.2) — draft/live/paused
// (archived = deleted, hidden). Includes subscriber counts + the lock ref.
export async function listManageSpaces(supabase: SB, creatorId: string): Promise<ManageSpace[]> {
  const { data } = await supabase
    .from('comm_spaces')
    .select('space_id, price_usdc, cadence, blurb, status, lock_address, lock_status, created_at, comm_rooms!inner(title)')
    .eq('creator_id', creatorId)
    .in('status', ['draft', 'live', 'paused'])
    .order('created_at', { ascending: false });
  const rows = (data as SpaceRow[] | null) ?? [];
  if (rows.length === 0) return [];
  const { data: subs } = await supabase
    .from('comm_space_subscriptions')
    .select('space_id')
    .eq('status', 'active')
    .in('space_id', rows.map((r) => r.space_id));
  const countBySpace = new Map<string, number>();
  for (const s of (subs as { space_id: string }[] | null) ?? [])
    countBySpace.set(s.space_id, (countBySpace.get(s.space_id) ?? 0) + 1);
  return rows.map((r) => ({
    id: r.space_id,
    title: roomTitle(r),
    blurb: r.blurb,
    price_usdc: Number(r.price_usdc),
    cadence: r.cadence,
    status: r.status ?? 'live',
    lock_address: r.lock_address ?? null,
    lock_status: r.lock_status ?? null,
    subscriber_count: countBySpace.get(r.space_id) ?? 0,
  }));
}

export async function loadSpace(supabase: SB, spaceId: string, viewerId: string): Promise<SpaceDetail | null> {
  const { data } = await supabase
    .from('comm_spaces')
    .select('space_id, creator_id, price_usdc, cadence, blurb, status, lock_address, lock_status, comm_rooms!inner(title)')
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
    lock_status: row.lock_status ?? null,
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

// ── Lock lifecycle status (mig 065) ─────────────────────────────
// A space's lock deploy/config is guarded by a DB state machine so it is safe
// under concurrent / multi-replica "Enable" requests. The in-process serializer
// in unlock.ts only orders calls within ONE Node process; claimSpaceLockWork is
// the cross-replica lock.

const LOCK_CLAIM_TTL_MS = 5 * 60 * 1000; // a 'working' claim older than this is stale (crashed deploy)

// Atomically claim the right to deploy/configure a space's lock. Exactly one
// concurrent caller wins (Postgres row-locks the conditional UPDATE), so two
// requests can't drive the deployer wallet at the same nonce. ok=false carries
// reason 'ready' (already done) or 'in_progress' (another claim is live).
export async function claimSpaceLockWork(
  supabase: SB,
  spaceId: string,
): Promise<{ ok: boolean; reason?: 'ready' | 'in_progress' }> {
  const now = new Date().toISOString();
  // Common case: never started (null) or a prior failure (reclaimable → resume).
  const first = await supabase
    .from('comm_spaces')
    .update({ lock_status: 'working', lock_status_at: now })
    .eq('space_id', spaceId)
    .or('lock_status.is.null,lock_status.eq.failed')
    .select('space_id')
    .maybeSingle();
  if (first.data) return { ok: true };

  // Reclaim a stale 'working' (a deploy that crashed mid-flight).
  const staleBefore = new Date(Date.now() - LOCK_CLAIM_TTL_MS).toISOString();
  const second = await supabase
    .from('comm_spaces')
    .update({ lock_status: 'working', lock_status_at: now })
    .eq('space_id', spaceId)
    .eq('lock_status', 'working')
    .lt('lock_status_at', staleBefore)
    .select('space_id')
    .maybeSingle();
  if (second.data) return { ok: true };

  const { data: cur } = await supabase
    .from('comm_spaces')
    .select('lock_status')
    .eq('space_id', spaceId)
    .maybeSingle();
  return { ok: false, reason: (cur as { lock_status?: string } | null)?.lock_status === 'ready' ? 'ready' : 'in_progress' };
}

// Advance the lock lifecycle status (the enable route sets 'ready' on success,
// 'failed' on error — 'failed' is reclaimable so the idempotent flow resumes).
export async function setLockStatus(
  supabase: SB,
  spaceId: string,
  status: 'working' | 'ready' | 'failed',
): Promise<void> {
  await supabase
    .from('comm_spaces')
    .update({ lock_status: status, lock_status_at: new Date().toISOString() })
    .eq('space_id', spaceId);
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

// ── Creator management (§4.2) ───────────────────────────────────
// All creator-checked. The on-chain lock is never touched here — archiving
// only UNLINKS it (see setSpaceStatus); the creator's funds stay on Base.

export interface ManageResult {
  ok: boolean;
  error?: string;
}

// Edit a space's display fields. Price/cadence become read-only once a lock
// is deployed — the on-chain key price governs checkout and can't be changed
// from the app (the creator manages that on Base).
export async function updateSpace(
  supabase: SB,
  spaceId: string,
  creatorId: string,
  patch: {
    title?: string;
    blurb?: string | null;
    priceUsdc?: number;
    cadence?: 'monthly' | 'annual';
    // Creator Pro branding (mig 074) — the API route only forwards
    // these for active Creator Pro grants.
    accentColor?: string | null;
    bannerUrl?: string | null;
  },
): Promise<ManageResult> {
  const { data: sp } = await supabase
    .from('comm_spaces')
    .select('creator_id, status, lock_address')
    .eq('space_id', spaceId)
    .maybeSingle();
  if (!sp) return { ok: false, error: 'not_found' };
  const cur = sp as { creator_id: string; status: string; lock_address: string | null };
  if (cur.creator_id !== creatorId) return { ok: false, error: 'forbidden' };
  if (cur.status === 'archived') return { ok: false, error: 'archived' };

  if ((patch.priceUsdc != null || patch.cadence != null) && cur.lock_address) {
    return { ok: false, error: 'price_locked_onchain' };
  }

  if (patch.title != null) {
    const t = patch.title.trim().slice(0, TITLE_MAX);
    if (!t) return { ok: false, error: 'invalid_title' };
    const { error } = await supabase.from('comm_rooms').update({ title: t }).eq('id', spaceId);
    if (error) return { ok: false, error: 'update_failed' };
  }

  const upd: Record<string, unknown> = {};
  if (patch.blurb !== undefined) upd.blurb = patch.blurb ? patch.blurb.trim().slice(0, BLURB_MAX) : null;
  if (patch.priceUsdc != null) {
    if (!Number.isFinite(patch.priceUsdc) || patch.priceUsdc < 0) return { ok: false, error: 'invalid_price' };
    upd.price_usdc = patch.priceUsdc;
  }
  if (patch.cadence != null) upd.cadence = patch.cadence === 'annual' ? 'annual' : 'monthly';
  if (patch.accentColor !== undefined) {
    if (patch.accentColor !== null && !/^#[0-9a-fA-F]{6}$/.test(patch.accentColor)) {
      return { ok: false, error: 'invalid_accent' };
    }
    upd.accent_color = patch.accentColor;
  }
  if (patch.bannerUrl !== undefined) {
    if (patch.bannerUrl !== null && !/^https:\/\/\S{1,500}$/.test(patch.bannerUrl)) {
      return { ok: false, error: 'invalid_banner' };
    }
    upd.banner_url = patch.bannerUrl;
  }
  if (Object.keys(upd).length > 0) {
    const { error } = await supabase.from('comm_spaces').update(upd).eq('space_id', spaceId);
    if (error) return { ok: false, error: 'update_failed' };
  }
  return { ok: true };
}

// Pause (hide from discovery, keep existing subs), resume, or archive. Archive
// is the honest "delete": status→archived, active subs canceled, non-creator
// room access revoked — but the on-chain lock is only UNLINKED (lock_address
// cleared), never destroyed. No funds move.
export async function setSpaceStatus(
  supabase: SB,
  spaceId: string,
  creatorId: string,
  status: 'live' | 'paused' | 'archived',
): Promise<ManageResult> {
  const { data: sp } = await supabase
    .from('comm_spaces')
    .select('creator_id, status')
    .eq('space_id', spaceId)
    .maybeSingle();
  if (!sp) return { ok: false, error: 'not_found' };
  const cur = sp as { creator_id: string; status: string };
  if (cur.creator_id !== creatorId) return { ok: false, error: 'forbidden' };
  if (cur.status === 'archived') return { ok: false, error: 'archived' };

  if (status === 'archived') {
    const { error } = await supabase
      .from('comm_spaces')
      .update({ status: 'archived', lock_address: null, lock_status: null, lock_status_at: new Date().toISOString() })
      .eq('space_id', spaceId);
    if (error) return { ok: false, error: 'update_failed' };
    await supabase
      .from('comm_space_subscriptions')
      .update({ status: 'canceled' })
      .eq('space_id', spaceId)
      .eq('status', 'active');
    await supabase.from('comm_room_members').delete().eq('room_id', spaceId).neq('user_id', creatorId);
    return { ok: true };
  }

  const { error } = await supabase
    .from('comm_spaces')
    .update({ status: status === 'paused' ? 'paused' : 'live' })
    .eq('space_id', spaceId);
  if (error) return { ok: false, error: 'update_failed' };
  return { ok: true };
}
