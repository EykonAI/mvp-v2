import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { resolveBySource, type PredictionRow } from '@/lib/predictions/resolvers';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

// Calibration honesty gate: the Ledger is "warming up" (degraded) until it has a
// meaningful sample of *informative* forecasts. A flat 0.5 prior on a binary
// outcome yields a Brier of exactly 0.25 — the no-skill identity, not a real
// track record — so degraded is gated on whether any prediction departs from the
// 0.5 prior AND on the resolved-sample count, NOT on whether the metric is "—".
const FLAT_PRIOR = 0.5;
const INFORMATIVE_EPS = 0.05; // a prediction is informative only if |mean - 0.5| >= this
const MIN_RESOLVED = 10;      // require this many resolved outcomes before publishing a score

/**
 * Score-predictions · hourly.
 * Finds predictions_register rows whose resolves_at ≤ now but have
 * no prediction_outcomes row yet, dispatches each to its per-source
 * resolver (PR-CAL-5), scores the result, and materialises the
 * aggregate into calibration_summary.
 *
 * Per-source resolvers live in lib/predictions/resolvers/*.ts. A
 * resolver returning null means "data not yet available, retry on the
 * next tick" — the row stays in the unscored pool until it resolves
 * or the operator intervenes.
 */
export async function POST(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const supabase = createServerSupabase();
  const now = new Date();

  const { data: pending, error } = await supabase
    .from('predictions_register')
    .select('id, feature, source, predicted_distribution, target_observable, resolves_at, issued_at, context, persona, prediction_outcomes(prediction_id)')
    .lte('resolves_at', now.toISOString())
    .limit(500);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const toScore = (pending ?? []).filter((r: any) => !r.prediction_outcomes || r.prediction_outcomes.length === 0);
  const writes: any[] = [];
  let deferred = 0;

  for (const r of toScore) {
    const resolution = await resolveBySource(r as PredictionRow, supabase);
    if (resolution == null) {
      deferred++;
      continue;
    }
    const observed = resolution.observed;
    const predicted = Number((r.predicted_distribution as any)?.mean ?? 0);
    const brier = (predicted - observed) ** 2;
    const logLoss = -Math.log(Math.max(1e-6, 1 - Math.abs(predicted - observed)));
    const bin = Math.max(0, Math.min(9, Math.floor(predicted * 10)));
    writes.push({
      prediction_id: r.id,
      observed_value: observed,
      observed_at: now.toISOString(),
      brier: round3(brier),
      log_loss: round3(logLoss),
      calibration_bin: bin,
      resolution_source_url: resolution.source_url,
    });
  }

  if (writes.length > 0) {
    await supabase.from('prediction_outcomes').insert(writes);
  }

  // Materialise the aggregate into calibration_summary.
  await materialiseSummary(supabase);

  return NextResponse.json({ ok: true, scored: writes.length, deferred });
}

async function materialiseSummary(supabase: any) {
  const windows = [
    { key: 'brier',     feature: null,                  window_days: 30 },
    { key: 'posture',   feature: 'posture_shift',       window_days: 30 },
    { key: 'conflict',  feature: 'conflict_escalation', window_days: 30 },
    { key: 'trade',     feature: 'trade_flow',          window_days: 30 },
    { key: 'precision', feature: null,                  window_days: 7 },
  ];
  const metrics: any[] = [];
  let aggResolved = 0;        // resolved outcomes in the all-feature 30d window
  let aggInformative = false; // any of those predictions departs from the 0.5 prior
  for (const w of windows) {
    const since = new Date(Date.now() - w.window_days * 24 * 3600_000).toISOString();
    let query = supabase
      .from('prediction_outcomes')
      .select('brier, calibration_bin, observed_at, predictions_register!inner(feature, predicted_distribution)')
      .gte('observed_at', since);
    if (w.feature) query = query.eq('predictions_register.feature', w.feature);
    const { data } = await query.limit(5000);
    const briers = (data ?? []).map((r: any) => Number(r.brier)).filter((x: number) => Number.isFinite(x));
    const avgBrier = briers.length ? briers.reduce((a: number, b: number) => a + b, 0) / briers.length : null;
    metrics.push({
      key: w.key,
      label: labelFor(w.key),
      value: avgBrier == null ? '—' : avgBrier.toFixed(3),
      trend: 'flat',
      spark: briers.slice(-8).length >= 2 ? briers.slice(-8) : [0.2, 0.2, 0.2, 0.2, 0.2, 0.2],
    });

    // Derive the honesty gate from the headline (all-feature, 30d) window.
    if (w.key === 'brier') {
      aggResolved = briers.length;
      aggInformative = (data ?? []).some((r: any) => {
        const reg = Array.isArray(r.predictions_register) ? r.predictions_register[0] : r.predictions_register;
        const mean = Number(reg?.predicted_distribution?.mean);
        return Number.isFinite(mean) && Math.abs(mean - FLAT_PRIOR) >= INFORMATIVE_EPS;
      });
    }
  }

  // Warming up until there is a meaningful sample of informative forecasts.
  // (Previously this keyed off metrics.every(value === '—'), so a flat-0.5
  // Brier of 0.250 silently flipped the Ledger to "live" and hid the caveat.)
  const degraded = aggResolved < MIN_RESOLVED || !aggInformative;

  await supabase
    .from('calibration_summary')
    .upsert(
      { id: 1, metrics, generated_at: new Date().toISOString(), degraded },
      { onConflict: 'id' },
    );
}

function labelFor(key: string): string {
  switch (key) {
    case 'brier':     return 'Aggregate Brier';
    case 'posture':   return 'Posture-Shift Monitor';
    case 'conflict':  return 'Conflict Escalation';
    case 'trade':     return 'Trade-Flow Horizon';
    case 'precision': return 'Alerts Precision@10';
    default:          return key;
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
