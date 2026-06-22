import { createServerSupabase } from '@/lib/supabase-server';
import { EIA_CUSHING_CRUDE_STOCKS } from '@/lib/eia/client';
import { computePredictionHash } from './hash';
import { round3, clampProbability } from './forecast';

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

  // Trailing history, newest first — [0] is the baseline print; the full set
  // feeds the base-rate forecast below.
  const { data: history } = await supabase
    .from('eia_inventory_observations')
    .select('period, value')
    .eq('series_id', EIA_CUSHING_CRUDE_STOCKS)
    .order('period', { ascending: false })
    .limit(120);

  const latest = history?.[0];
  if (!latest) {
    return { ok: false, skipped_reason: 'no_baseline_observation' };
  }

  const baseline = Number(latest.value);

  // Real forecast: the climatological week-over-week DRAW base rate — the
  // fraction of recent weeks whose print fell vs the prior week. Replaces the
  // flat 0.5 prior so the Ledger grades an informative forecast; falls back to
  // 0.5 only when there is too little history to estimate a rate.
  const draw = weekOverWeekDrawRate(history ?? []);
  const predictedMean = draw == null ? 0.5 : round3(clampProbability(draw.rate));
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
        forecast_basis: draw == null ? 'flat_prior_insufficient_history' : 'wow_draw_base_rate',
        forecast_sample_weeks: draw?.transitions ?? 0,
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

/**
 * Week-over-week DRAW base rate: the fraction of consecutive-week transitions
 * whose print fell vs the prior week. `rows` may arrive in any order — we sort
 * by period. Returns null when there are fewer than MIN_HISTORY prints (too
 * little to estimate an informative rate; the caller keeps the 0.5 prior).
 */
function weekOverWeekDrawRate(
  rows: { period: string; value: number | string }[],
): { rate: number; transitions: number } | null {
  const MIN_HISTORY = 8;
  const vals = rows
    .slice()
    .sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0))
    .map((r) => Number(r.value))
    .filter((n) => Number.isFinite(n));
  if (vals.length < MIN_HISTORY) return null;
  let draws = 0;
  let transitions = 0;
  for (let i = 1; i < vals.length; i++) {
    transitions++;
    if (vals[i] < vals[i - 1]) draws++;
  }
  return transitions ? { rate: draws / transitions, transitions } : null;
}
