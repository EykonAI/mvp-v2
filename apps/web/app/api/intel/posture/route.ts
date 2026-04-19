import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import seed from '@/lib/fixtures/posture_seed.json';

export const dynamic = 'force-dynamic';

/**
 * Posture scores — one row per pinned theatre. Reads the latest row
 * per theatre_slug from posture_scores; falls back to the seeded
 * fixture on a cold Supabase. Feature 1 source.
 */
export async function GET(_req: NextRequest) {
  try {
    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('posture_scores')
      .select('*')
      .order('computed_at', { ascending: false })
      .limit(50);

    if (error || !data || data.length === 0) {
      return NextResponse.json(seed);
    }

    // Keep the latest row per theatre.
    const latest = new Map<string, any>();
    for (const row of data) {
      if (!latest.has(row.theatre_slug)) latest.set(row.theatre_slug, row);
    }
    const theatres = seed.theatres.map(t => {
      const live = latest.get(t.slug);
      if (!live) return t;
      return {
        ...t,
        composite: Number(live.composite),
        air: live.air ? Number(live.air) : t.air,
        sea: live.sea ? Number(live.sea) : t.sea,
        conflict: live.conflict ? Number(live.conflict) : t.conflict,
        grid: live.grid ? Number(live.grid) : t.grid,
        imagery: live.imagery ? Number(live.imagery) : t.imagery,
        precursor_match_id: live.precursor_match_id ?? null,
        precursor_similarity: live.precursor_similarity ? Number(live.precursor_similarity) : null,
      };
    });
    return NextResponse.json({ generated_at: new Date().toISOString(), theatres, live: true });
  } catch {
    return NextResponse.json(seed);
  }
}
