import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { getCurrentUser } from '@/lib/auth/session';
import { listThreads } from '@/lib/comm/dm';

// Unread-DM count for the COMM menu's Messages badge (UX Uplift brief §2.2).
// Read-only; reuses the same listThreads() the /messages page renders, so the
// count is real — the badge stays hidden rather than ever showing a guess.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const supabase = createServerSupabase();
  const threads = await listThreads(supabase, user.id);
  const count = threads.filter((t) => t.unread).length;
  return NextResponse.json({ count });
}
