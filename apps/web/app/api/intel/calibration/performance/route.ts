import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Calibration performance — feature × window aggregates for the
 * "Performance" table on the Calibration Ledger. Joins the Prediction
 * Register against prediction_outcomes in JS (both tables are tiny)
 * and returns, for each feature × window:
 *   resolved_count  — outcomes observed within the window
 *   open_count      — predictions issued but not yet scored
 *   mean_brier / mean_log_loss — over resolved outcomes in the window,
 *                     null when nothing has resolved yet (honest zero,
 *                     not a fabricated number).
 * Degrades gracefully: any failure returns { rows: [], error } with 200
 * so the client can render its "feed unavailable" state.
 */

const WINDOWS: { label: string; ms: number }[] = [
  { label: '7d', ms: 7 * 24 * 3600 * 1000 },
  { label: '30d', ms: 30 * 24 * 3600 * 1000 },
];

interface PerformanceRow {
  feature: string;
  window: string;
  resolved_count: number;
  open_count: number;
  mean_brier: number | null;
  mean_log_loss: number | null;
}

export async function GET(_req: NextRequest) {
  try {
    const supabase = createServerSupabase();

    const [predsRes, outcomesRes] = await Promise.all([
      supabase.from('predictions_register').select('id, feature, issued_at'),
      supabase
        .from('prediction_outcomes')
        .select('prediction_id, observed_at, brier, log_loss'),
    ]);

    if (predsRes.error) throw predsRes.error;
    if (outcomesRes.error) throw outcomesRes.error;

    const predictions = predsRes.data ?? [];
    const outcomes = outcomesRes.data ?? [];

    const outcomeByPrediction = new Map(
      outcomes.map(o => [o.prediction_id, o]),
    );
    const featureById = new Map(predictions.map(p => [p.id, p.feature]));
    const features = [...new Set(predictions.map(p => p.feature))].sort();

    const now = Date.now();
    const rows: PerformanceRow[] = [];

    for (const feature of features) {
      const open_count = predictions.filter(
        p => p.feature === feature && !outcomeByPrediction.has(p.id),
      ).length;

      for (const w of WINDOWS) {
        const resolved = outcomes.filter(
          o =>
            featureById.get(o.prediction_id) === feature &&
            o.observed_at &&
            now - new Date(o.observed_at).getTime() <= w.ms,
        );
        rows.push({
          feature,
          window: w.label,
          resolved_count: resolved.length,
          open_count,
          mean_brier: mean(resolved.map(o => o.brier)),
          mean_log_loss: mean(resolved.map(o => o.log_loss)),
        });
      }
    }

    return jsonWithCache({ rows, generated_at: new Date().toISOString() });
  } catch (err) {
    return jsonWithCache({
      rows: [],
      error: err instanceof Error ? err.message : 'performance feed unavailable',
    });
  }
}

function mean(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => typeof v === 'number');
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 1000) / 1000;
}

function jsonWithCache(body: unknown): NextResponse {
  return NextResponse.json(body, {
    headers: {
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
    },
  });
}
