import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getServerSupabase } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase-server';
import {
  buildSuggestions,
  type Suggestion,
} from '@/lib/intelligence-analyst/suggestions';
import type { UserQueryRow } from '@/lib/intelligence-analyst/relevance';

// GET /api/suggestions
//
// Returns up to 8 personalised suggestions for the Suggested-tab,
// per the §3.3 algorithm:
//   3 history-inferred · 2 trending · 2 anomaly · 1 meta
//
// Cold-start (<3 historic queries) returns the curated static list.
// Refresh once per session — the client caches; mid-session updates
// would be too noisy per §3.3.

const HISTORY_WINDOW = 50;

export async function GET(_req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  // 1. History — RLS-enforced via the cookie-bound client.
  const userSupabase = getServerSupabase();
  const { data: historyData } = await userSupabase
    .from('user_queries')
    .select('id, query_text, response_text, tool_calls, domain_tags, created_at, last_run_at, run_count, exported_at, starred')
    .order('last_run_at', { ascending: false })
    .limit(HISTORY_WINDOW);
  const history = (historyData ?? []) as UserQueryRow[];

  // 2. Anomaly suggestions from convergence_events for the user's
  //    pinned theatres. Wrapped in try/catch — if the table or RPC
  //    isn't available, skip the slot rather than 500 the route.
  const anomalySuggestions = await loadAnomalySuggestions(user.id).catch(() => []);

  const suggestions = buildSuggestions({ history, anomalySuggestions });
  return NextResponse.json({ suggestions });
}

async function loadAnomalySuggestions(userId: string): Promise<Suggestion[]> {
  const admin = createServerSupabase();

  // 1. Pull pinned theatres for this user. The table is owned by
  //    the supervisor pipeline; we read with the service role.
  const { data: vec } = await admin
    .from('user_interest_vectors')
    .select('pinned_theatres')
    .eq('user_id', userId)
    .single();
  const theatres = (vec?.pinned_theatres ?? []) as string[];
  if (theatres.length === 0) return [];

  // 2. Recent convergence events for those theatres. The exact
  //    schema is owned by the Intelligence Center — best-effort
  //    select; fallback to empty.
  const { data: events } = await admin
    .from('convergence_events')
    .select('theatre_slug, event_type, severity, observed_at')
    .in('theatre_slug', theatres)
    .order('observed_at', { ascending: false })
    .limit(2);

  return (events ?? []).slice(0, 2).map((e: any) => ({
    text: `Investigate the convergence in ${prettifyTheatre(e.theatre_slug)} on ${shortDate(e.observed_at)} (${e.event_type})`,
    buckets: ['Conflict', 'Maritime'] as const, // anomalies span ≥2 buckets by construction
    slot: 'anomaly' as const,
  }));
}

function prettifyTheatre(slug: string): string {
  if (!slug) return 'a pinned theatre';
  return slug
    .split('-')
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

function shortDate(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return 'recent days';
  }
}

