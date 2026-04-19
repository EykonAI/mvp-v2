import profiles from '@/lib/fixtures/chokepoint_profiles.json';

export type ClosureType = 'partial_50' | 'full' | 'transit_tax_30';

export interface ChokepointInput {
  chokepoint: string;
  closure_type: ClosureType;
  duration_days: number;
  diversion_lag_hours: number;
  assumptions?: {
    spr_release?: boolean;
    opec_plus_compensatory?: boolean;
    asia_demand_elastic?: boolean;
    shipping_rate_contagion?: boolean;
  };
}

export interface PriceSample {
  t_hours: number;
  brent_spot: number;
  forward_3m: number;
  forward_6m: number;
  ci_low: number;
  ci_high: number;
}

export interface ChokepointOutput {
  input: ChokepointInput;
  price_envelope: PriceSample[];
  diverted_vessels: number;
  refining_impact_kbd: Record<string, number>;
  timeline: Array<{
    label: string;
    hours: number;
    delta_brent_pct: number;
    delta_diverted: number;
    note: string;
  }>;
  consequence_summary: string;
  computed_at: string;
}

/** Deterministic chokepoint-closure model (v1). */
export function simulateChokepoint(input: ChokepointInput): ChokepointOutput {
  const cp = profiles.chokepoints.find(c => c.slug === input.chokepoint);
  if (!cp) {
    throw new Error(`Unknown chokepoint: ${input.chokepoint}`);
  }

  const elasticity =
    input.closure_type === 'full'
      ? cp.elasticity_closure_full
      : input.closure_type === 'partial_50'
        ? cp.elasticity_closure_partial
        : cp.elasticity_transit_tax;

  const assumptions = input.assumptions ?? {};
  const mult =
    (assumptions.spr_release ? profiles.assumption_multipliers.spr_release : 1) *
    (assumptions.opec_plus_compensatory ? profiles.assumption_multipliers.opec_plus_compensatory : 1) *
    (assumptions.asia_demand_elastic ? profiles.assumption_multipliers.asia_demand_elastic : 1) *
    (assumptions.shipping_rate_contagion ? profiles.assumption_multipliers.shipping_rate_contagion : 1);

  const peakPct = elasticity * mult;
  const baseline = cp.baseline_brent_usd;
  const horizonHours = Math.min(30 * 24, input.duration_days * 24 + 7 * 24);

  // Shape: 0 at t=0, ramps to peakPct at lag hours, decays linearly back
  const price_envelope: PriceSample[] = [];
  for (let t = 0; t <= horizonHours; t += 6) {
    const ramp = Math.min(1, t / Math.max(6, input.diversion_lag_hours));
    const decay = Math.max(0, 1 - Math.max(0, t - input.duration_days * 24) / (7 * 24));
    const pct = peakPct * ramp * decay;
    const spot = baseline * (1 + pct);
    const fwd3 = baseline * (1 + pct * 0.8);
    const fwd6 = baseline * (1 + pct * 0.55);
    const ci = baseline * pct * 0.5;
    price_envelope.push({
      t_hours: t,
      brent_spot: round2(spot),
      forward_3m: round2(fwd3),
      forward_6m: round2(fwd6),
      ci_low: round2(spot - ci),
      ci_high: round2(spot + ci),
    });
  }

  // Diverted vessel count (rough: transit throughput × closure fraction × duration)
  const closureFrac =
    input.closure_type === 'full' ? 1 : input.closure_type === 'partial_50' ? 0.5 : 0.3;
  const diverted_vessels = Math.round((cp.throughput_mbd * closureFrac * input.duration_days) / 2.0);

  // Refining impact: loss proportional to import share of each cluster, scaled by closureFrac
  const refining_impact_kbd: Record<string, number> = {};
  const lostKbd = cp.throughput_mbd * 1000 * closureFrac;
  for (const rc of profiles.receiving_clusters) {
    refining_impact_kbd[rc.label] = Math.round(lostKbd * rc.import_share);
  }

  const timeline = [
    { label: 'T+24h',  hours: 24,  delta_brent_pct: sampleDelta(price_envelope, 24),  delta_diverted: Math.round(diverted_vessels * 0.1), note: 'First-wave tanker queueing, futures firm up.' },
    { label: 'T+48h',  hours: 48,  delta_brent_pct: sampleDelta(price_envelope, 48),  delta_diverted: Math.round(diverted_vessels * 0.25), note: 'Reroute decisions crystallise; insurance rates move.' },
    { label: 'T+72h',  hours: 72,  delta_brent_pct: sampleDelta(price_envelope, 72),  delta_diverted: Math.round(diverted_vessels * 0.4),  note: 'Refinery feedstock adjustments begin.' },
    { label: 'T+7d',   hours: 168, delta_brent_pct: sampleDelta(price_envelope, 168), delta_diverted: Math.round(diverted_vessels * 0.7),  note: 'Market accepts the new supply geometry.' },
    { label: 'T+30d',  hours: 720, delta_brent_pct: sampleDelta(price_envelope, 720), delta_diverted: diverted_vessels,                     note: 'Peak disruption absorbed, prices relax.' },
  ];

  const consequence_summary =
    `Closure: ${prettyClosure(input.closure_type)} of ${cp.label} for ${input.duration_days} day${input.duration_days === 1 ? '' : 's'}.` +
    ` Peak Brent deviation ~${(peakPct * 100).toFixed(1)}% vs $${baseline}.` +
    ` ~${diverted_vessels} vessel diversions over the window. Dominant refining impact on ${topCluster(refining_impact_kbd)}.` +
    ` Assumption mix: ${assumptionSummary(assumptions)}.`;

  return {
    input,
    price_envelope,
    diverted_vessels,
    refining_impact_kbd,
    timeline,
    consequence_summary,
    computed_at: new Date().toISOString(),
  };
}

function sampleDelta(env: PriceSample[], atHours: number): number {
  const closest = env.reduce((a, b) => (Math.abs(b.t_hours - atHours) < Math.abs(a.t_hours - atHours) ? b : a));
  const baseline = env[0]?.brent_spot ?? 82;
  return round2(((closest.brent_spot - baseline) / baseline) * 100);
}

function prettyClosure(c: ClosureType): string {
  return c === 'full' ? 'full closure' : c === 'partial_50' ? '50% partial closure' : '30% transit tax';
}

function topCluster(map: Record<string, number>): string {
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
  return entries.slice(0, 2).map(([k, v]) => `${k} (${v} kbd)`).join(' · ');
}

function assumptionSummary(a: ChokepointInput['assumptions']): string {
  if (!a) return 'default';
  const flags = Object.entries(a).filter(([, v]) => v).map(([k]) => k.replaceAll('_', ' '));
  return flags.length === 0 ? 'none' : flags.join(', ');
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
