import { createServerSupabase } from '@/lib/supabase-server';

// BRIEFS · Forecasts & scores. eYKON's OWN issued forecasts (the weekly
// chokepoint-transit and EIA-inventory calls) read from predictions_register
// and joined to prediction_outcomes for the resolved score. User COMM
// predictions and polymarket mirrors are excluded by feature — this surface is
// the platform's public track record only.
//
// Columns verified via supabase-ro (predictions_register, prediction_outcomes)
// before wiring, per the verify-don't-assert directive.

const EYKON_FORECAST_FEATURES = ['ais_chokepoint_weekly', 'eia_weekly_inventory'];

export interface ForecastRow {
  id: string;
  feature: string;
  statement: string;
  predictedMean: number | null;
  issuedAt: string;
  resolvesAt: string | null;
  observedValue: number | null;
  brier: number | null;
  resolved: boolean;
}

export interface ForecastBoard {
  open: ForecastRow[];
  resolved: ForecastRow[];
}

interface PredRow {
  id: string;
  feature: string;
  statement: string | null;
  predicted_distribution: { mean?: number } | null;
  issued_at: string;
  resolves_at: string | null;
}
interface OutRow {
  prediction_id: string;
  observed_value: number | string | null;
  brier: number | string | null;
}

export async function loadForecasts(limit = 40): Promise<ForecastBoard> {
  const board: ForecastBoard = { open: [], resolved: [] };
  try {
    const supabase = createServerSupabase();
    const { data: preds } = await supabase
      .from('predictions_register')
      .select('id, feature, statement, predicted_distribution, issued_at, resolves_at')
      .in('feature', EYKON_FORECAST_FEATURES)
      .order('issued_at', { ascending: false })
      .limit(limit);

    const rows = (preds ?? []) as unknown as PredRow[];
    if (rows.length === 0) return board;

    const { data: outs } = await supabase
      .from('prediction_outcomes')
      .select('prediction_id, observed_value, brier')
      .in(
        'prediction_id',
        rows.map((r) => r.id),
      );
    const outById = new Map<string, OutRow>(((outs ?? []) as unknown as OutRow[]).map((o) => [o.prediction_id, o]));

    for (const r of rows) {
      const out = outById.get(r.id);
      const mean = r.predicted_distribution && typeof r.predicted_distribution.mean === 'number' ? r.predicted_distribution.mean : null;
      const row: ForecastRow = {
        id: r.id,
        feature: r.feature,
        statement: r.statement ?? '',
        predictedMean: mean,
        issuedAt: r.issued_at,
        resolvesAt: r.resolves_at,
        observedValue: out && out.observed_value != null ? Number(out.observed_value) : null,
        brier: out && out.brier != null ? Number(out.brier) : null,
        resolved: !!out,
      };
      (out ? board.resolved : board.open).push(row);
    }
    return board;
  } catch {
    // Fail-soft: an empty board renders an honest empty-state, never a fabricated one.
    return board;
  }
}

// ── Per-item detail (the /briefs/forecasts/[id] drill-down) ──────────────────

export interface ForecastDetail {
  id: string;
  feature: string;
  statement: string;
  predictedMean: number | null;
  baselineMean: number | null;
  targetObservable: string | null;
  targetWindowHours: number | null;
  issuedAt: string;
  resolvesAt: string | null;
  persona: string | null;
  hash: string | null;
  publicId: string | null;
  resolved: boolean;
  observedValue: number | null;
  observedAt: string | null;
  brier: number | null;
  logLoss: number | null;
  resolutionSourceUrl: string | null;
}

interface PredDetailRow {
  id: string;
  feature: string;
  statement: string | null;
  predicted_distribution: { mean?: number } | null;
  baseline_mean: number | string | null;
  target_observable: string | null;
  target_window_hours: number | null;
  issued_at: string;
  resolves_at: string | null;
  persona: string | null;
  hash: string | null;
  public_id: string | null;
}
interface OutDetailRow {
  observed_value: number | string | null;
  observed_at: string | null;
  brier: number | string | null;
  log_loss: number | string | null;
  resolution_source_url: string | null;
}

function toNum(v: number | string | null | undefined): number | null {
  return v != null && v !== '' ? Number(v) : null;
}

export async function loadForecast(id: string): Promise<ForecastDetail | null> {
  try {
    const supabase = createServerSupabase();
    const { data: p } = await supabase
      .from('predictions_register')
      .select('id, feature, statement, predicted_distribution, baseline_mean, target_observable, target_window_hours, issued_at, resolves_at, persona, hash, public_id')
      .eq('id', id)
      .in('feature', EYKON_FORECAST_FEATURES)
      .maybeSingle();
    if (!p) return null;
    const pr = p as unknown as PredDetailRow;

    const { data: o } = await supabase
      .from('prediction_outcomes')
      .select('observed_value, observed_at, brier, log_loss, resolution_source_url')
      .eq('prediction_id', id)
      .maybeSingle();
    const out = (o ?? null) as unknown as OutDetailRow | null;

    return {
      id: pr.id,
      feature: pr.feature,
      statement: pr.statement ?? '',
      predictedMean: pr.predicted_distribution && typeof pr.predicted_distribution.mean === 'number' ? pr.predicted_distribution.mean : null,
      baselineMean: toNum(pr.baseline_mean),
      targetObservable: pr.target_observable,
      targetWindowHours: pr.target_window_hours,
      issuedAt: pr.issued_at,
      resolvesAt: pr.resolves_at,
      persona: pr.persona,
      hash: pr.hash,
      publicId: pr.public_id,
      resolved: !!out,
      observedValue: out ? toNum(out.observed_value) : null,
      observedAt: out ? out.observed_at : null,
      brier: out ? toNum(out.brier) : null,
      logLoss: out ? toNum(out.log_loss) : null,
      resolutionSourceUrl: out ? out.resolution_source_url : null,
    };
  } catch {
    return null;
  }
}
