import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase-server';
import { isFounder } from '@/lib/admin/access';

// GET /api/admin/advocate-candidates
// Founder-only. Surfaces the spec §1.6 candidate query: users with
// at least 5 attributed signups in the last 90 days who are not
// currently flagged as advocates.
//
// Used by the admin advocate panel to populate the "Candidates"
// section. Returns up to 50 rows, ordered by attributed signup count
// descending.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const WINDOW_DAYS = 90;
const MIN_SIGNUPS = 5;
const MAX_RESULTS = 50;

type CandidateRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  public_id: string;
  attributed_signups: number;
};

export async function GET(_req: NextRequest) {
  const caller = await getCurrentUser();
  if (!caller || !isFounder(caller)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const admin = createServerSupabase();
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60_000).toISOString();

  // Pull every recent referral, then aggregate in app memory. This is
  // simpler than nesting a GROUP BY through the PostgREST builder and
  // the result set is small (one row per recent paid signup × maybe
  // 100s in any plausible launch window).
  const { data: referred, error: rErr } = await admin
    .from('user_profiles')
    .select('id, referred_by')
    .gte('created_at', since)
    .not('referred_by', 'is', null);

  if (rErr) {
    return NextResponse.json({ error: rErr.message }, { status: 500 });
  }

  const counts = new Map<string, number>();
  for (const row of referred ?? []) {
    const r = row as { referred_by: string | null };
    if (!r.referred_by) continue;
    counts.set(r.referred_by, (counts.get(r.referred_by) ?? 0) + 1);
  }

  const eligibleIds = [...counts.entries()]
    .filter(([, n]) => n >= MIN_SIGNUPS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_RESULTS)
    .map(([id]) => id);

  if (eligibleIds.length === 0) {
    return NextResponse.json({ candidates: [], window_days: WINDOW_DAYS });
  }

  const { data: profiles, error: pErr } = await admin
    .from('user_profiles')
    .select('id, email, display_name, public_id, advocate_state')
    .in('id', eligibleIds)
    .eq('advocate_state', 'none');

  if (pErr) {
    return NextResponse.json({ error: pErr.message }, { status: 500 });
  }

  const candidates: CandidateRow[] = (profiles ?? [])
    .map((p) => {
      const row = p as {
        id: string;
        email: string | null;
        display_name: string | null;
        public_id: string;
      };
      return {
        id: row.id,
        email: row.email,
        display_name: row.display_name,
        public_id: row.public_id,
        attributed_signups: counts.get(row.id) ?? 0,
      };
    })
    .sort((a, b) => b.attributed_signups - a.attributed_signups);

  return NextResponse.json({ candidates, window_days: WINDOW_DAYS });
}
