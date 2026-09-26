import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { storedComposite } from '@/lib/intel/postureComposite';

export const dynamic = 'force-dynamic';

/**
 * Posture summary — latest composite score per theatre, from live
 * posture_scores. Powers the theatre-selector sidebar in the Precursor
 * Analogs workspace (live composites instead of the fixture seed).
 *
 * Cadence is ~10 rows/hour/theatre across 5 theatres, so a 2-hour window
 * is ~100 narrow rows — reduced to newest-per-theatre in JS. Cached at
 * the edge for 300s so sidebar mounts collapse to one DB hit.
 */
export async function GET(_req: NextRequest) {
  try {
    const supabase = createServerSupabase();
    const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('posture_scores')
      .select('theatre_slug, composite, imagery, computed_at')
      .gte('computed_at', since)
      .order('computed_at', { ascending: false })
      .limit(200);

    if (error) {
      return jsonWithCache({ theatres: [], error: error.message });
    }

    // Rows are newest-first, so the first row seen per theatre is the latest.
    const latest = new Map<string, { slug: string; composite: number; computed_at: string }>();
    for (const row of data ?? []) {
      const slug = String(row.theatre_slug);
      if (latest.has(slug)) continue;
      // Through storedComposite so a row written under the old five-term
      // formula reads on today's scale; a missing composite is skipped,
      // never shown as 0.
      const composite = storedComposite(row.composite, row.imagery);
      if (composite === null) continue;
      latest.set(slug, { slug, composite, computed_at: String(row.computed_at) });
    }

    return jsonWithCache({
      theatres: [...latest.values()].sort((a, b) => a.slug.localeCompare(b.slug)),
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return jsonWithCache({ theatres: [], error: message });
  }
}

function jsonWithCache(body: unknown): NextResponse {
  return NextResponse.json(body, {
    headers: {
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
    },
  });
}
