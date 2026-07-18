import type { SupabaseClient } from '@supabase/supabase-js';

// "The First Ten" (Founding Partner build-prompt §7) — the fastest
// HONEST road to a shown Reputation Note (10 resolved + skill ≥ 0).
//
// User predictions on eYKON are Polymarket-market-based (commit-reveal
// via /api/comm/predict, auto-scored by the polymarket resolver when
// the market closes). So "fast-resolving" has exactly one truthful
// meaning here: OPEN markets whose scheduled close (end_date, mig 077)
// is soonest. This module surfaces those — it invents nothing, and a
// call made from a template is an ordinary sealed prediction scored
// like any other. No synthetic claims, no unresolvable templates.

export const FIRST_TEN_TARGET = 10;
// A market must close within this window to count as "fast-resolving".
export const FAST_CLOSE_DAYS = 14;

export type FastMarket = {
  market_id: string;
  question: string;
  outcomes: string[];
  prices: Record<string, number>;
  end_date: string; // ISO — guaranteed non-null by the query
  days_to_close: number;
};

// ── FIRMS facility templates ───────────────────────────────────
//
// The second observable family a creator can call on (migration 081).
// Polymarket only covers what a betting market happens to list, which
// left conflict / energy-infrastructure analysts with nothing in their
// own beat to be scored on. A FIRMS call is resolved by eYKON's own
// ingest: "will a thermal anomaly be DETECTED within <radius> km of
// this facility in the next <N> days?"
//
// HONESTY: a detection is a hot pixel, not a confirmed fire and not a
// strike. The wording below says "detected" everywhere and must keep
// saying it — attribution belongs in the analyst's prose, never in the
// resolution. See lib/predictions/resolvers/firms.ts.
export const FIRMS_WINDOW_DAYS = 7;

export type FirmsTemplate = {
  facility_type: string;
  facility_id: string;
  facility_name: string;
  country: string | null;
  // Detections at this facility over the trailing baseline window —
  // shown so the creator calls with context, not blind.
  recent_detections: number;
  // Days in the baseline window on which this facility ACTUALLY has an
  // observation row, and of those, how many carried >= 1 detection.
  // observed_days is the honest denominator: ingest started 2026-07-17,
  // so a 30-day nominal window can hold far fewer observed days, and
  // saying "in the last 30d" when we have two would be a lie.
  observed_days: number;
  detection_days: number;
  // P(at least one detection in the next window_days), smoothed — the
  // same window formula /api/comm/predict-firms uses for baseline_mean.
  base_rate: number;
  window_days: number;
  question: string;
};

const FIRMS_BASELINE_DAYS = 30;

// Smoothing strength, in pseudo-days, for the per-facility daily
// detection rate. The raw empirical rate is useless on a short history
// (with two observed days it can only be 0, 0.5 or 1), so we shrink it
// toward the global per-type daily rate with a Beta prior of weight K.
// K = 10 keeps a "1 detection-day out of 2" facility genuinely
// uncertain instead of pinning it at ~99%, and becomes negligible once
// the 30-day window fills.
const FIRMS_PRIOR_DAYS = 10;

/**
 * Callable band for a 7-day detection question.
 *
 * Outside this band the outcome is close to foregone and the call
 * carries almost no information about a forecaster's skill:
 *   > 0.85 — the permanent flare stacks (Tasnee logged 101 detections
 *            and Bandar Abbas 23 in two days; a working refinery
 *            flares, so "yes" is nearly free)
 *   < 0.15 — the never-detected sites, where "no" is nearly free
 *
 * Deliberately asymmetric to nothing: both tails are equally corrosive
 * to a calibration ledger. Widen this band only with a reason, and
 * never to fill the panel.
 */
export const FIRMS_MIN_CALLABLE_RATE = 0.15;
export const FIRMS_MAX_CALLABLE_RATE = 0.85;

