import { createServerSupabase } from '@/lib/supabase-server';
import type { ReputationData } from '@/components/profile/ReputationPassport';

// Loader for the public COMM profile page (/u/<handle>).
//
// Reads through the `public_profiles` view (migration 055), which
// exposes only non-sensitive columns — email / tier / billing are never
// selected. Resolution accepts either a chosen handle or the existing
// user_profiles.public_id as a fallback slug. Historical predictions are
// the author's rows in predictions_register (empty until a user authors
// a call); reputation scoring lands later with the §9 engine, so Phase 1
// only ever reports a resolved-count and shows "calibrating".

export interface ProfileLink {
  label: string;
  url: string;
}

export interface PublicProfile {
  id: string;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  bio: string | null;
  links: ProfileLink[];
  preferred_persona: string | null;
  public_id: string | null;
  created_at: string | null;
  is_founding_analyst: boolean;
}

export interface ProfilePrediction {
  public_id: string | null;
  statement: string | null; // masked (null) while a call is sealed to non-owners
  predicted_mean: number | null; // masked (null) while sealed to non-owners
  observed_value: number | null;
  brier: number | null;
  brierSkill: number | null; // per-call skill vs baseline (resolved only)
  resolves_at: string | null;
  horizonHours: number | null;
  baseline: number | null;
  commitHash: string | null; // shown only for sealed calls (the integrity seal)
  status: 'resolved' | 'sealed' | 'open';
}

export interface ProfileSpace {
  spaceId: string;
  title: string | null;
  blurb: string | null;
  status: string; // 'live' | 'paused'
  priceUsdc: number | null;
  cadence: string | null;
}

export interface WallPost {
  id: string;
  body: string;
  created_at: string;
}

export interface ReputationNoteSummary {
  note: number | null; // 0–100, or null while calibrating
  nResolved: number;
  percentile: number | null; // 0..1, 1 = best
  coverage: number | null; // 0..1
}

export interface ProfileData {
  profile: PublicProfile;
  predictions: ProfilePrediction[];
  resolvedCount: number;
  wall: WallPost[];
  followers: number;
  following: number;
  spaces: ProfileSpace[];
  reputation: ReputationData | null;
  reputationNote: ReputationNoteSummary | null;
}

const HANDLE_RE = /^[A-Za-z0-9_]{1,32}$/;
const PUBLIC_ID_RE = /^[A-Za-z0-9_-]{3,64}$/;

export function isValidProfileParam(param: string): boolean {
  return HANDLE_RE.test(param) || PUBLIC_ID_RE.test(param);
}

const PROFILE_COLUMNS =
  'id, handle, display_name, avatar_url, cover_url, bio, links, preferred_persona, public_id, created_at, is_founding_analyst';

interface ProfileRow {
  id: string;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  bio: string | null;
  links: unknown;
  preferred_persona: string | null;
  public_id: string | null;
  created_at: string | null;
  is_founding_analyst: boolean | null;
}

interface OutcomeRow {
  observed_value: number | null;
  brier: number | null;
}

interface PredictionRow {
  public_id: string | null;
  statement: string | null;
  predicted_distribution: Record<string, unknown> | null;
  visibility: string | null;
  commit_hash: string | null;
  target_window_hours: number | null;
  baseline_mean: number | null;
  resolves_at: string | null;
  prediction_outcomes: OutcomeRow[] | OutcomeRow | null;
}

