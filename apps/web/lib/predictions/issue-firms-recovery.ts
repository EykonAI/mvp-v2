import { computePredictionHash } from './hash';

/**
 * FIRMS went_dark RECOVERY claims (machine track, migration 127).
 *
 * THE CLAIM
 *   "<site>, dark since <period>, will be re-detected by FIRMS within 3 days."
 *
 * Self-resolving from eYKON's own ingest — no market, no counterparty, no
 * human. §6.1 built FIRMS to be exactly this and it had never issued a claim.
 *
 * MEASURED BEFORE IT WAS BUILT, which is the discipline §17.2 asks for:
 *     horizon  3d  n=442  recovery 0.767   IN BAND
 *     horizon  7d  n=375  recovery 0.912   formality
 *     horizon 14d  n=273  recovery 0.982   formality
 * Almost everything that goes dark returns within a week. Only 3 days is a
 * real question, and even that sits near the top of the band.
 *
 * PER SITE, NEVER PER ROW (§6.6). 906 unit rows collapse to 460 site-events
 * over 190 sites. Every unit at a plant samples the same pixel, so per-row
 * issuance would be the same evidence counted twice with the uncertainty
 * understated.
 *
 * THE FORECAST DISCRIMINATES — the reason this family is worth having:
 *     dark_days      3 -> 0.821   4 -> 0.755   5+ -> 0.587
 *     baseline_rate  low 0.592    mid 0.781    high 0.867
 *   Leave-one-out over 442 events: a global-rate forecast scores skill
 *   -0.0045; the (dark_days x baseline_rate) cell rate scores +0.0557. The
 *   first positive out-of-sample skill in the register.
 *
 * RESOLUTION IS BY CONTEXT, NOT BY PARSING THE KEY. target_observable is a
 * dedup key and nothing else — #465 cost 450 fabricated voids by looking an
 * event up through a serialised timestamp. site_key and period are stored in
 * context and the resolver reads those.
 */

export interface FirmsRecoveryEvent {
  site_key: string;
  site_name: string | null;
  country: string | null;
  period: string;          // date the site was flagged dark
  dark_days: number | null;
  baseline_rate: number | null;
  unit_rows: number | null;
  latitude: number | null;
  longitude: number | null;
}

export interface FirmsRecoveryPlan {
  horizon_days: number;
  family: { n: number; base_rate: number; eligible: boolean; band_lo: number; band_hi: number };
  daily_cap: number;
  remaining: number;
  rule: string;
  cells: Record<string, { n: number; k: number; rate: number }>;
}

/** Cell key must match the SQL: least(dark_days,5) : width_bucket(baseline_rate,0.5,1.0,3). */
export function cellKeyFor(ev: FirmsRecoveryEvent): string {
  const dd = Math.min(ev.dark_days ?? 0, 5);
  const r = Number(ev.baseline_rate ?? 0);
  // width_bucket(r, 0.5, 1.0, 3): below 0.5 -> 0, at/above 1.0 -> 4.
  let br: number;
  if (r < 0.5) br = 0;
  else if (r >= 1.0) br = 4;
  else br = Math.floor((r - 0.5) / (0.5 / 3)) + 1;
  return `${dd}:${br}`;
}

export function firmsRecoveryObservable(ev: FirmsRecoveryEvent): string {
  return `firms:went_dark_recovery:${ev.site_key}:${ev.period}`;
}

export function firmsRecoveryStatement(ev: FirmsRecoveryEvent, horizonDays: number): string {
  const name = ev.site_name ?? ev.site_key;
  return `${name}, dark since ${ev.period}, will be re-detected by FIRMS thermal within ${horizonDays} days.`;
}

/**
 * The cell rate when the cell has been measured, else the family rate. A cell
 * with no history must not invent a number — it inherits the family's, which
 * is the honest fallback and the same rule mig 126 applies to the house.
 */
export function forecastFor(plan: FirmsRecoveryPlan, ev: FirmsRecoveryEvent): { p: number; cell: string; cell_n: number } {
  const cell = cellKeyFor(ev);
  const c = plan.cells[cell];
  const p = c && Number.isFinite(c.rate) ? c.rate : plan.family.base_rate;
  return { p: Math.round(p * 1000) / 1000, cell, cell_n: c?.n ?? 0 };
}

export function buildFirmsRecoveryClaimRow(
  ev: FirmsRecoveryEvent,
  plan: FirmsRecoveryPlan,
  now: Date,
): Record<string, unknown> {
  const targetObservable = firmsRecoveryObservable(ev);
  const statement = firmsRecoveryStatement(ev, plan.horizon_days);
  const { p, cell, cell_n } = forecastFor(plan, ev);
  // Resolution is the END of the window, not the flag date.
  const resolvesAt = new Date(Date.parse(`${ev.period}T00:00:00Z`) + plan.horizon_days * 86_400_000);
  const hash = computePredictionHash({
    statement,
    targetObservable,
    resolvesAt,
    issuedAt: now,
    predictedMean: p,
  });
  return {
    feature: 'firms_went_dark_recovery',
    context: {
      // Read by the resolver. Never parse the observable — #465.
      site_key: ev.site_key,
      flagged_period: ev.period,
      horizon_days: plan.horizon_days,
      site_name: ev.site_name,
      country: ev.country,
      unit_rows: ev.unit_rows,
      dark_days: ev.dark_days,
      baseline_rate: ev.baseline_rate,
      forecast_basis: 'dark_days_x_baseline_rate_cell_rate',
      forecast_cell: cell,
      forecast_cell_n: cell_n,
      forecast_family_rate: plan.family.base_rate,
      forecast_family_n: plan.family.n,
      selection_rule: plan.rule,
      note: 'a detection is a hot pixel, not a confirmed fire; VOID when the site was not observed in the window',
    },
    predicted_distribution: { mean: p, type: 'point' },
    target_observable: targetObservable,
    target_window_hours: plan.horizon_days * 24,
    issued_at: now.toISOString(),
    resolves_at: resolvesAt.toISOString(),
    persona: 'analyst',
    statement,
    source: 'firms-recovery',
    track: 'machine',
    hash,
  };
}
