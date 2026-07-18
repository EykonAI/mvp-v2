import type { Resolver } from './types';

/**
 * NASA FIRMS thermal-anomaly resolver.
 *
 * target_observable convention (set by issue-firms-weekly.ts and by
 * First Ten templates):
 *
 *   `firms:thermal:<facility_type>:<facility_id>:<resolves_at YYYY-MM-DD>`
 *
 * Question form (the ONLY form this resolver will score):
 *
 *   "Will a thermal anomaly be DETECTED within <radius> km of
 *    <facility> during the <N>-day window ending <date>?"
 *
 * HONESTY INVARIANT — this resolves a DETECTION, not an event. A hot
 * pixel is not a confirmed fire and is certainly not a confirmed
 * strike; attribution is inference and belongs in the analyst's prose,
 * never in the resolution. Equally, cloud cover and overpass timing
 * mean absence of detection != absence of fire, which is why:
 *
 *   • the window must be COVERED by successful ingest runs before this
 *     resolver will score it — otherwise it returns null and defers to
 *     the next hourly score-predictions tick, exactly like the AIS
 *     chokepoint resolver defers on patchy reception;
 *   • a day with no observation row at all is treated as NOT covered,
 *     never as a zero-detection day.
 *
 * Resolution semantics (binary, mirrors the EIA and AIS resolvers):
 *   • observed = 1 when the window outcome matches context.predicted_direction
 *       'detected'     → at least one detection in the window
 *       'not_detected' → zero detections across the covered window
 *   • observed = 0 otherwise.
 */

const DEFAULT_WINDOW_DAYS = 7;
// A window is only scoreable if this share of its days carry a
// successful ingest run. Below it we defer rather than guess.
const MIN_COVERAGE_RATIO = 0.8;

export const resolveFirms: Resolver = async (row, supabase) => {
  const parsed = parseTargetObservable(row.target_observable);
  if (!parsed) return null;

  const ctx = readContext(row.context);
  if (!ctx) return null;

  const resolvesAtMs = Date.parse(row.resolves_at);
  if (!Number.isFinite(resolvesAtMs)) return null;

  const windowDays = ctx.windowDays;
  const windowStart = new Date(resolvesAtMs - windowDays * 86_400_000);
  const windowEnd = new Date(resolvesAtMs);

  // 1 · Coverage gate — did the ingest actually run across this window?
  const { data: runs, error: runsErr } = await supabase
    .from('firms_ingest_runs')
    .select('day_covered, ok')
    .gte('day_covered', ymd(windowStart))
    .lte('day_covered', ymd(windowEnd))
    .eq('ok', true);

  if (runsErr || !runs) return null;

  const coveredDays = new Set(
    (runs as { day_covered: string }[]).map((r) => r.day_covered),
  );
  if (coveredDays.size < Math.ceil(windowDays * MIN_COVERAGE_RATIO)) {
    // Not enough successful ingest days — defer, do not score.
    return null;
  }

  // 2 · Observations for this facility across the window.
  const { data: obs, error: obsErr } = await supabase
    .from('firms_facility_observations')
    .select('period, detection_count')
    .eq('facility_type', parsed.facilityType)
    .eq('facility_id', parsed.facilityId)
    .gte('period', ymd(windowStart))
    .lte('period', ymd(windowEnd));

  if (obsErr || !obs) return null;

  const rows = obs as { period: string; detection_count: number | null }[];
  // Only count days that were BOTH observed and covered by a run.
  const scorable = rows.filter((r) => coveredDays.has(r.period));
  if (scorable.length < Math.ceil(windowDays * MIN_COVERAGE_RATIO)) return null;

  const detections = scorable.reduce(
    (sum, r) => sum + (Number(r.detection_count) || 0),
    0,
  );
  const wasDetected = detections > 0;
  const correct =
    ctx.predictedDirection === 'detected' ? wasDetected : !wasDetected;

  return {
    observed: correct ? 1 : 0,
    source_url: 'https://eykon.ai/calibration',
  };
};

function parseTargetObservable(
  t: string,
): { facilityType: string; facilityId: string } | null {
  // firms:thermal:<facility_type>:<facility_id>:<YYYY-MM-DD>
  const PREFIX = 'firms:thermal:';
  if (!t.startsWith(PREFIX)) return null;
  const rest = t.slice(PREFIX.length);

  const lastColon = rest.lastIndexOf(':');
  if (lastColon <= 0) return null;
  const withoutDate = rest.slice(0, lastColon);

  const firstColon = withoutDate.indexOf(':');
  if (firstColon <= 0) return null;

  const facilityType = withoutDate.slice(0, firstColon);
  // facility_id may itself contain colons (OSM-style ids) — keep the remainder whole.
  const facilityId = withoutDate.slice(firstColon + 1);
  if (!facilityType || !facilityId) return null;

  return { facilityType, facilityId };
}

interface FirmsContext {
  predictedDirection: 'detected' | 'not_detected';
  windowDays: number;
}

function readContext(context: Record<string, unknown> | null): FirmsContext | null {
  if (!context) return null;
  const direction = (context as Record<string, unknown>).predicted_direction;
  if (direction !== 'detected' && direction !== 'not_detected') return null;

  const rawWindow = Number((context as Record<string, unknown>).window_days);
  const windowDays =
    Number.isFinite(rawWindow) && rawWindow > 0 && rawWindow <= 30
      ? Math.trunc(rawWindow)
      : DEFAULT_WINDOW_DAYS;

  return { predictedDirection: direction, windowDays };
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