// Sensitive-site guard.
//
// A template reading "will a thermal anomaly be detected within 5 km of
// <nuclear plant>" is, in almost every real case, picking up a wildfire
// in the surrounding exclusion / buffer zone rather than anything at the
// plant. Offering that as a scoreable call is indefensible to an OSINT
// audience, so nuclear and comparably sensitive sites are excluded from
// the template list entirely. (The observable itself still exists; this
// guard only governs what we HAND a creator as a suggestion.)
//
// Two independent rules, either of which excludes:
//  1. power_plants.fuel_type = 'nuclear' — verified against prod: the
//     only nuclear-ish value present, 1,296 monitored unit rows / 435
//     sites (technology values are reactor types under it, so fuel_type
//     alone is sufficient).
//  2. a name match, which also covers refineries (no fuel_type column)
//     and rows GEM mislabels — e.g. "Zaporizhia power station" and
//     "Chernobyl wind farm" are both monitored with a NON-nuclear
//     fuel_type yet are obviously off-limits.
//
// The name rule deliberately requires "nuclear" to be followed by a
// facility word, so Chinese operator names such as "Xinjiang Emin
// (China Guangdong Nuclear) wind farm" are NOT swept up.
const SENSITIVE_NAME_RE =
  /(nuclear\s+(power|plant|station|generating|complex|facility)|\bnpp\b|reactor|atomic|chernobyl|chornobyl|fukushima|zaporizh|enerhodar|uranium|enrich)/i;

type ObsRow = {
  facility_type: string;
  facility_id: string;
  facility_name: string | null;
  country: string | null;
  detection_count: number | null;
  period: string;
};

/** P(>=1 detection within `days`) from a daily rate — mirrors predict-firms. */
function windowRate(dailyRate: number, days: number): number {
  return 1 - Math.pow(1 - dailyRate, days);
}

async function pageRows(
  admin: SupabaseClient,
  since: string,
  maxPages = 10,
  pageSize = 1000,
): Promise<ObsRow[]> {
  const out: ObsRow[] = [];
  for (let page = 0; page < maxPages; page++) {
    const { data, error } = await admin
      .from('firms_facility_observations')
      .select('facility_type, facility_id, facility_name, country, detection_count, period')
      .gte('period', since)
      .gt('detection_count', 0)
      .order('period', { ascending: false })
      .order('facility_id', { ascending: true })
      .range(page * pageSize, page * pageSize + pageSize - 1);
    if (error || !data) break;
    out.push(...(data as ObsRow[]));
    if (data.length < pageSize) break;
  }
  return out;
}

/**
 * Surface monitored facilities as callable First Ten templates.
 *
 * ORDERING. The old heuristic sorted "has any detection" ASCENDING,
 * which surfaced facilities with exactly one detection in the window —
 * one-off noise whose honest answer next week is "almost certainly not
 * detected". Handing a creator near-free correct calls is precisely
 * what a calibration ledger must never do.
 *
 * We instead rank by |base_rate - 0.5| ASCENDING, where base_rate is
 * P(>= 1 detection in the next 7 days) computed the same way
 * /api/comm/predict-firms computes baseline_mean: 1 - (1 - daily)^7.
 * That puts genuinely uncertain, mid-frequency facilities first and
 * pushes BOTH tails down — the never-detected sites (free "no") and the
 * permanently-flaring sites (free "yes"). Coin-flip calls are the only
 * ones that carry information about a forecaster's skill.
 *
 * DEDUPE. power_plants is UNIT-level: one physical site has many rows
 * with distinct ids (Al-Khairat has six, Ras Laffan C four), and the
 * old code keyed on facility_id, so a creator saw the same site over
 * and over and could make two "different" calls on one place. We fold
 * to site level and keep ONE representative facility_id per site — the
 * lexicographically smallest, so the list is stable across renders.
 * The representative is a real row in firms_facility_observations, so
 * `firms:thermal:<type>:<id>:<date>` still resolves and predict-firms
 * still validates it. Site stats are read from the representative's own
 * rows only (never summed across units) so the base rate we show is
 * exactly the one the resolver will settle against — co-located units
 * share coordinates, hence identical observation rows, so nothing is
 * lost.
 */
