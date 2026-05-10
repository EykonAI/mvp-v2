import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getServerSupabase } from '@/lib/auth/session';
import { getCurrentTier, tierMeetsRequirement } from '@/lib/subscription';

// GET /api/notifications/rules/[id]/fires?cursor=<fired_at>|<id>&limit=20
//
// Per-rule fire history for the rule-detail drawer (PR-NF-1).
// Window is server-capped to 30 days (matches the /settings recent
// notifications card). Pagination uses keyset on (fired_at desc, id
// desc) — pages do not drift if a new fire lands between requests.
//
// Ownership is enforced by RLS on user_notification_log (self-read).
// We additionally do an explicit ownership probe on
// user_notification_rules so an unknown id returns 404 cleanly
// instead of a confusing empty 200.

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const WINDOW_DAYS = 30;

interface CursorParts {
  firedAt: string;
  id: string;
}

function parseCursor(raw: string | null): CursorParts | null {
  if (!raw) return null;
  const idx = raw.indexOf('|');
  if (idx <= 0 || idx >= raw.length - 1) return null;
  const firedAt = raw.slice(0, idx);
  const id = raw.slice(idx + 1);
  if (!firedAt || !id) return null;
  if (Number.isNaN(Date.parse(firedAt))) return null;
  return { firedAt, id };
}

function buildCursor(row: { fired_at: string; id: string }): string {
  return `${row.fired_at}|${row.id}`;
}

export async function GET(req: NextRequest, ctx: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const tier = await getCurrentTier();
  if (!tierMeetsRequirement(tier, 'pro')) {
    return NextResponse.json({ error: 'forbidden', requiredTier: 'pro' }, { status: 403 });
  }

  const supabase = getServerSupabase();

  // Ownership probe — RLS scopes to self, so a missing row means
  // "not yours, or doesn't exist". Either way → 404.
  const { data: ruleRow, error: ruleErr } = await supabase
    .from('user_notification_rules')
    .select('id, name, created_at')
    .eq('id', ctx.params.id)
    .maybeSingle();
  if (ruleErr) return NextResponse.json({ error: ruleErr.message }, { status: 500 });
  if (!ruleRow) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const url = new URL(req.url);
  const requestedLimit = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(requestedLimit)))
    : DEFAULT_LIMIT;
  const cursor = parseCursor(url.searchParams.get('cursor'));

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60_000).toISOString();

  let query = supabase
    .from('user_notification_log')
    .select('id, rule_id, fired_at, channel_ids, payload, delivery_status')
    .eq('rule_id', ctx.params.id)
    .gte('fired_at', since);

  // Keyset: rows STRICTLY after the cursor in the (fired_at desc,
  // id desc) order. Implemented as: fired_at < cursor.firedAt OR
  // (fired_at = cursor.firedAt AND id < cursor.id). Supabase's
  // .or() expects a comma-joined string of conditions.
  if (cursor) {
    query = query.or(
      `fired_at.lt.${cursor.firedAt},and(fired_at.eq.${cursor.firedAt},id.lt.${cursor.id})`,
    );
  }

  // Fetch limit+1 so we know whether to expose nextCursor without a
  // separate count query.
  const { data, error } = await query
    .order('fired_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const fires = hasMore ? rows.slice(0, limit) : rows;
  const last = fires[fires.length - 1];
  const nextCursor = hasMore && last ? buildCursor({ fired_at: last.fired_at, id: last.id }) : null;

  return NextResponse.json({
    fires,
    nextCursor,
    rule: { id: ruleRow.id, name: ruleRow.name, created_at: ruleRow.created_at },
  });
}
