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
      // The seed's labels go through the same derivation — a fallback
      // must not be the one path that still claims a precision metric.
      return jsonWithCache({ ...seed, metrics: relabel(seed.metrics), resolved_count: resolvedCount });
    }

    const metrics = relabel(Array.isArray(data.metrics) ? data.metrics : seed.metrics);
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

/**
 * Labels are derived HERE, from the metric key, and the stored label is
 * ignored.
 *
 * They used to be persisted inside calibration_summary.metrics by the
 * scoring cron, which meant a corrected label only reached the screen
 * on the cron's next run — "Alerts Precision@10" (which was really a
 * 7-day Brier) stayed live on production after the fix had shipped.
 * A display string is not state: deriving it at read time makes the
 * label change the moment the code does, and removes a whole class of
 * stale-copy bug. The stored `key` and `value` remain the source of
 * truth for what the number IS.
 */
const LABELS: Record<string, string> = {
  brier: 'Brier · house · 30d',
  posture: 'Posture-Shift · 30d',
  conflict: 'Conflict Escalation · 30d',
  trade: 'Trade-Flow Horizon · 30d',
  // Never "Precision@10": nothing in the platform ranks alerts, so
  // that quantity is not computed. This is a 7-day mean Brier.
  precision: 'Brier · house · 7d',
};

function relabel(metrics: unknown[]): unknown[] {
  return (metrics as Array<Record<string, unknown>>).map(m => {
    const key = typeof m?.key === 'string' ? m.key : '';
    return LABELS[key] ? { ...m, label: LABELS[key] } : m;
  });
}

async function fetchResolvedCount(
  supabase: ReturnType<typeof createServerSupabase>,
): Promise<number> {
  try {
    // House track only, and scored only. The badge sits in the global
    // nav next to the house Brier; counting creator claims or machine
    // observables there would inflate the platform's own record with
    // other people's work and with automated detections. Void rows are
    // excluded — an unobservable claim is not a resolved one.
    const { count } = await supabase
      .from('prediction_outcomes')
      .select('prediction_id, predictions_register!inner(track)', { count: 'exact', head: true })
      .is('void_reason', null)
      .eq('predictions_register.track', 'house');
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
