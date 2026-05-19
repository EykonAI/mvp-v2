import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import seed from '@/lib/fixtures/calibration_seed.json';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Calibration summary — powers the global top-strip, the Calibration
 * Ledger home, and the persistent trust badge in TopNav (PR-CAL-BADGE).
 * Reads the materialised `calibration_summary` view when available;
 * falls back to the seeded fixture while the Prediction Register is
 * warming up.
 *
 * Also returns a top-level `resolved_count` — the count of rows in
 * prediction_outcomes. The badge displays it as the "47 resolved" half
 * of the pill. Single COUNT(*) query, cached at the edge for 60s so a
 * burst of badge mounts across tabs collapses to one DB hit.
 */
export async function GET(_req: NextRequest) {
  try {
    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('calibration_summary')
      .select('*')
      .limit(1)
      .maybeSingle();

    const resolvedCount = await fetchResolvedCount(supabase);

    if (error || !data) {
      return jsonWithCache({ ...seed, resolved_count: resolvedCount });
    }

    const metrics = Array.isArray(data.metrics) ? data.metrics : seed.metrics;
    return jsonWithCache({
      metrics,
      generated_at: data.generated_at ?? new Date().toISOString(),
      degraded: data.degraded ?? false,
      resolved_count: resolvedCount,
    });
  } catch {
    return jsonWithCache({ ...seed, resolved_count: 0 });
  }
}

async function fetchResolvedCount(
  supabase: ReturnType<typeof createServerSupabase>,
): Promise<number> {
  try {
    const { count } = await supabase
      .from('prediction_outcomes')
      .select('prediction_id', { count: 'exact', head: true });
    return count ?? 0;
  } catch {
    return 0;
  }
}

function jsonWithCache(body: unknown): NextResponse {
  return NextResponse.json(body, {
    headers: {
      'Cache-Control':
        'public, s-maxage=60, stale-while-revalidate=300',
    },
  });
}
