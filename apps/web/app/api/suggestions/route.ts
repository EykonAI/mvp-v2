import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getServerSupabase } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase-server';
import {
  buildSuggestions,
  type Suggestion,
} from '@/lib/intelligence-analyst/suggestions';
import type { UserQueryRow } from '@/lib/intelligence-analyst/relevance';
import seed from '@/lib/fixtures/posture_seed.json';

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
  const anomalySuggestions = await loadAnomalySuggestions().catch(() => []);

  const suggestions = buildSuggestions({ history, anomalySuggestions });
  return NextResponse.json({ suggestions });
}

async function loadAnomalySuggestions(): Promise<Suggestion[]> {
  const admin = createServerSupabase();

  // The freshest cross-domain convergences become "investigate this" prompts.
  // convergence_events columns are location / synthesis / created_at — the
  // previous query selected theatre_slug/event_type/severity/observed_at (none
  // of which exist) AND gated on user_interest_vectors (empty until interest
  // vectors ship), so this slot was doubly dead. It now reads the global recent
  // feed, which is live since the Convergence Feed fix (#208).
  const { data: events } = await admin
    .from('convergence_events')
    .select('location, synthesis, created_at')
    .order('created_at', { ascending: false })
    .limit(2);

  return (events ?? []).map((e: any) => ({
    text: `Investigate the recent cross-domain convergence in ${theatreLabelFor(e.location) ?? 'the flagged region'} around ${shortDate(e.created_at)}`,
    buckets: ['Conflict', 'Maritime'] as const, // a convergence spans ≥2 domains by construction
    slot: 'anomaly' as const,
  }));
}

// convergence_events.location is the cell-centre point, e.g. "(45.0, 35.0)".
// Map it to a posture-seed theatre label when it falls inside a theatre bbox,
// so the prompt reads "in the Black Sea" rather than a raw coordinate.
function theatreLabelFor(location: string | null): string | null {
  const m = /\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?/.exec(location ?? '');
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lon = parseFloat(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  for (const t of seed.theatres) {
    const b = (t as { bbox?: { lat_min: number; lat_max: number; lon_min: number; lon_max: number } }).bbox;
    if (!b) continue;
    if (lat >= b.lat_min && lat <= b.lat_max && lon >= b.lon_min && lon <= b.lon_max) {
      return (t as { label?: string }).label ?? (t as { slug: string }).slug;
    }
  }
  return null;
}

function shortDate(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return 'recent days';
  }
}

