import { computePredictionHash } from './hash';

/**
 * Black Marble claim families (machine track, migration 128).
 *
 * §6.3 built night-lights as a sensor PHYSICALLY INDEPENDENT of FIRMS — light,
 * not heat, so a plant can stop flaring while its grid stays lit, or go dark
 * while still hot. It had never issued a claim.
 *
 * A · first_light PERSISTENCE
 *     "<site>, first lit on <period>, will still be emitting in 7 days."
 *     n=372, base 0.6307. The forecast conditions on (deviation_sigma x
 *     observed_radiance) and the direction is the interesting part: a BIGGER
 *     first light is LESS likely to persist. sigma 0.1-2.2 -> 0.798, 3.4+ ->
 *     0.350. A large spike is a transient; a modest sustained brightening is a
 *     real commissioning. Leave-one-out skill +0.163 against -0.005 for a flat
 *     family rate — the best number in the register.
 *
 * B · went_dark_lights RECOVERY
 *     "<site>, dark since <period>, will emit again within 7 days."
 *     n=94, base 0.7128, conditioned on dark_nights (3 -> 0.863, 4+ -> 0.535).
 *     Leave-one-out skill +0.091.
 *
 * TWO THINGS THIS SENSOR NEEDS THAT FIRMS DOES NOT:
 *   * The DATA CLOCK. Publication runs ~13 days behind (measured 2026-09-07).
 *     Windows anchor on max(period) in the radiance table, never on now().
 *   * confident_clear ONLY. 43% of readings qualify. Cloud scatters city light
 *     back at the sensor — cloudy pixels average 3,010 nW against 29.6 on clear
 *     ones — so a cloudy night is not evidence. No clear night in the window
 *     resolves VOID.
 *
 * THE PASS MARK IS FROZEN ON THE CLAIM. recovery_threshold is written at issue
 * as an absolute radiance value. A claim whose threshold could be recomputed
 * later — from a baseline that has since moved — is not a claim.
 */

export type NlEventType = 'first_light' | 'went_dark_lights';

export interface NlEvent {
  site_key: string;
  site_name: string | null;
  country: string | null;
  period: string;
  event_type: NlEventType;
  observed_radiance: number | null;
  baseline_mean: number | null;
  deviation_sigma: number | null;
  dark_nights: number | null;
  unit_rows: number | null;
}

export interface NlFamilyPlan {
  n: number;
  base_rate: number;
  eligible: boolean;
  reason: string | null;
  remaining: number;
  cells: Record<string, { n: number; rate: number }>;
}

export interface NlPlan {
  horizon_days: number;
  data_clock: string;
  daily_cap: number;
  rule: string;
  families: Partial<Record<NlEventType, NlFamilyPlan>>;
}

/** Must match the SQL exactly — fixed cut points, never quantiles. */
export function nlCellKey(ev: NlEvent): string {
  if (ev.event_type === 'first_light') {
    const sig = Number(ev.deviation_sigma ?? 0);
    const rad = Number(ev.observed_radiance ?? 0);
    const sigB = sig < 2.3 ? 1 : sig < 3.4 ? 2 : 3;
    const radB = rad < 1.5 ? 1 : 2;
    return `${sigB}:${radB}`;
  }
  return String(Math.min(ev.dark_nights ?? 0, 4));
}

export function nlObservable(ev: NlEvent): string {
  return `nightlights:${ev.event_type}:${ev.site_key}:${ev.period}`;
}

/** The absolute radiance the site must reach, frozen at issue. */
export function nlThreshold(ev: NlEvent): number | null {
  const basis = ev.event_type === 'first_light' ? ev.observed_radiance : ev.baseline_mean;
  const v = Number(basis);
  return Number.isFinite(v) && v > 0 ? Math.round(v * 0.5 * 10000) / 10000 : null;
}

export function nlStatement(ev: NlEvent, horizonDays: number): string {
  const name = ev.site_name ?? ev.site_key;
  return ev.event_type === 'first_light'
    ? `${name}, first lit on ${ev.period}, will still be emitting light in ${horizonDays} days.`
    : `${name}, dark since ${ev.period}, will emit light again within ${horizonDays} days.`;
}

export function buildNlClaimRow(ev: NlEvent, plan: NlPlan, now: Date): Record<string, unknown> | null {
  const fam = plan.families[ev.event_type];
  const threshold = nlThreshold(ev);
  if (!fam || threshold == null) return null;

  const cell = nlCellKey(ev);
  const c = fam.cells[cell];
  const p = Math.round((c && Number.isFinite(c.rate) ? c.rate : fam.base_rate) * 1000) / 1000;

  const targetObservable = nlObservable(ev);
  const statement = nlStatement(ev, plan.horizon_days);
  const resolvesAt = new Date(Date.parse(`${ev.period}T00:00:00Z`) + plan.horizon_days * 86_400_000);
  const hash = computePredictionHash({
    statement, targetObservable, resolvesAt, issuedAt: now, predictedMean: p,
  });

  return {
    feature: ev.event_type === 'first_light' ? 'nightlights_first_light_persistence' : 'nightlights_recovery',
    context: {
      // Read by the resolver. Never parse the observable — #465.
      site_key: ev.site_key,
      flagged_period: ev.period,
      horizon_days: plan.horizon_days,
      nl_event_type: ev.event_type,
      // The pass mark, frozen. Not recomputed at resolution.
      recovery_threshold: threshold,
      threshold_basis: ev.event_type === 'first_light'
        ? '0.5 x observed_radiance at first light'
        : '0.5 x baseline_mean before going dark',
      site_name: ev.site_name,
      country: ev.country,
      unit_rows: ev.unit_rows,
      deviation_sigma: ev.deviation_sigma,
      observed_radiance: ev.observed_radiance,
      baseline_mean: ev.baseline_mean,
      dark_nights: ev.dark_nights,
      forecast_basis: ev.event_type === 'first_light'
        ? 'deviation_sigma_x_observed_radiance_cell_rate'
        : 'dark_nights_cell_rate',
      forecast_cell: cell,
      forecast_cell_n: c?.n ?? 0,
      forecast_family_rate: fam.base_rate,
      forecast_family_n: fam.n,
      selection_rule: plan.rule,
      data_clock: plan.data_clock,
      note: 'confident_clear nights only; radiance is not power state; VOID when no clear night falls in the window',
    },
    predicted_distribution: { mean: p, type: 'point' },
    target_observable: targetObservable,
    target_window_hours: plan.horizon_days * 24,
    issued_at: now.toISOString(),
    resolves_at: resolvesAt.toISOString(),
    persona: 'analyst',
    statement,
    source: 'blackmarble',
    track: 'machine',
    hash,
  };
}
