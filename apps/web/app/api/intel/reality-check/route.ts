import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { getCurrentTier } from '@/lib/subscription';
import { MODULE_TIER_REQUIREMENTS, tierMeetsRequirement } from '@/lib/intel/modules';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * The Reality Check board's only data route (PR-6).
 *
 * It calls ONE database function — reality_check_tick() (migration 171) —
 * and returns what it answers. There is no classifier here, no threshold, no
 * arithmetic over a measurement: the board, the BRIEFS issue (PR-7) and
 * query_reality_check (PR-8) all read that one accessor, so the three can
 * never publish different numbers for the same tick (build prompt §5.3).
 *
 * TIER (D-12). The board is Pro. Every founding seat sold through /start is
 * Pro, so every buyer arriving from a promotional asset lands here with the
 * full drill-down — excluding it would put a paywall behind the paywall. The
 * gate is server-side and here, not only in the page: a page redirect
 * protects the view, an API that answers anyone protects nothing. The field
 * mask itself lives inside the accessor, so a caller cannot widen it by
 * asking for a different tier.
 */
export async function GET(req: NextRequest) {
  const tier = await getCurrentTier();
  if (!tierMeetsRequirement(tier, MODULE_TIER_REQUIREMENTS['reality-check'])) {
    return NextResponse.json(
      {
        error: 'forbidden',
        required_tier: MODULE_TIER_REQUIREMENTS['reality-check'],
        tier,
        detail: 'The Reality Check board is a Pro surface. The founding rate at /start includes it for life.',
      },
      { status: 403 },
    );
  }

  const url = new URL(req.url);
  const tick = url.searchParams.get('tick');
  const cluster = url.searchParams.get('cluster');

  try {
    const supabase = createServerSupabase();
    const { data, error } = await supabase.rpc('reality_check_tick', {
      p_tier: 'pro',
      p_tick: tick && tick.length <= 32 ? tick : null,
      p_cluster_key: cluster && cluster.length <= 64 ? cluster : null,
      p_asset: 'refinery',
    });
    if (error) {
      return NextResponse.json({ published: false, error: error.message }, { status: 200 });
    }
    return NextResponse.json(data ?? { published: false, error: 'no payload' });
  } catch (e) {
    return NextResponse.json(
      { published: false, error: e instanceof Error ? e.message : String(e) },
      { status: 200 },
    );
  }
}
