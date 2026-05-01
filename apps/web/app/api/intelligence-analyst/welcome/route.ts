import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getServerSupabase, getUserProfile } from '@/lib/auth/session';

// GET /api/intelligence-analyst/welcome — first-load greeting hint (§4.9).
//
// Returns:
//   { firstName: string | null, lastActiveIso: string | null }
//
// `lastActiveIso` is intentionally NOT the most recent user_queries
// timestamp — that one is from the current session. Instead we
// look for the freshest row that is at least 5 minutes old, which
// is a reasonable proxy for "the previous session". Returns null
// when no such row exists (true first-time user).

const FRESH_SESSION_WINDOW_MS = 5 * 60 * 1000;

export async function GET(_req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const profile = await getUserProfile();
  const firstName = extractFirstName(profile?.display_name ?? null) ?? extractFirstName(user.email ?? null);

  const supabase = getServerSupabase();
  const cutoff = new Date(Date.now() - FRESH_SESSION_WINDOW_MS).toISOString();
  const { data } = await supabase
    .from('user_queries')
    .select('last_run_at')
    .lte('last_run_at', cutoff)
    .order('last_run_at', { ascending: false })
    .limit(1);
  const lastActiveIso = data?.[0]?.last_run_at ?? null;

  return NextResponse.json({ firstName, lastActiveIso });
}

function extractFirstName(input: string | null): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  // If it's an email, take the local-part before @ and split on common separators.
  const local = trimmed.includes('@') ? trimmed.split('@')[0] : trimmed;
  const first = local.split(/[\s._-]+/)[0];
  if (!first) return null;
  return first.charAt(0).toUpperCase() + first.slice(1);
}
