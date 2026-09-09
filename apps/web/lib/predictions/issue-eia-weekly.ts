import { loadFamilyCalibration, priorFor, applyRecalibration, calibrationContext } from './calibration';

/** Shape of eia_draw_plan() (migration 129, extended by migration 154). */
interface EiaDrawPlan {
  n: number;
  base_rate: number;
  eligible: boolean;
  as_of: string | null;
  current_cell: string | null;
  forecast: number;
  cells: Record<string, { n: number; k?: number; rate: number; parent?: string }>;
  // Migration 154 — absent until it is applied. The issuer must not depend
  // on any of these; it records them when they are there.
  model_version?: string;
  floor_kbbl?: number;
  current_parent_cell?: string | null;
  parent_forecast?: number | null;
  current_features?: {
    d1: number;
    run: string;
    low: number;
    level_kbbl: number;
    cell_n: number;
    cell_k: number;
  } | null;
  parent_cells?: Record<string, { n: number; k: number; rate: number }>;
}
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

  // THE FORECAST IS A DIRECTION, NOT A RATE (mig 129). The old model
  // predicted a blended week-over-week draw RATE, and a rate is a level — it
  // cannot turn when the series turns, which is exactly how §8.3 caught it
  // running 0.500 -> 0.573 -> 0.688 while the observed rate ran 1.000 ->
  // 0.500 -> 0.000. Cushing is autocorrelated: last week's direction plus
  // whether the last three weeks agree separates the outcome. Walk-forward
  // over 199 weeks, expanding window and no lookahead, mig 129 measured
  // +0.0572 against -0.0065 for the rate model.
  //
  // MIG 154 ADDS ONE FEATURE, measured the same way: whether the baseline
  // print sits below the 22,000 kbbl operational floor. Drawing into tank
  // bottoms is self-limiting — below the floor the next week drew 0.344 of
  // the time against 0.545 above — and it lifts the walk-forward to +0.0854,
  // positive in both halves (+0.127 / +0.043 where mig 129 was +0.110 /
  // +0.004). The evidence is thin (32 scored weeks below the floor) and the
  // plan says so under `evidence`; the feature values are recorded on every
  // claim so the live record can confirm or refute it. Mig 154 also reads
  // the next claim's cell from the newest print's own direction — mig 129
  // read the week before it, one week stale.
  const { data: planData, error: planErr } = await supabase.rpc('eia_draw_plan');
  const plan = planErr ? null : (planData as EiaDrawPlan | null);

  // The fallback ladder, most-informed first. 0.5 survives only where the
  // family itself has no history — the one case it is honest (mig 126).
  const cal = await loadFamilyCalibration(supabase);
  const rawMean = plan?.eligible && Number.isFinite(plan.forecast)
    ? round3(clampProbability(plan.forecast))
    : draw == null
      ? priorFor(cal, 'eia_weekly_inventory')
      : round3(clampProbability(draw.rate));
  // Self-gating: applies only while this family passes its own leave-one-out
  // test. It does NOT today — measured skill -0.1839 -> -0.3082 — because
  // recalibration fixes bias, not direction, and §8.3 found this forecaster
  // leaning the wrong way. The call is re-made from live data every run.
  const predictedMean = round3(clampProbability(
    applyRecalibration(cal, 'eia_weekly_inventory', rawMean),
  ));
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
        forecast_basis:
          draw == null
            ? 'flat_prior_insufficient_history'
            : draw.anchor === 'prior_history'
              ? 'wow_draw_rate_regime_blend'
              : 'wow_draw_rate_recent_vs_uninformative',
        forecast_sample_weeks: draw?.transitions ?? 0,
        // Which anchor the recent regime was shrunk toward, and how much
        // history stood behind it. A reader must be able to tell a blend
        // against real climatology apart from one against a 0.5 prior —
        // they are different claims and they deserve different trust.
        ...calibrationContext(cal, 'eia_weekly_inventory'),
        // What the streak model saw and decided. Recorded so a reader can
        // check the forecast against the cell it came from.
        forecast_model: plan?.eligible
          ? plan.model_version === 'v2-floor'
            ? 'streak_direction_floor'
            : 'streak_direction'
          : 'legacy_draw_rate',
        forecast_model_version: plan?.model_version ?? (plan ? 'v1' : null),
        forecast_cell: plan?.current_cell ?? null,
        forecast_cell_rate: plan?.forecast ?? null,
        forecast_cell_n: plan?.current_features?.cell_n ?? null,
        forecast_cells_n: plan?.n ?? null,
        forecast_series_as_of: plan?.as_of ?? null,
        // The feature values the cell was built from (mig 154), so a reader
        // can recompute the cell from the prints and catch a stale one — the
        // failure mig 154 fixed in mig 129's plan. The parent cell and its
        // rate are what mig 129 would have said, kept for the comparison.
        forecast_features: plan?.current_features ?? null,
        forecast_floor_kbbl: plan?.floor_kbbl ?? null,
        forecast_parent_cell: plan?.current_parent_cell ?? null,
        forecast_parent_rate: plan?.parent_forecast ?? null,
        forecast_anchor: draw?.anchor ?? null,
        forecast_anchor_transitions: draw?.anchor_transitions ?? 0,
        // Both inputs are recorded so a reader can see WHY the forecast
        // sits where it does, and so a future audit can tell a regime
        // call apart from a climatology call.
        forecast_recent_rate: draw?.recent_rate ?? null,
        forecast_long_rate: draw?.long_rate ?? null,
        forecast_recent_weeks: RECENT_WEEKS,
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
/**
 * Week-over-week draw rate, weighted toward the RECENT regime.
 *
 * The long-run rate over ~120 weeks was the previous forecast, and it
 * cost real skill: it emitted ~0.5–0.59 through a stretch in which
 * Cushing drew in nine of eleven weeks (~82%). The platform sells a
 * regime-shift detector and its own forecaster was using a window long
 * enough to average the regime away.
 *
 * The fix is a blend, not a swap: the recent window alone would be
 * jumpy on a handful of transitions, and the long window alone is what
 * we just diagnosed. Weighting the recent window by its own sample size
 * (n/(n+K), the same credibility shrinkage the Reputation Note uses)
 * lets the forecast follow a regime once there is enough evidence for
 * one, and fall back toward climatology when there is not.
 *
 * CORRECTION 2026-08-15 — the "~120 weeks" above was never true. The
 * caller asks for 120 prints but the ingest cron fetched only the last
 * 12 per run and accreted from its own start date, so the table held 25
 * observations (24 transitions, from 2026-02-27). Two consequences, both
 * fixed here and in the ingest route:
 *
 *   1. The anchor was NOT climatology, it was the last six months.
 *   2. The anchor CONTAINED the recent window, so the blend shrank the
 *      recent rate toward a set half-composed of itself — ~83% effective
 *      weight on the last 12 weeks against an intended 67%.
 *
 * Measured cost: through mid-July the series ran a sustained drawdown
 * (Cushing 30,568 → 18,957). It reversed on 2026-07-31 and 2026-08-07
 * with the two largest builds on record, while the forecast climbed
 * 0.500 → 0.573 → 0.688. The July fix cured averaging-the-regime-away
 * and replaced it with lagging the regime.
 *
 * The anchor is now strictly disjoint, and when it is too thin to mean
 * anything (< MIN_ANCHOR_TRANSITIONS) we shrink toward 0.5 and SAY SO in
 * the stored context rather than calling six months "climatology".
 * Backfill the history (ingest-eia-inventory?length=300) and the anchor
 * becomes real without touching this file.
 */
