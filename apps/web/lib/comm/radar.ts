import { createServerSupabase } from '@/lib/supabase-server';

// Follow-my-radar (Workstream D1). A personal feed that makes "following"
// mean something: the recent calls and notes of the analysts a viewer
// follows (comm_follows, mig 057), merged newest-first.
//
// Visibility: only calls that are public/revealed surface — a sealed
// ('committed') commit-reveal call is never leaked here. Wall notes carry
// 'public'|'followers' visibility; since every author in the feed is one
// the viewer follows, both are theirs to see, so no note filter is needed.
//
// Fail-soft: any error → empty feed, never a 500.

export interface RadarAuthor {
  id: string;
  slug: string; // handle ?? public_id — the /u/<slug> route param
  name: string;
  avatarUrl: string | null;
}

export interface RadarCall {
  kind: 'call';
  id: string;
  ts: string; // issued_at
  author: RadarAuthor;
  statement: string | null;
  predictedMean: number | null; // 0..1 probability
  resolvesAt: string | null;
  status: 'open' | 'resolved';
  brier: number | null;
}

export interface RadarNote {
  kind: 'note';
  id: string;
  ts: string; // created_at
  author: RadarAuthor;
  body: string;
}

export type RadarItem = RadarCall | RadarNote;

export interface RadarData {
  followingCount: number;
  items: RadarItem[];
}

interface ProfRow {
  id: string;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  public_id: string | null;
}
interface OutcomeRow {
  observed_value: number | null;
  brier: number | null;
}
interface CallRow {
  id: string;
  statement: string | null;
  predicted_distribution: Record<string, unknown> | null;
  issued_at: string | null;
  resolves_at: string | null;
  author_id: string;
  prediction_outcomes: OutcomeRow[] | OutcomeRow | null;
}
interface NoteRow {
  id: string;
  body: string;
  created_at: string | null;
  author_id: string;
}

export async function loadRadar(viewerId: string, limit = 40): Promise<RadarData> {
  try {
    const supabase = createServerSupabase();

    const { data: followRows } = await supabase
      .from('comm_follows')
      .select('followee_id')
      .eq('follower_id', viewerId);
    const followeeIds = ((followRows as { followee_id: string }[] | null) ?? []).map(
      (r) => r.followee_id,
    );
    if (followeeIds.length === 0) return { followingCount: 0, items: [] };

    const { data: profData } = await supabase
      .from('user_profiles')
      .select('id, handle, display_name, avatar_url, public_id')
      .in('id', followeeIds);
    const authors = new Map<string, RadarAuthor>();
    for (const p of (profData as ProfRow[] | null) ?? []) {
      const slug = p.handle ?? p.public_id;
      if (!slug) continue;
      authors.set(p.id, {
        id: p.id,
        slug,
        name: p.display_name || (p.handle ? `@${p.handle}` : slug),
        avatarUrl: p.avatar_url,
      });
    }

    const [callsRes, notesRes] = await Promise.all([
      supabase
        .from('predictions_register')
        .select(
          'id, statement, predicted_distribution, issued_at, resolves_at, author_id, prediction_outcomes(observed_value, brier)',
        )
        .in('author_id', followeeIds)
        .in('visibility', ['public', 'revealed'])
        .order('issued_at', { ascending: false })
        .limit(limit),
      supabase
        .from('comm_wall_posts')
        .select('id, body, created_at, author_id')
        .in('author_id', followeeIds)
        .order('created_at', { ascending: false })
        .limit(limit),
    ]);

    const items: RadarItem[] = [];

    for (const c of (callsRes.data as CallRow[] | null) ?? []) {
      const author = authors.get(c.author_id);
      if (!author || !c.issued_at) continue;
      const outcome = Array.isArray(c.prediction_outcomes)
        ? c.prediction_outcomes[0]
        : c.prediction_outcomes;
      items.push({
        kind: 'call',
        id: c.id,
        ts: c.issued_at,
        author,
        statement: c.statement,
        predictedMean: toNum(c.predicted_distribution?.mean),
        resolvesAt: c.resolves_at,
        status: outcome ? 'resolved' : 'open',
        brier: outcome ? toNum(outcome.brier) : null,
      });
    }

    for (const n of (notesRes.data as NoteRow[] | null) ?? []) {
      const author = authors.get(n.author_id);
      if (!author || !n.created_at) continue;
      items.push({ kind: 'note', id: n.id, ts: n.created_at, author, body: n.body });
    }

    items.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
    return { followingCount: followeeIds.length, items: items.slice(0, limit) };
  } catch {
    return { followingCount: 0, items: [] };
  }
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
