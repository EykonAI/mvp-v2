import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import seed from '@/lib/fixtures/calibration_seed.json';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Calibration summary — powers the global top-strip and the Calibration
 * Ledger home. Reads the materialised `calibration_summary` view when
 * available; falls back to the seeded fixture while the Prediction
 * Register is warming up.
 */
export async function GET(_req: NextRequest) {
  try {
    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('calibration_summary')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json(seed);
    }

    const metrics = Array.isArray(data.metrics) ? data.metrics : seed.metrics;
    return NextResponse.json({
      metrics,
      generated_at: data.generated_at ?? new Date().toISOString(),
      degraded: data.degraded ?? false,
    });
  } catch {
    return NextResponse.json(seed);
  }
}