const RECENT_WEEKS = 12;
const SHRINKAGE_K = 6;

/**
 * Minimum transitions the anchor window needs before it counts as an
 * estimate of anything. Below this we shrink toward an uninformative 0.5
 * rather than toward a handful of prints dressed up as climatology —
 * absence of history is not a base rate.
 */
const MIN_ANCHOR_TRANSITIONS = 26;
const UNINFORMATIVE_PRIOR = 0.5;

function weekOverWeekDrawRate(
  rows: { period: string; value: number | string }[],
): {
  rate: number;
  transitions: number;
  recent_rate: number | null;
  long_rate: number | null;
  anchor: 'prior_history' | 'uninformative_prior';
  anchor_transitions: number;
} | null {
  const MIN_HISTORY = 8;
  const vals = rows
    .slice()
    .sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0))
    .map((r) => Number(r.value))
    .filter((n) => Number.isFinite(n));
  if (vals.length < MIN_HISTORY) return null;

  const rate = (series: number[]) => {
    let draws = 0, transitions = 0;
    for (let i = 1; i < series.length; i++) {
      transitions++;
      if (series[i] < series[i - 1]) draws++;
    }
    return transitions ? { r: draws / transitions, n: transitions } : null;
  };

  const recent = rate(vals.slice(-(RECENT_WEEKS + 1)));

  // DISJOINT anchor. Previously this was rate(vals) — the whole series —
  // which CONTAINS the recent window, so the blend shrank the recent rate
  // toward a set half-composed of itself. With 25 prints on hand that put
  // ~83% of the weight on the last 12 weeks instead of the intended 67%,
  // and the "credibility" term was measuring nothing independent.
  // The anchor is now strictly the prints BEFORE the recent window.
  const anchorSeries = vals.slice(0, Math.max(0, vals.length - RECENT_WEEKS));
  const anchorRate = rate(anchorSeries);

  const anchorUsable =
    anchorRate != null && anchorRate.n >= MIN_ANCHOR_TRANSITIONS;
  const anchorValue = anchorUsable ? anchorRate.r : UNINFORMATIVE_PRIOR;

  if (!recent) {
    return {
      rate: anchorValue,
      transitions: anchorRate?.n ?? 0,
      recent_rate: null,
      long_rate: anchorUsable ? Number(anchorRate.r.toFixed(3)) : null,
      anchor: anchorUsable ? 'prior_history' : 'uninformative_prior',
      anchor_transitions: anchorRate?.n ?? 0,
    };
  }

  // Credibility blend: the recent window earns its weight against an
  // independent anchor.
  const w = recent.n / (recent.n + SHRINKAGE_K);
  const blended = w * recent.r + (1 - w) * anchorValue;

  return {
    rate: blended,
    transitions: recent.n + (anchorRate?.n ?? 0),
    recent_rate: Number(recent.r.toFixed(3)),
    long_rate: anchorUsable ? Number(anchorRate!.r.toFixed(3)) : null,
    anchor: anchorUsable ? 'prior_history' : 'uninformative_prior',
    anchor_transitions: anchorRate?.n ?? 0,
  };
}
