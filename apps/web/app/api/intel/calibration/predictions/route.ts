import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

/**
 * Paginated predictions browser. Joins predictions_register with
 * prediction_outcomes to present a per-row Brier/log-loss ledger.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const page = Math.max(0, Number(url.searchParams.get('page') ?? 0));
  const size = Math.min(200, Math.max(10, Number(url.searchParams.get('size') ?? 50)));
  const feature = url.searchParams.get('feature');
  const persona = url.searchParams.get('persona');

  try {
    const supabase = createServerSupabase();
    let q = supabase
      .from('predictions_register')
      .select('id, feature, context, predicted_distribution, target_observable, target_window_hours, issued_at, resolves_at, persona, prediction_outcomes(observed_value, observed_at, brier, log_loss, calibration_bin)')
      .order('issued_at', { ascending: false })
      .range(page * size, page * size + size - 1);

    if (feature) q = q.eq('feature', feature);
    if (persona) q = q.eq('persona', persona);

    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ rows: data ?? [], page, size });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
