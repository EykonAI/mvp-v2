import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { getCurrentUser } from '@/lib/auth/session';
import { createReport } from '@/lib/comm/moderation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let body: { target_type?: unknown; target_id?: unknown; reason?: unknown };
  try {
    body = (await req.json()) as { target_type?: unknown; target_id?: unknown; reason?: unknown };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const targetType = typeof body.target_type === 'string' ? body.target_type : '';
  const targetId = typeof body.target_id === 'string' ? body.target_id : '';
  const reason = typeof body.reason === 'string' ? body.reason : '';

  const supabase = createServerSupabase();
  const ok = await createReport(supabase, user.id, targetType, targetId, reason);
  if (!ok) return NextResponse.json({ error: 'invalid_report' }, { status: 400 });
  return NextResponse.json({ ok: true });
}
