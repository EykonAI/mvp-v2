import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

/**
 * Recent convergence events. Feature 21 source.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const hours = Math.min(168, Math.max(1, Number(url.searchParams.get('hours') ?? 24)));
  const since = new Date(Date.now() - hours * 3600_000).toISOString();

  try {
    const supabase = createServerSupabase();
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
