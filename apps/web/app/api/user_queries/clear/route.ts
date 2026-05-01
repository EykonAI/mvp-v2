import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getServerSupabase } from '@/lib/auth/session';

// POST /api/user_queries/clear — destructive: deletes all the
// signed-in user's user_queries rows. GDPR-driven (§4.6).
//
// Requires a typed confirmation in the body to defeat accidental
// fires from the UI. The cookie-bound supabase client + RLS means
// the DELETE is per-user even without an explicit WHERE — but the
// WHERE is included anyway as defence-in-depth.

const REQUIRED_CONFIRMATION = 'DELETE';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let body: { confirmation?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (body?.confirmation !== REQUIRED_CONFIRMATION) {
    return NextResponse.json(
      { error: `confirmation must be "${REQUIRED_CONFIRMATION}"` },
      { status: 400 },
    );
  }

  const supabase = getServerSupabase();
  // Returning the deleted rows lets us tell the client how many
  // entries were wiped — useful confirmation in the UI.
  const { data, error } = await supabase
    .from('user_queries')
    .delete()
    .eq('user_id', user.id)
    .select('id');

  if (error) {
    console.error('[user_queries/clear] delete failed', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: (data ?? []).length });
}
