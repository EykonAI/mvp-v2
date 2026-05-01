import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getServerSupabase } from '@/lib/auth/session';
import { getCurrentTier } from '@/lib/subscription';
import {
  ACTIVE_RULE_LIMITS,
  MIN_COOLDOWN_MINUTES,
} from '@/lib/notifications/rule-limits';

// /api/notifications/rules/[id]
//
//   PATCH  → toggle active / rename / change cooldown / swap channels.
//   DELETE → cascade-removes user_notification_log rows tied to this
//            rule (FK ON DELETE CASCADE on the log table).
//
// RLS on user_notification_rules limits both verbs to the rule
// owner. The active-rule cap is re-checked when flipping active=true
// — a user under the cap when the rule was paused may have shipped
// other rules in the interim.

export const dynamic = 'force-dynamic';

interface PatchBody {
  name?: string;
  active?: boolean;
  cooldown_minutes?: number;
  channel_ids?: string[];
}

export async function PATCH(req: NextRequest, ctx: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as PatchBody | null;
  if (!body) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const supabase = getServerSupabase();

  const updates: Record<string, unknown> = {};
  if (typeof body.name === 'string') {
    const trimmed = body.name.trim();
    if (trimmed) updates.name = trimmed;
  }
  if (typeof body.cooldown_minutes === 'number') {
    updates.cooldown_minutes = Math.max(MIN_COOLDOWN_MINUTES, Math.floor(body.cooldown_minutes));
  }

  // Re-validate channel ids if the caller is rewiring them.
  if (Array.isArray(body.channel_ids)) {
    if (body.channel_ids.length === 0) {
      return NextResponse.json({ error: 'no_channels' }, { status: 400 });
    }
    const { data: channels, error: chError } = await supabase
      .from('user_channels')
      .select('id, verified_at, active')
      .in('id', body.channel_ids);
    if (chError) {
      return NextResponse.json({ error: chError.message }, { status: 500 });
    }
    const usable = (channels ?? [])
      .filter(c => c.verified_at && c.active)
      .map(c => c.id);
    if (usable.length === 0) {
      return NextResponse.json({ error: 'no_verified_channels' }, { status: 400 });
    }
    updates.channel_ids = usable;
  }

  if (typeof body.active === 'boolean') {
    if (body.active === true) {
      const tier = await getCurrentTier();
      const { count, error: countError } = await supabase
        .from('user_notification_rules')
        .select('id', { count: 'exact', head: true })
        .eq('active', true)
        .neq('id', ctx.params.id);
      if (countError) {
        return NextResponse.json({ error: countError.message }, { status: 500 });
      }
      const limit = ACTIVE_RULE_LIMITS[tier];
      if ((count ?? 0) >= limit) {
        return NextResponse.json(
          { error: 'rule_limit_reached', limit, tier },
          { status: 409 },
        );
      }
    }
    updates.active = body.active;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'no_updates' }, { status: 400 });
  }
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('user_notification_rules')
    .update(updates)
    .eq('id', ctx.params.id)
    .select(
      'id, name, rule_type, config, channel_ids, active, cooldown_minutes, persona, last_fired_at, created_at, updated_at',
    )
    .single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'update_failed' }, { status: 404 });
  }
  return NextResponse.json({ rule: data });
}

export async function DELETE(_req: NextRequest, ctx: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const supabase = getServerSupabase();
  const { error } = await supabase
    .from('user_notification_rules')
    .delete()
    .eq('id', ctx.params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
