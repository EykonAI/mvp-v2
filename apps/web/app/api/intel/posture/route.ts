import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import seed from '@/lib/fixtures/posture_seed.json';
import { FORMULA_FIVE_DOMAIN, storedComposite } from '@/lib/intel/postureComposite';

export const dynamic = 'force-dynamic';

// The seed's per-theatre imagery values were never measurements.
const SEED_WITHOUT_IMAGERY = {
  ...seed,
  theatres: seed.theatres.map(t => ({ ...t, imagery: null })),
};

/**
 * Posture scores — one row per pinned theatre. Reads the latest row
 * per theatre_slug from posture_scores; falls back to the seeded
 * fixture on a cold Supabase. Feature 1 source.
 *
 * imagery is the MEASURED term where the row was written with it
 * (composite_formula = five-domain-v3, IMG-8: admitted Sentinel-1 sites in
 * the theatre) and null otherwise — never the seed's fixture value.
 * Composites are read through storedComposite(), which converts rows
 * written under the old fixture five-term formula (lib/intel/postureComposite.ts).
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
      return NextResponse.json(SEED_WITHOUT_IMAGERY);
    }

    // Keep the latest row per theatre.
    const latest = new Map<string, any>();
    for (const row of data) {
      if (!latest.has(row.theatre_slug)) latest.set(row.theatre_slug, row);
    }
    const theatres = seed.theatres.map(t => {
      const live = latest.get(t.slug);
      if (!live) return { ...t, imagery: null };
      return {
        ...t,
        composite: storedComposite(live.composite, live.imagery, live.composite_formula) ?? t.composite,
        air: live.air ? Number(live.air) : t.air,
        sea: live.sea ? Number(live.sea) : t.sea,
        conflict: live.conflict ? Number(live.conflict) : t.conflict,
        grid: live.grid ? Number(live.grid) : t.grid,
        imagery: live.composite_formula === FORMULA_FIVE_DOMAIN && live.imagery !== null ? Number(live.imagery) : null,
        composite_formula: live.composite_formula ?? null,
        precursor_match_id: live.precursor_match_id ?? null,
        precursor_similarity: live.precursor_similarity ? Number(live.precursor_similarity) : null,
      };
    });
    return NextResponse.json({ generated_at: new Date().toISOString(), theatres, live: true });
  } catch {
    return NextResponse.json(SEED_WITHOUT_IMAGERY);
  }
}
