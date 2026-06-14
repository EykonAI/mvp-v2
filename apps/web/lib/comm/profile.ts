import { createServerSupabase } from '@/lib/supabase-server';

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
  statement: string | null;
  predicted_mean: number | null;
  observed_value: number | null;
  brier: number | null;
  resolves_at: string | null;
  status: 'resolved' | 'open';
}

export interface ProfileData {
  profile: PublicProfile;
  predictions: ProfilePrediction[];
  resolvedCount: number;
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
  resolves_at: string | null;
  prediction_outcomes: OutcomeRow[] | OutcomeRow | null;
}

export async function loadProfile(param: string): Promise<ProfileData | null> {
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

  const { data: predData } = await supabase
    .from('predictions_register')
    .select(
      'public_id, statement, predicted_distribution, resolves_at, prediction_outcomes(observed_value, brier)',
    )
    .eq('author_id', row.id)
    .order('resolves_at', { ascending: false })
    .limit(50);

  const predictions: ProfilePrediction[] = ((predData as PredictionRow[] | null) ?? []).map(
    (pr) => {
      const outcome = Array.isArray(pr.prediction_outcomes)
        ? pr.prediction_outcomes[0]
        : pr.prediction_outcomes;
      const meanRaw = pr.predicted_distribution?.mean;
      return {
        public_id: pr.public_id,
        statement: pr.statement,
        predicted_mean: meanRaw == null ? null : toNum(meanRaw),
        observed_value: outcome ? toNum(outcome.observed_value) : null,
        brier: outcome ? toNum(outcome.brier) : null,
        resolves_at: pr.resolves_at,
        status: outcome ? 'resolved' : 'open',
      };
    },
  );

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
  };
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
