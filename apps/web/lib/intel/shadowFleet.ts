import weights from '@/lib/fixtures/shadow_fleet_weights.json';

export interface ShadowFeatures {
  // v3: silence judged against the vessel's OWN observed cadence (mig 111),
  // plus vanished-under-way and flag-of-convenience. Only signals with a real
  // data source; the v1 cargo/port-call/owner placeholders stay removed until
  // an enrichment pipeline exists.
  silence_vs_cadence: number;
  vanished_under_way: number;
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

/** Speed above which a vessel counts as under way when it went silent. */
export const UNDER_WAY_KN = 5;

/** The silence feature reaches 1.0 at this multiple of the vessel's own cadence. */
const SILENCE_SATURATION_RATIO = 30;

/**
 * v3 features. `cadenceHours` is the vessel's own median inter-fix interval
 * from vessel_cadence (mig 111) — REQUIRED. A vessel without a baseline must
 * not be scored at all (composite NULL, "observed, not yet scorable"); do not
 * call this with a default. `gapHours` is measured against the box's own
 * newest fix (mig 110), never the wall clock and never row age.
 */
export function computeRealFeatures(args: {
  flag: string | null;
  gapHours: number;
  cadenceHours: number;
  lastSpeedKn: number | null;
}): ShadowFeatures {
  const ratio = Math.max(0, args.gapHours) / Math.max(0.5, args.cadenceHours);
  return {
    silence_vs_cadence: Math.log1p(ratio) / Math.log(1 + SILENCE_SATURATION_RATIO),
    vanished_under_way: args.lastSpeedKn != null && args.lastSpeedKn > UNDER_WAY_KN ? 1 : 0,
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
