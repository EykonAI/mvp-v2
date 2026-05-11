import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { getCurrentUser } from '@/lib/auth/session';
import { getCurrentTier } from '@/lib/subscription';
import { WATCHLIST_LIMITS } from '@/lib/intel/modules';

// Resolve the acting user-id. Prefer the session-derived id (the canonical,
// secure path); fall back to the legacy `x-user-id` header so server-to-
// server callers continue to work during the cutover.
async function resolveUserId(req: NextRequest): Promise<string | null> {
  const user = await getCurrentUser();
  if (user?.id) return user.id;
  return req.headers.get('x-user-id');
}

// GET: list user's watchlists
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveUserId(req);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('watchlists')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST: create a new watchlist item
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveUserId(req);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { name, type, config, alert_enabled, alert_channels, alert_frequency } = body;

    if (!name || !type) {
      return NextResponse.json({ error: 'name and type required' }, { status: 400 });
    }

    const supabase = createServerSupabase();

    // Tier-gate by current watchlist count. Citizens get WATCHLIST_LIMITS.citizen (=1).
    const tier = await getCurrentTier();
    const limit = WATCHLIST_LIMITS[tier];
    const { count, error: countErr } = await supabase
      .from('watchlists')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    if (countErr) {
      return NextResponse.json({ error: countErr.message }, { status: 500 });
    }
    if ((count ?? 0) >= limit) {
      return NextResponse.json(
        {
          error: 'watchlist_limit_reached',
          limit,
          tier,
          upgrade_url: '/pricing?from=watchlist_cap',
        },
        { status: 403 },
      );
    }

    const { data, error } = await supabase
      .from('watchlists')
      .insert({
        user_id: userId,
        name,
        type,
        config: config || {},
        alert_enabled: alert_enabled ?? true,
        alert_channels: alert_channels || ['in_app'],
        alert_frequency: alert_frequency || 'daily',
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE: remove a watchlist item
export async function DELETE(req: NextRequest) {
  try {
    const userId = await resolveUserId(req);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const supabase = createServerSupabase();
    const { error } = await supabase
      .from('watchlists')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