export async function loadProfile(param: string, viewerId?: string): Promise<ProfileData | null> {
  if (!isValidProfileParam(param)) return null;
  const supabase = createServerSupabase();

  let row: ProfileRow | null = null;
  if (HANDLE_RE.test(param)) {
    const { data } = await supabase
      .from('public_profiles')
      .select(PROFILE_COLUMNS)
      .eq('handle', param)
      .maybeSingle();
    row = (data as ProfileRow | null) ?? null;
  }
  if (!row && PUBLIC_ID_RE.test(param)) {
    const { data } = await supabase
      .from('public_profiles')
      .select(PROFILE_COLUMNS)
      .eq('public_id', param)
      .maybeSingle();
    row = (data as ProfileRow | null) ?? null;
  }
  if (!row) return null;

  const isOwnerView = !!viewerId && viewerId === row.id;
  const { data: predData } = await supabase
    .from('predictions_register')
    .select(
      'public_id, statement, predicted_distribution, visibility, commit_hash, target_window_hours, baseline_mean, resolves_at, prediction_outcomes(observed_value, brier)',
    )
    .eq('author_id', row.id)
    .order('resolves_at', { ascending: false })
    .limit(50);

  const predictions: ProfilePrediction[] = ((predData as PredictionRow[] | null) ?? []).map((pr) => {
    const outcome = Array.isArray(pr.prediction_outcomes) ? pr.prediction_outcomes[0] : pr.prediction_outcomes;
    const resolved = !!outcome && outcome.brier != null && outcome.observed_value != null;
    // A still-'committed' call withholds its plaintext (statement, mean) from
    // anyone but the author — mirrors the predictions_public view's seal.
    const sealed = !resolved && pr.visibility === 'committed';
    const masked = sealed && !isOwnerView;
    const meanRaw = pr.predicted_distribution?.mean;
    const predicted_mean = masked || meanRaw == null ? null : toNum(meanRaw);
    const observed_value = outcome ? toNum(outcome.observed_value) : null;
    const brier = outcome ? toNum(outcome.brier) : null;
    const baseline = pr.baseline_mean == null ? null : toNum(pr.baseline_mean);
    return {
      public_id: pr.public_id,
      statement: masked ? null : pr.statement,
      predicted_mean,
      observed_value,
      brier,
      brierSkill: resolved ? perCallSkill(brier, baseline, observed_value) : null,
      resolves_at: pr.resolves_at,
      horizonHours: pr.target_window_hours == null ? null : Number(pr.target_window_hours),
      baseline,
      commitHash: sealed ? pr.commit_hash : null,
      status: resolved ? 'resolved' : sealed ? 'sealed' : 'open',
    };
  });

  const wall = await loadWall(supabase, row.id);
  const [followers, following] = await loadFollowCounts(supabase, row.id);
  const spaces = await loadSpaces(supabase, row.id);
  const reputation = await loadReputation(supabase, row.id);
  const reputationNote = await loadReputationNote(supabase, row.id);

  return {
    profile: {
      id: row.id,
      handle: row.handle,
      display_name: row.display_name,
      avatar_url: row.avatar_url,
      cover_url: row.cover_url,
      bio: row.bio,
      links: normalizeLinks(row.links),
      preferred_persona: row.preferred_persona,
      public_id: row.public_id,
      created_at: row.created_at,
      is_founding_analyst: Boolean(row.is_founding_analyst),
    },
    predictions,
    resolvedCount: predictions.filter((p) => p.status === 'resolved').length,
    wall,
    followers,
    following,
    spaces,
    reputation,
    reputationNote,
  };
}

// Wall posts for the profile owner. Fail-soft: if comm_wall_posts does
// not exist yet (migration 056 not applied) the query errors and we
// return [] so the live /u/ page never regresses to a 500.
async function loadWall(
  supabase: ReturnType<typeof createServerSupabase>,
  authorId: string,
): Promise<WallPost[]> {
  try {
    const { data, error } = await supabase
      .from('comm_wall_posts')
      .select('id, body, created_at')
      .eq('author_id', authorId)
      .eq('visibility', 'public')
      .order('created_at', { ascending: false })
      .limit(30);
    if (error || !data) return [];
    return (data as { id: string; body: string; created_at: string }[]).map((p) => ({
      id: p.id,
      body: p.body,
      created_at: p.created_at,
    }));
  } catch {
    return [];
  }
}

// Follower / following counts. Fail-soft on a missing table (migration
// 057 not yet applied) → [0, 0], so the live page never regresses.
async function loadFollowCounts(
  supabase: ReturnType<typeof createServerSupabase>,
  profileId: string,
): Promise<[number, number]> {
  try {
    const [a, b] = await Promise.all([
      supabase
        .from('comm_follows')
        .select('follower_id', { count: 'exact', head: true })
        .eq('followee_id', profileId),
      supabase
        .from('comm_follows')
        .select('followee_id', { count: 'exact', head: true })
        .eq('follower_id', profileId),
    ]);
    return [a.count ?? 0, b.count ?? 0];
  } catch {
    return [0, 0];
  }
}

// Public spaces this analyst runs (Profile §3.1 — the Spaces tab + the
// four-stat strip count). Live + paused only (drafts/archived aren't public).
// Title lives on the backing comm_rooms row. Fail-soft → [] so a missing
// table never regresses the page.
async function loadSpaces(
  supabase: ReturnType<typeof createServerSupabase>,
  creatorId: string,
): Promise<ProfileSpace[]> {
  try {
    const { data, error } = await supabase
      .from('comm_spaces')
      .select('space_id, blurb, status, price_usdc, cadence')
      .eq('creator_id', creatorId)
      .in('status', ['live', 'paused']);
    if (error || !data || data.length === 0) return [];
    const rows = data as {
      space_id: string;
      blurb: string | null;
      status: string;
      price_usdc: number | null;
      cadence: string | null;
    }[];
    const { data: roomData } = await supabase
      .from('comm_rooms')
      .select('id, title')
      .in('id', rows.map((r) => r.space_id));
    const titles = new Map(
      ((roomData as { id: string; title: string | null }[] | null) ?? []).map((r) => [r.id, r.title]),
    );
    return rows.map((s) => ({
      spaceId: s.space_id,
      title: titles.get(s.space_id) ?? null,
      blurb: s.blurb,
      status: s.status,
      priceUsdc: s.price_usdc == null ? null : Number(s.price_usdc),
      cadence: s.cadence,
    }));
  } catch {
    return [];
  }
}

