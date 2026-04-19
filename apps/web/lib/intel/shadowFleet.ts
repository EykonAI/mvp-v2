import weights from '@/lib/fixtures/shadow_fleet_weights.json';

export interface ShadowFeatures {
  ais_gap_hours_log: number;
  flag_changes_90d: number;
  cargo_mismatch_score: number;
  port_call_anomaly: number;
  beneficial_owner_opaque: number;
  flag_of_convenience: number;
  vessel_age_years: number;
}

export interface ShadowScore {
  composite: number;
  indicator_contributions: Array<{ key: string; value: number; weight: number; contribution: number }>;
}

/** Sum-of-weighted-features logistic score, bounded [0,1]. */
export function scoreVessel(features: ShadowFeatures): ShadowScore {
  let z = weights.intercept;
  const contributions: ShadowScore['indicator_contributions'] = [];
  for (const f of weights.features) {
    const raw = (features as any)[f.key] ?? 0;
    const clipped = Math.max(f.clip[0], Math.min(f.clip[1], Number(raw)));
    const contrib = clipped * f.weight;
    z += contrib;
    contributions.push({ key: f.key, value: clipped, weight: f.weight, contribution: round3(contrib) });
  }
  const composite = 1 / (1 + Math.exp(-z));
  return { composite: round3(composite), indicator_contributions: contributions };
}

export function threshold(): { alert: number; review: number } {
  return { alert: weights.threshold_alert, review: weights.threshold_review };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
