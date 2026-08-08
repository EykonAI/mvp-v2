import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { isFounder } from '@/lib/admin/access';
import { createServerSupabase } from '@/lib/supabase-server';

// POST /api/admin/credits — manage metered FP test plans.
//
// Founder-gated, mirrors /api/admin/partners. Actions:
//   grant   { lookup, budget_usd, label?, deep_cap_pct?, days?, reason? }
//   top_up  { lookup, budget_usd, reason? }        (same RPC — additive)
//   suspend { lookup }                              kill-switch
//   resume  { lookup }
//   revoke  { lookup }                              delete wallet → unmetered
//
// grant and top_up both call grant_fp_test_plan(): one transaction
// covering tier_overrides + user_credit_accounts + credit_grants, so a
// double-submit tops up rather than duplicating, and a partial grant
// (Pro without a wallet = unmetered Pro) cannot happen.

export const dynamic = 'force-dynamic';

type Action = 'grant' | 'top_up' | 'suspend' | 'resume' | 'revoke';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !isFounder(user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: {
    action?: Action;
    lookup?: string;
    budget_usd?: number;
    label?: string;
    deep_cap_pct?: number;
    days?: number;
    reason?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const action = body.action ?? 'grant';
  const lookup = (body.lookup ?? '').trim();
  if (!lookup) return NextResponse.json({ error: 'lookup required' }, { status: 400 });

  const admin = createServerSupabase();

  // Resolve @handle or email → user_id, same shape as /api/admin/partners.
  let target: { id: string } | null = null;
  if (lookup.includes('@') && lookup.includes('.') && !lookup.startsWith('@')) {
    const { data } = await admin
      .from('user_profiles')
      .select('id')
      .ilike('email', lookup)
      .maybeSingle();
    target = data as { id: string } | null;
  } else {
    const { data } = await admin
      .from('user_profiles')
      .select('id')
      .eq('handle', lookup.replace(/^@/, ''))
      .maybeSingle();
    target = data as { id: string } | null;
  }
  if (!target) {
    return NextResponse.json({ error: `No user found for "${lookup}"` }, { status: 404 });
  }

  if (action === 'grant' || action === 'top_up') {
    const budget = Number(body.budget_usd);
    if (!Number.isFinite(budget) || budget <= 0) {
      return NextResponse.json({ error: 'budget_usd must be > 0' }, { status: 400 });
    }
    // Guard-rail, not a limit: a mistyped 1000 instead of 10.00 would
    // hand a partner a four-figure Claude budget with no second prompt.
    if (budget > 500) {
      return NextResponse.json(
        { error: `Refusing a $${budget.toFixed(2)} grant — over the $500 sanity ceiling. Grant it twice if that is genuinely intended.` },
        { status: 400 },
      );
    }
    const { data, error } = await admin.rpc('grant_fp_test_plan', {
      p_user_id: target.id,
      p_budget_usd: budget,
      p_granted_by: user.email ?? 'founder',
      p_label: body.label ?? null,
      p_deep_cap: body.deep_cap_pct ?? 0.2,
      p_days: body.days ?? 90,
      p_reason: body.reason ?? (action === 'top_up' ? 'top-up' : 'initial grant'),
    });
    if (error) {
      console.error('[admin/credits] grant failed:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const row = Array.isArray(data) ? data[0] : data;
    return NextResponse.json({ ok: true, ...row });
  }

  if (action === 'suspend' || action === 'resume') {
    const { error } = await admin
      .from('user_credit_accounts')
      .update({
        status: action === 'suspend' ? 'suspended' : 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', target.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === 'revoke') {
    // Deletes the wallet only — the user reverts to UNMETERED and keeps
    // their tier. credit_grants and cost_events are untouched, so the
    // spend history and the audit trail survive the revoke.
    const { error } = await admin
      .from('user_credit_accounts')
      .delete()
      .eq('user_id', target.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: `Unknown action "${action}"` }, { status: 400 });
}
