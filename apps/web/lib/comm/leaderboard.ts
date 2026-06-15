import { createServerSupabase } from '@/lib/supabase-server';

// Calibration leaderboard (Workstream C). Ranks analysts by their overall
// Brier-skill from the live user_reputation rollup (feature='_all', §9 A2).
// Only rows the engine marked shown=true surface — i.e. n_resolved >=
// MIN_SAMPLE — so no thin record is ever ranked. Users who opted out
// (user_profiles.reputation_opt_in = false) are excluded, mirroring the
// per-profile Passport loader.
//
// Fail-soft: any error → [] so the page renders its empty state, never 500.

export interface LeaderboardEntry {
  rank: number;
  authorId: string;
  slug: string; // handle ?? public_id — the /u/<slug> route param
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  isFoundingAnalyst: boolean;
  brierSkill: number;
  percentile: number | null; // 0..1, 1 = best
  nResolved: number;
  coverageRatio: number | null;
}

interface RepRow {
  author_id: string;
  brier_skill: number | null;
  rank_percentile: number | null;
  n_resolved: number | null;
  coverage_ratio: number | null;
}

interface ProfRow {
  id: string;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  public_id: string | null;
  reputation_opt_in: boolean | null;
  is_founding_analyst: boolean | null;
}

export async function loadLeaderboard(limit = 100): Promise<LeaderboardEntry[]> {
  try {
    const supabase = createServerSupabase();

    // Top overall scores. Over-fetch so opt-outs / unroutable rows can be
    // dropped without shrinking the board below `limit`.
    const { data: repData, error } = await supabase
      .from('user_reputation')
      .select('author_id, brier_skill, rank_percentile, n_resolved, coverage_ratio')
      .eq('feature', '_all')
      .eq('shown', true)
      .order('brier_skill', { ascending: false })
      .order('n_resolved', { ascending: false })
      .limit(limit * 2);
    if (error || !repData || repData.length === 0) return [];

    const reps = (repData as RepRow[]).filter((r) => r.brier_skill != null);
    const ids = reps.map((r) => r.author_id);
    if (ids.length === 0) return [];

    const { data: profData } = await supabase
      .from('user_profiles')
      .select('id, handle, display_name, avatar_url, public_id, reputation_opt_in, is_founding_analyst')
      .in('id', ids);
    const profs = new Map(((profData as ProfRow[] | null) ?? []).map((p) => [p.id, p]));

    const out: LeaderboardEntry[] = [];
    for (const r of reps) {
      const p = profs.get(r.author_id);
      if (!p) continue; // no profile row → skip
      if (p.reputation_opt_in === false) continue; // opted out of reputation
      const slug = p.handle ?? p.public_id;
      if (!slug) continue; // unroutable → skip
      out.push({
        rank: 0, // assigned after sorting/filtering, below
        authorId: r.author_id,
        slug,
        handle: p.handle,
        displayName: p.display_name,
        avatarUrl: p.avatar_url,
        isFoundingAnalyst: Boolean(p.is_founding_analyst),
        brierSkill: Number(r.brier_skill),
        percentile: r.rank_percentile == null ? null : Number(r.rank_percentile),
        nResolved: Number(r.n_resolved ?? 0),
        coverageRatio: r.coverage_ratio == null ? null : Number(r.coverage_ratio),
      });
      if (out.length >= limit) break;
    }
    return out.map((e, i) => ({ ...e, rank: i + 1 }));
  } catch {
    return [];
  }
}
