import weights from '@/lib/fixtures/shadow_fleet_weights.json';

export interface ShadowFeatures {
  // v2: only signals derivable from the live AIS feed. The v1 cargo-mismatch /
  // port-call / beneficial-owner / flag-history / vessel-age placeholders had no
  // data source and were removed; restore them here, in computeRealFeatures, and
  // the weights fixture when the enrichment pipeline lands.
  ais_gap_hours_log: number;
  flag_of_convenience: number;
}

/**
 * Flags-of-convenience commonly used by dark-fleet vessels, as ISO-3166-1
 * alpha-2 codes — the AIS worker derives `flag` from the MMSI MID as alpha-2
 * (PA, LR, MH…), so the set MUST be alpha-2 to match (an alpha-3 set silently
 * never matched, which is partly why the v1 score was meaningless).
 */
export const FOC_CODES = new Set([
  'PA', 'LR', 'MH', 'BS', 'CK', 'GA', 'CM', 'VU', 'BB', 'BZ',
]);

/**
 * Real shadow-fleet features derived purely from the live AIS feed.
 * `gapHours` = hours since this vessel's last fix, measured against the feed's
 * freshest observation (the "data clock"), NOT wall-clock — so a feed-wide
 * ingestion outage doesn't make every vessel look dark.
 */
export function computeRealFeatures(args: { flag: string | null; gapHours: number }): ShadowFeatures {
  return {
    ais_gap_hours_log: Math.log1p(Math.max(0, args.gapHours)),
    flag_of_convenience: FOC_CODES.has((args.flag ?? '').toUpperCase()) ? 1 : 0,
  };
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
