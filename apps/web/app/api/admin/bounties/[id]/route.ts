import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { isFounder } from '@/lib/admin/access';
import { createServerSupabase } from '@/lib/supabase-server';

// Founder-gated bounty status transitions, mirroring /api/admin/newsjack:
//   approve   pending  → approved
//   mark_paid approved → paid (stamps paid_at; the USDC transfer itself
//                        is manual — this records that it happened)
//   void      pending|approved → void
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user || !isFounder(user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const admin = createServerSupabase();
  const { data: row, error: loadErr } = await admin
    .from('creator_bounties')
    .select('id, status')
    .eq('id', params.id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const transitions: Record<string, { from: string[]; to: string; stampPaid?: boolean }> = {
    approve: { from: ['pending'], to: 'approved' },
    mark_paid: { from: ['approved'], to: 'paid', stampPaid: true },
    void: { from: ['pending', 'approved'], to: 'void' },
  };
  const t = body.action ? transitions[body.action] : undefined;
  if (!t) return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  if (!t.from.includes(row.status)) {
    return NextResponse.json(
      { error: `Cannot ${body.action} a ${row.status} bounty` },
      { status: 409 },
    );
  }

  const { error: updErr } = await admin
    .from('creator_bounties')
    .update({ status: t.to, ...(t.stampPaid ? { paid_at: new Date().toISOString() } : {}) })
    .eq('id', params.id)
    .eq('status', row.status); // optimistic guard against concurrent edits
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, status: t.to });
}
