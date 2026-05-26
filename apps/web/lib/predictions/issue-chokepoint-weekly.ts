import { createServerSupabase } from '@/lib/supabase-server';
import { computePredictionHash } from './hash';

/**
 * Issue this week's chokepoint AIS-anchored prediction.
 *
 * Called Mondays ~09:00 UTC via /api/cron/issue-chokepoint-weekly.
 * For a given chokepoint slug:
 *   1. Computes resolves_at = upcoming Sunday 23:59 UTC.
 *   2. Reads ais_chokepoint_observations for the prior 28 days.
 *   3. Refuses to issue if < 14 observations exist (insufficient
 *      baseline). The daily snapshot cron warms this up over the
 *      first two weeks after deploy.
 *   4. Computes mean + stddev of vessel_count over the baseline.
 *   5. Inserts a predictions_register row tagged source='ais' with
 *      a flat 0.5 prior and predicted_direction='above'.
 *
 * Idempotent within a Monday→Sunday window: a second call with the
 * same target_observable returns skipped_reason='already_issued'
 * rather than duplicating.
 *
 * The flat 0.5 prior is intentional v1 behaviour — the marketing
 * value is the resolution drumbeat + the audit trail, not the
 * forecast quality. A future PR can swap the prior for an eYKON
 * model output without touching the resolver.
 */
export interface IssueChokepointWeeklyResult {
  ok: boolean;
  inserted_id?: string;
  public_id?: string;
  resolves_at?: string;
  skipped_reason?: string;
}

const BASELINE_WINDOW_DAYS = 28;
const MIN_BASELINE_OBSERVATIONS = 14;

export async function issueChokepointWeekly(opts: {
  slug?: string;
  now?: Date;
} = {}): Promise<IssueChokepointWeeklyResult> {
  const slug = opts.slug ?? 'hormuz';
  const now = opts.now ?? new Date();
  const supabase = createServerSupabase();

  const resolvesAt = nextSundayResolveTime(now);
  const targetObservable = `ais:chokepoint:${slug}:${ymdUtc(resolvesAt)}`;

  // Idempotency: one prediction per (source, target_observable).
  const { data: existing } = await supabase
    .from('predictions_register')
    .select('id, public_id')
    .eq('source', 'ais')
    .eq('target_observable', targetObservable)
    .maybeSingle();

  if (existing) {
    return {
      ok: true,
      skipped_reason: 'already_issued',
      inserted_id: existing.id as string,
      public_id: existing.public_id as string,
      resolves_at: resolvesAt.toISOString(),
    };
  }

  // Pull the prior 28 days of snapshots.
  const baselineStart = new Date(now.getTime() - BASELINE_WINDOW_DAYS * 24 * 3600 * 1000);
  const { data: obs, error: obsErr } = await supabase
    .from('ais_chokepoint_observations')
    .select('period, vessel_count')
    .eq('chokepoint', slug)
    .gte('period', ymdUtc(baselineStart))
    .lte('period', ymdUtc(now))
    .order('period', { ascending: true });

  if (obsErr) {
    return { ok: false, skipped_reason: `baseline_read: ${obsErr.message}` };
  }
  if (!obs || obs.length < MIN_BASELINE_OBSERVATIONS) {
    return {
      ok: false,
      skipped_reason: 'insufficient_baseline',
      resolves_at: resolvesAt.toISOString(),
    };
  }

  const counts = obs
    .map((r) => Number(r.vessel_count))
    .filter((n) => Number.isFinite(n));
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  const variance =
    counts.reduce((a, b) => a + (b - mean) ** 2, 0) / counts.length;
  const stddev = Math.sqrt(variance);

  const predictedDirection: 'above' | 'below' = 'above';
  const predictedMean = 0.5;
  const statement = buildStatement({
    slug,
    resolvesAt,
    baselineMean: mean,
    baselineWindowDays: BASELINE_WINDOW_DAYS,
  });

  const hash = computePredictionHash({
    statement,
    targetObservable,
    resolvesAt,
    issuedAt: now,
    predictedMean,
  });

  const { data: inserted, error } = await supabase
    .from('predictions_register')
    .insert({
      feature: 'ais_chokepoint_weekly',
      context: {
        chokepoint: slug,
        baseline_window_days: BASELINE_WINDOW_DAYS,
        baseline_mean_vessels: round2(mean),
        baseline_stddev: round2(stddev),
        baseline_observation_count: counts.length,
        predicted_direction: predictedDirection,
      },
      predicted_distribution: { mean: predictedMean, type: 'point' },
      target_observable: targetObservable,
      target_window_hours: 24 * 7,
      issued_at: now.toISOString(),
      resolves_at: resolvesAt.toISOString(),
      persona: 'analyst',
      statement,
      source: 'ais',
      hash,
      // public_id intentionally omitted — DB DEFAULT generates the token.
    })
    .select('id, public_id')
    .single();

  if (error || !inserted) {
    return { ok: false, skipped_reason: error?.message ?? 'insert_failed' };
  }

  return {
    ok: true,
    inserted_id: inserted.id as string,
    public_id: inserted.public_id as string,
    resolves_at: resolvesAt.toISOString(),
  };
}

/**
 * Next Sunday at 23:59 UTC relative to `now`. If today is Sunday but
 * past 23:59 UTC, returns next Sunday so we never resolve in the past.
 * Sunday-ending matches how trade journals report weekly maritime data.
 */
function nextSundayResolveTime(now: Date): Date {
  const candidate = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      23, 59, 0, 0,
    ),
  );
  const dayOfWeek = candidate.getUTCDay(); // 0 = Sunday
  let offsetDays = (7 - dayOfWeek) % 7;
  if (offsetDays === 0 && now.getTime() > candidate.getTime()) {
    offsetDays = 7;
  }
  candidate.setUTCDate(candidate.getUTCDate() + offsetDays);
  return candidate;
}

function buildStatement(args: {
  slug: string;
  resolvesAt: Date;
  baselineMean: number;
  baselineWindowDays: number;
}): string {
  const label = chokepointLabel(args.slug);
  const weekEnd = ymdUtc(args.resolvesAt);
  const mean = Math.round(args.baselineMean);
  const weeks = Math.round(args.baselineWindowDays / 7);
  return `${label} vessel transits in the week ending ${weekEnd} (UTC) will exceed the trailing ${weeks}-week average of ${mean} vessels/day.`;
}

function chokepointLabel(slug: string): string {
  switch (slug) {
    case 'hormuz':
      return 'Strait of Hormuz';
    case 'suez':
      return 'Suez Canal';
    case 'bab-el-mandeb':
      return 'Bab-el-Mandeb';
    case 'bosphorus':
      return 'Bosphorus';
    case 'malacca':
      return 'Strait of Malacca';
    case 'panama':
      return 'Panama Canal';
    default:
      return slug;
  }
}

function ymdUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
