import { createServerSupabase } from '@/lib/supabase-server';
import { EIA_CUSHING_CRUDE_STOCKS } from '@/lib/eia/client';
import { computePredictionHash } from './hash';

export interface IssueEiaWeeklyResult {
  ok: boolean;
  inserted_id?: string;
  public_id?: string;
  resolves_at?: string;
  skipped_reason?: string;
}

/**
 * Issue this week's EIA Cushing inventory prediction.
 *
 * Called every Monday ~09:00 UTC via /api/cron/issue-eia-weekly.
 * Computes the upcoming Wednesday 15:30 UTC (~10:30 ET, the EIA
 * publication time) as resolves_at, snapshots the latest stored
 * Cushing print as baseline, and inserts a predictions_register row
 * tagged source='eia'.
 *
 * Idempotent within a Monday→Wednesday window: a second call with the
 * same target_observable is skipped rather than duplicated.
 *
 * The predicted distribution starts at a neutral 0.5 mean — a flat
 * prior. PR-CAL-5's resolver will score whatever forecast lands here,
 * and a future PR can swap the issuer for an eYKON model output. For
 * now this exists so the resolution pipeline has a recurring source of
 * resolvable, marketing-shareable predictions.
 */
export async function issueEiaWeekly(opts: { now?: Date } = {}): Promise<IssueEiaWeeklyResult> {
  const now = opts.now ?? new Date();
  const supabase = createServerSupabase();

  const resolvesAt = nextWednesdayPublication(now);
  const targetObservable = `eia:${EIA_CUSHING_CRUDE_STOCKS}:${ymdUtc(resolvesAt)}`;

  // Idempotency — one prediction per (source, target_observable).
  const { data: existing } = await supabase
    .from('predictions_register')
    .select('id, public_id')
    .eq('source', 'eia')
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

  const { data: latest } = await supabase
    .from('eia_inventory_observations')
    .select('period, value')
    .eq('series_id', EIA_CUSHING_CRUDE_STOCKS)
    .order('period', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latest) {
    return { ok: false, skipped_reason: 'no_baseline_observation' };
  }

  const baseline = Number(latest.value);
  const predictedMean = 0.5; // flat prior; see fn-doc
  const statement = `EIA Cushing crude inventories on ${ymdUtc(resolvesAt)} will draw versus the prior week's ${formatThousands(baseline)} kbbl print.`;

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
      feature: 'eia_weekly_inventory',
      context: {
        series_id: EIA_CUSHING_CRUDE_STOCKS,
        baseline_kbbl: baseline,
        baseline_period: latest.period,
      },
      predicted_distribution: { mean: predictedMean, type: 'point' },
      target_observable: targetObservable,
      target_window_hours: 0,
      issued_at: now.toISOString(),
      resolves_at: resolvesAt.toISOString(),
      persona: 'commodities',
      statement,
      source: 'eia',
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
 * Next Wednesday at 15:30 UTC (≈10:30 ET) relative to `now`. If today
 * is Wednesday but already past 15:30 UTC, returns the following
 * Wednesday so we never resolve a prediction in the past.
 */
function nextWednesdayPublication(now: Date): Date {
  const candidate = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    15, 30, 0, 0,
  ));
  const dayOfWeek = candidate.getUTCDay(); // 0=Sun … 3=Wed
  let offsetDays = (3 - dayOfWeek + 7) % 7;
  if (offsetDays === 0 && now.getTime() > candidate.getTime()) {
    offsetDays = 7;
  }
  candidate.setUTCDate(candidate.getUTCDate() + offsetDays);
  return candidate;
}

function ymdUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatThousands(n: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(n));
}