// Per-call brier-skill = 1 − brier / brier(baseline), bounded to [-1, 1]; null
// unless fully resolved. Mirrors the cron's per-call skill (lib reputationNote).
function perCallSkill(brier: number | null, baseline: number | null, observed: number | null): number | null {
  if (brier == null || baseline == null || observed == null) return null;
  const baseBrier = (baseline - observed) ** 2;
  if (baseBrier <= 1e-9) return brier <= 1e-9 ? 0 : -1;
  const skill = 1 - brier / baseBrier;
  return Math.round(Math.max(-1, Math.min(1, skill)) * 1000) / 1000;
}

// Owner reputation for the Calibration Passport (§9 A2). Respects
// reputation_opt_in and the shown gate (n_resolved >= MIN_SAMPLE), so a
// score never surfaces before it's earned. Fail-soft → null = calibrating.
async function loadReputation(
  supabase: ReturnType<typeof createServerSupabase>,
  authorId: string,
): Promise<ReputationData | null> {
  try {
    const { data: prof } = await supabase
      .from('user_profiles')
      .select('reputation_opt_in')
      .eq('id', authorId)
      .maybeSingle();
    if (prof && (prof as { reputation_opt_in?: boolean }).reputation_opt_in === false) return null;

    const { data, error } = await supabase
      .from('user_reputation')
      .select('feature, brier_skill, rank_percentile')
      .eq('author_id', authorId)
      .eq('shown', true);
    if (error || !data || data.length === 0) return null;

    const rows = data as { feature: string; brier_skill: number | null; rank_percentile: number | null }[];
    const all = rows.find((r) => r.feature === '_all');
    if (!all || all.brier_skill == null) return null;

    const domains = rows
      .filter((r) => r.feature !== '_all' && r.brier_skill != null)
      .map((r) => ({ key: r.feature, label: featureLabel(r.feature), value: Number(r.brier_skill) }));

    return {
      brierSkill: Number(all.brier_skill),
      percentile: all.rank_percentile == null ? null : Number(all.rank_percentile),
      domains,
      spark: [],
    };
  } catch {
    return null;
  }
}

// The owner's Reputation Note (§3.2) — read from the materialised '_all'
// row, gated by reputation_opt_in and shown (n_resolved >= MIN_SAMPLE). When
// no shown row exists the page renders the honest "Calibrating (n/10)" state
// from resolvedCount, so null here is the cold-start, not an error.
async function loadReputationNote(
  supabase: ReturnType<typeof createServerSupabase>,
  authorId: string,
): Promise<ReputationNoteSummary | null> {
  try {
    const { data: prof } = await supabase
      .from('user_profiles')
      .select('reputation_opt_in')
      .eq('id', authorId)
      .maybeSingle();
    if (prof && (prof as { reputation_opt_in?: boolean }).reputation_opt_in === false) return null;

    const { data, error } = await supabase
      .from('user_reputation')
      .select('reputation_note, rank_percentile, coverage_ratio, n_resolved')
      .eq('author_id', authorId)
      .eq('feature', '_all')
      .eq('shown', true)
      .maybeSingle();
    if (error || !data) return null;

    const row = data as {
      reputation_note: number | null;
      rank_percentile: number | null;
      coverage_ratio: number | null;
      n_resolved: number | null;
    };
    if (row.reputation_note == null) return null;
    return {
      note: Number(row.reputation_note),
      nResolved: Number(row.n_resolved ?? 0),
      percentile: row.rank_percentile == null ? null : Number(row.rank_percentile),
      coverage: row.coverage_ratio == null ? null : Number(row.coverage_ratio),
    };
  } catch {
    return null;
  }
}

const FEATURE_LABELS: Record<string, string> = {
  ais_chokepoint_weekly: 'Chokepoints',
  conflict_escalation: 'Conflict',
  posture_shift: 'Posture',
  trade_flow: 'Trade flow',
  eia_weekly: 'Energy',
};

function featureLabel(feature: string): string {
  return (
    FEATURE_LABELS[feature] ??
    feature.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

// True if `viewerId` follows `profileId`. Fail-soft on a missing table.
export async function isFollowing(viewerId: string, profileId: string): Promise<boolean> {
  try {
    const supabase = createServerSupabase();
    const { data } = await supabase
      .from('comm_follows')
      .select('follower_id')
      .eq('follower_id', viewerId)
      .eq('followee_id', profileId)
      .maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeLinks(links: unknown): ProfileLink[] {
  if (!Array.isArray(links)) return [];
  const out: ProfileLink[] = [];
  for (const l of links) {
    if (l && typeof l === 'object' && typeof (l as { url?: unknown }).url === 'string') {
      const url = (l as { url: string }).url;
      const rawLabel = (l as { label?: unknown }).label;
      out.push({ label: typeof rawLabel === 'string' ? rawLabel : url, url });
    }
  }
  return out;
}
