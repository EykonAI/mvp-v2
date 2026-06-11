import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

/**
 * Recent convergence events. Feature 21 source.
 *
 * Two modes:
 *   ?latest=N (1..25) — the N most recent events regardless of age,
 *     newest first. Convergences are rare by design, so a rolling
 *     "latest N" is what the ConvergenceFeed panel and the TopNav
 *     badge consume — a time window would be empty most days.
 *   ?hours=H (1..168) — windowed mode, strongest (lowest p) first.
 *     Kept for back-compat / ad-hoc API use.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const latestParam = url.searchParams.get('latest');
  const hours = Math.min(168, Math.max(1, Number(url.searchParams.get('hours') ?? 24)));
  const since = new Date(Date.now() - hours * 3600_000).toISOString();

  try {
    const supabase = createServerSupabase();

    if (latestParam != null) {
      const n = Math.min(25, Math.max(1, Number(latestParam) || 5));
      const { data, error } = await supabase
        .from('convergence_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(n);
      if (error || !data) {
        return NextResponse.json({ events: [], degraded: true, reason: error?.message ?? 'empty' });
      }
      return NextResponse.json({ events: data, degraded: data.length === 0, latest: n });
    }

    const { data, error } = await supabase
      .from('convergence_events')
      .select('*')
      .gte('created_at', since)
      .order('joint_p_value', { ascending: true })
      .limit(25);

    if (error || !data) {
      return NextResponse.json({ events: [], degraded: true, reason: error?.message ?? 'empty' });
    }
    return NextResponse.json({ events: data, degraded: false, hours });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json({ events: [], degraded: true, reason: message });
  }
}
