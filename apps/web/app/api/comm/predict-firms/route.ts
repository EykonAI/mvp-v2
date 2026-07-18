import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { getCurrentUser } from '@/lib/auth/session';
import { computePredictionHash } from '@/lib/predictions/hash';
import { FIRMS_WINDOW_DAYS } from '@/lib/comm/firstTen';

// "Make a call" against a FIRMS-monitored facility (migration 081).
//
// The sibling of /api/comm/predict, for the second observable family.
// Where the Polymarket route scores you against a betting crowd, this
// one scores you against eYKON's own thermal-anomaly ingest — which is
// what gives conflict / energy-infrastructure analysts something in
// THEIR beat to build a Reputation Note on.
//
// The call is PUBLIC and sealed on the same commit-reveal rules, and is
// auto-scored by lib/predictions/resolvers/firms.ts once the window
// closes AND ingest coverage for that window is confirmed.
//
// HONESTY: the claim is about DETECTION, not about a strike or an
// outage. The statement text says "thermal anomaly detected" and must
// keep saying it.
//
// baseline_mean: unlike Polymarket there is no crowd price, so the
// baseline is the facility's own recent detection rate over the
// trailing baseline window. Brier skill therefore measures beating the
// naive base rate — the honest analogue of beating the market.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BASELINE_DAYS = 30;
const VALID_TYPES = new Set(['refinery', 'power_plant']);

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: {
    facility_type?: unknown;
    facility_id?: unknown;
    direction?: unknown;
    probability?: unknown;
    window_days?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const facilityType = typeof body.facility_type === 'string' ? body.facility_type : '';
  const facilityId = typeof body.facility_id === 'string' ? body.facility_id : '';
  const direction = typeof body.direction === 'string' ? body.direction : '';
  const probability = Number(body.probability);
  const rawWindow = Number(body.window_days);
  const windowDays =
    Number.isFinite(rawWindow) && rawWindow > 0 && rawWindow <= 30
      ? Math.trunc(rawWindow)
      : FIRMS_WINDOW_DAYS;

  if (
    !VALID_TYPES.has(facilityType) ||
    !facilityId ||
    (direction !== 'detected' && direction !== 'not_detected') ||
    !Number.isFinite(probability) ||
    probability <= 0 ||
    probability >= 1
  ) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const supabase = createServerSupabase();

  // The facility must actually be monitored — otherwise the resolver
  // could never settle the call and it would hang unresolved forever.
  const { data: facility } = await supabase
    .from('firms_facility_observations')
    .select('facility_name, country')
    .eq('facility_type', facilityType)
    .eq('facility_id', facilityId)
    .order('period', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!facility) {
    return NextResponse.json({ error: 'facility_not_monitored' }, { status: 404 });
  }

  const f = facility as { facility_name: string | null; country: string | null };
  const name = f.facility_name ?? facilityId;

  const now = new Date();
  const resolvesAt = new Date(now.getTime() + windowDays * 86_400_000);
  const targetObservable = `firms:thermal:${facilityType}:${facilityId}:${ymd(resolvesAt)}`;

  const { data: existing } = await supabase
    .from('predictions_register')
    .select('id')
    .eq('author_id', user.id)
    .eq('target_observable', targetObservable)
    .maybeSingle();
  if (existing) return NextResponse.json({ error: 'already_called' }, { status: 409 });

  // Base rate over the trailing window — the share of observed days
  // that carried at least one detection.
  const since = ymd(new Date(now.getTime() - BASELINE_DAYS * 86_400_000));
  const { data: history } = await supabase
    .from('firms_facility_observations')
    .select('detection_count')
    .eq('facility_type', facilityType)
    .eq('facility_id', facilityId)
    .gte('period', since);

  let baseline: number | null = null;
  if (Array.isArray(history) && history.length > 0) {
    const rows = history as { detection_count: number | null }[];
    const daysWithDetection = rows.filter((r) => (Number(r.detection_count) || 0) > 0).length;
    const rate = daysWithDetection / rows.length;
    // Probability that the WINDOW contains at least one detection,
    // from the daily rate — the like-for-like baseline for this claim.
    const windowRate = 1 - Math.pow(1 - rate, windowDays);
    const oriented = direction === 'detected' ? windowRate : 1 - windowRate;
    baseline = Math.max(0, Math.min(1, oriented));
  }

  const pct = Math.round(probability * 100);
  const phrase =
    direction === 'detected'
      ? 'a thermal anomaly WILL be detected'
      : 'NO thermal anomaly will be detected';
  const statement =
    `${name}${f.country ? ` (${f.country})` : ''} — ${phrase} within 5 km ` +
    `in the next ${windowDays} days @ ${pct}%`;

  const hash = computePredictionHash({
    statement,
    targetObservable,
    resolvesAt,
    issuedAt: now,
    predictedMean: probability,
  });

  const { data: inserted, error } = await supabase
    .from('predictions_register')
    .insert({
      feature: 'firms',
      context: {
        kind: 'user_call',
        facility_type: facilityType,
        facility_id: facilityId,
        predicted_direction: direction,
        window_days: windowDays,
      },
      predicted_distribution: { mean: probability, type: 'point' },
      target_observable: targetObservable,
      target_window_hours: windowDays * 24,
      issued_at: now.toISOString(),
      resolves_at: resolvesAt.toISOString(),
      persona: 'analyst',
      statement,
      source: 'firms',
      hash,
      author_id: user.id,
      baseline_mean: baseline,
      visibility: 'public',
    })
    .select('public_id')
    .single();

  if (error || !inserted) {
    return NextResponse.json({ error: error?.message ?? 'insert_failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, public_id: inserted.public_id });
}