export async function loadFirmsFacilityTemplates(
  admin: SupabaseClient,
  limit = 8,
): Promise<FirmsTemplate[]> {
  const since = new Date(Date.now() - FIRMS_BASELINE_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  // Only facilities with >= 1 detection can land anywhere near a 0.5
  // base rate, so we page just the detection rows — a few hundred, not
  // the ~13k-per-day full census the old 4000-row scan truncated.
  const hits = await pageRows(admin, since);
  if (hits.length === 0) return [];

  type Cand = {
    facility_type: string;
    facility_id: string;
    facility_name: string | null;
    country: string | null;
    detections: number;
    detectionDays: Set<string>;
  };
  const cands = new Map<string, Cand>();
  for (const r of hits) {
    const key = `${r.facility_type}:${r.facility_id}`;
    let c = cands.get(key);
    if (!c) {
      c = {
        facility_type: r.facility_type,
        facility_id: r.facility_id,
        facility_name: r.facility_name,
        country: r.country,
        detections: 0,
        detectionDays: new Set(),
      };
      cands.set(key, c);
    }
    c.detections += Number(r.detection_count) || 0;
    c.detectionDays.add(r.period);
  }

  // Honest denominator. Ingest writes one row per monitored facility per
  // day, so the observed-day count is uniform across facilities; probing
  // a handful of real candidates gives it exactly, and cheaply.
  const probeIds = Array.from(cands.values())
    .slice(0, 5)
    .map((c) => c.facility_id);
  const { data: probe } = await admin
    .from('firms_facility_observations')
    .select('period')
    .in('facility_id', probeIds)
    .gte('period', since);
  const observedDays = new Set(
    ((probe as { period: string }[] | null) ?? []).map((p) => p.period),
  ).size;
  // With fewer than two observed days the rate is pure prior and the
  // ordering would be meaningless — say nothing rather than something
  // unfounded.
  if (observedDays < 2) return [];

  // Global daily hit rate per facility type — the prior we shrink to.
  const priors = new Map<string, number>();
  for (const type of ['power_plant', 'refinery']) {
    const { count } = await admin
      .from('firms_facility_observations')
      .select('id', { count: 'exact', head: true })
      .eq('facility_type', type)
      .gte('period', since);
    const total = count ?? 0;
    const typeHits = hits.filter((h) => h.facility_type === type).length;
    priors.set(type, total > 0 ? typeHits / total : 0);
  }

  // Nuclear guard + site key for power plants, both from power_plants.
  // gem_location_id is GEM's own site identifier: 100% populated on the
  // monitored set and never spanning two plant names, which makes it a
  // sounder site key than name/proximity matching (12,628 monitored
  // units collapse to 7,667 sites).
  const plantIds = Array.from(cands.values())
    .filter((c) => c.facility_type === 'power_plant')
    .map((c) => c.facility_id);
  const plantMeta = new Map<string, { site: string; nuclear: boolean }>();
  for (let i = 0; i < plantIds.length; i += 200) {
    const { data } = await admin
      .from('power_plants')
      .select('id, plant_name, country, fuel_type, gem_location_id')
      .in('id', plantIds.slice(i, i + 200));
    for (const p of (data as
      | {
          id: string;
          plant_name: string | null;
          country: string | null;
          fuel_type: string | null;
          gem_location_id: string | null;
        }[]
      | null) ?? []) {
      plantMeta.set(p.id, {
        site: p.gem_location_id ?? `${p.plant_name ?? p.id}|${p.country ?? ''}`,
        nuclear: (p.fuel_type ?? '').toLowerCase() === 'nuclear',
      });
    }
  }

  // Fold candidates to sites, dropping sensitive and unnamed ones.
  const sites = new Map<string, Cand>();
  for (const c of cands.values()) {
    const name = c.facility_name?.trim();
    // An unnamed facility yields "within 5 km of way/123456789" — not a
    // question anyone can sensibly call. 73 monitored refineries are
    // unnamed in OSM; skip them rather than surface a raw id.
    if (!name) continue;
    if (SENSITIVE_NAME_RE.test(name)) continue;

    let siteKey: string;
    if (c.facility_type === 'power_plant') {
      const meta = plantMeta.get(c.facility_id);
      // Fail closed: a power plant we cannot classify is not offered.
      if (!meta || meta.nuclear) continue;
      siteKey = `power_plant:${meta.site}`;
    } else {
      // Refineries have no unit/site split and no fuel_type; name (plus
      // country where present — it is NULL on 631 of 634) is enough.
      siteKey = `refinery:${name.toLowerCase()}|${c.country ?? ''}`;
    }

    const prev = sites.get(siteKey);
    if (!prev || c.facility_id < prev.facility_id) sites.set(siteKey, c);
  }

  const templates: FirmsTemplate[] = [];
  for (const c of sites.values()) {
    const detectionDays = Math.min(c.detectionDays.size, observedDays);
    const prior = priors.get(c.facility_type) ?? 0;
    const daily =
      (detectionDays + FIRMS_PRIOR_DAYS * prior) / (observedDays + FIRMS_PRIOR_DAYS);
    const name = c.facility_name as string;
    templates.push({
      facility_type: c.facility_type,
      facility_id: c.facility_id,
      facility_name: name,
      country: c.country,
      recent_detections: c.detections,
      observed_days: observedDays,
      detection_days: detectionDays,
      base_rate: windowRate(daily, FIRMS_WINDOW_DAYS),
      window_days: FIRMS_WINDOW_DAYS,
      question: `Will a thermal anomaly be detected within 5 km of ${name}${
        c.country ? ` (${c.country})` : ''
      } in the next ${FIRMS_WINDOW_DAYS} days?`,
    });
  }

  return templates
    // Ranking demotes the tails but never REMOVES them, so on a thin
    // day slice(0, limit) still handed out near-certain calls once the
    // genuinely uncertain facilities ran out. That is the exact defect
    // the founder flagged: "will a thermal anomaly be detected at
    // Bandar Abbas" is a ~100% base rate, and scoring a creator
    // CORRECT for answering yes is a free point the Reputation Note
    // must never award. A hard band makes the tails unofferable.
    //
    // Returning FEWER templates than asked is the correct outcome. An
    // empty First Ten panel is honest; a panel padded with free calls
    // silently corrupts every Brier score computed from it.
    .filter(
      (t) =>
        t.base_rate >= FIRMS_MIN_CALLABLE_RATE &&
        t.base_rate <= FIRMS_MAX_CALLABLE_RATE,
    )
    .sort(
      (a, b) =>
        Math.abs(a.base_rate - 0.5) - Math.abs(b.base_rate - 0.5) ||
        // Deterministic tie-break so the list is stable render to render.
        a.facility_id.localeCompare(b.facility_id),
    )
    .slice(0, limit);
}

export async function loadFastClosingMarkets(
  admin: SupabaseClient,
  limit = 10,
): Promise<FastMarket[]> {
  const now = Date.now();
  const horizon = new Date(now + FAST_CLOSE_DAYS * 86_400_000).toISOString();
  const { data, error } = await admin
    .from('polymarket_markets')
    .select('market_id, question, outcomes, outcome_prices, end_date')
    .eq('closed', false)
    .not('end_date', 'is', null)
    .gt('end_date', new Date(now).toISOString())
    .lte('end_date', horizon)
    .order('end_date', { ascending: true })
    .limit(limit);
  if (error || !data) return [];
  return (data as {
    market_id: string;
    question: string | null;
    outcomes: unknown;
    outcome_prices: unknown;
    end_date: string;
  }[]).map(m => ({
    market_id: m.market_id,
    question: m.question ?? '',
    outcomes: Array.isArray(m.outcomes) ? (m.outcomes as unknown[]).map(String) : [],
    prices:
      m.outcome_prices && typeof m.outcome_prices === 'object'
        ? (m.outcome_prices as Record<string, number>)
        : {},
    end_date: m.end_date,
    days_to_close: Math.max(Math.ceil((Date.parse(m.end_date) - now) / 86_400_000), 0),
  }));
}
