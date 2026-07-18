import type { SupabaseClient } from '@supabase/supabase-js';
import { FIRMS_REGIONS } from '@/lib/firms/client';
import type { FirePayload } from './dispatch';

// FIRMS proximity rules — "notify me when a thermal anomaly is
// detected within N km of <facilities>".
//
// Evaluated by the cheap cron (/api/cron/evaluate-rules-cheap, 15-min
// cadence) alongside single_event / multi_event / aggregate. Pure SQL
// via two RPCs added in migration 084:
//
//   firms_count_matching_facilities(type, country, name) → int
//       coverage pre-check, called at rule-creation time
//   firms_match_facility_alerts(...)                     → rows
//       candidate facility-days for one rule's filters
//
// ─── HONESTY INVARIANT (do not soften this copy) ─────────────────
// A FIRMS row is a thermal anomaly DETECTION by a satellite
// radiometer. It is NOT a fire, NOT an explosion, NOT a strike, and
// NOT evidence of an attack. Most detections at refineries and
// petrochemical sites are ROUTINE GAS FLARES. Attribution to any
// event is inference by the reader, never a claim by this system.
// Absence of a detection does not imply absence of fire (cloud
// cover, satellite overpass timing, ~375 m pixel floor).
//
// Every string this module emits is constrained accordingly:
// "thermal anomaly detected within X km of <facility>" — never
// "refinery hit", "fire at", "strike on", or "attack".

export type FirmsFacilityType = 'refinery' | 'power_plant';

export const FIRMS_FACILITY_TYPES: readonly FirmsFacilityType[] = [
  'refinery',
  'power_plant',
] as const;

export interface FirmsProximityConfig {
  /** null / undefined = any monitored facility class. */
  facility_type?: FirmsFacilityType | null;
  /** Country name or ISO-2, matched against the facility's OWN stored
   *  country. Blank = any. See the coverage caveat below. */
  country?: string | null;
  /** Substring match on facility name. Blank = any. */
  facility_name?: string | null;
  /** Alert when a detection falls within this many km of the facility. */
  radius_km: number;
  /** Minimum fire radiative power (MW) of the strongest detection. */
  min_frp?: number;
  /** Minimum number of detections at the facility that day. */
  min_detections?: number;
  /**
   * Alert only on facility-days that migration 085 classified as
   * SIGNIFICANT (ignition / elevated / went_dark), rather than on any
   * detection meeting the numeric filters.
   *
   * Why this exists: a working refinery flares, so a raw-detection
   * rule on Bandar Abbas or Tasnee fires every single day, forever.
   * That is not an alert, it is a subscription to the fact that a
   * refinery is operating — and it trains the reader to ignore the
   * channel entirely. Significance is deviation from the FACILITY'S
   * OWN baseline, which is the only thing that warrants an interrupt.
   *
   * Defaults to false so existing rules keep their exact behaviour.
   */
  significant_only?: boolean;
}

/** Event classes migration 085 can assign to a facility-day. */
export type FirmsEventType = 'ignition' | 'elevated' | 'went_dark';

// The roll-up (firms_derive_facility_observations) pre-computes at a
// fixed radius, currently 5 km. A rule asking for MORE than that
// cannot be answered from the roll-up and would silently under-report,
// so the API rejects it and the RPC filters it out defensively.
export const FIRMS_MAX_RADIUS_KM = 5;
export const FIRMS_MIN_RADIUS_KM = 0.1;
export const FIRMS_DEFAULT_RADIUS_KM = 2;

/** Facility-days examined per rule per tick. Bounds the cron query. */
export const FIRMS_MATCH_LIMIT = 200;
/** Facility-days named individually in one notification body. */
export const FIRMS_MAX_DETAIL_FACILITIES = 8;
/** How far back a rule will look on its very first evaluation. */
export const FIRMS_LOOKBACK_DAYS = 3;

/**
 * The ingest bboxes, in the shape the SQL functions expect.
 *
 * FIRMS ingest covers three regions, but the facility roll-up writes
 * rows for facilities WORLDWIDE — including detection_count = 0 for
 * ~40k Chinese and ~17k US facilities that no satellite query ever
 * touched. Passing these boxes into the RPCs is what stops a rule
 * being created on, or evaluating as "quiet" over, a facility nobody
 * is looking at. Derived from FIRMS_REGIONS so the ingest config
 * stays the single source of truth — widening the ingest widens
 * alerting with no migration and no code change here.
 */
export function firmsRegionBoxes(): Array<{
  west: number;
  south: number;
  east: number;
  north: number;
}> {
  return FIRMS_REGIONS.map(r => ({
    west: r.bbox.west,
    south: r.bbox.south,
    east: r.bbox.east,
    north: r.bbox.north,
  }));
}

export interface FirmsCoverage {
  /** Facilities matching the filters, ignoring ingest coverage. */
  matching: number;
  /** Of those, how many sit inside an ingest bbox. */
  monitored: number;
}

export interface FirmsMatchRow {
  facility_type: string;
  facility_id: string;
  facility_name: string | null;
  facility_country: string | null;
  period: string;
  detection_count: number;
  max_frp: number | null;
  nearest_km: number | null;
  radius_km: number | null;
}

export interface FirmsProximityResult {
  /** Facility-days newly claimed by this rule (never alerted before). */
  claimed: FirmsMatchRow[];
  summary: string;
  detailLines: string[];
}

// ─── Config validation ───────────────────────────────────────────

export type FirmsConfigError =
  | 'invalid_radius'
  | 'invalid_facility_type'
  | 'invalid_min_frp'
  | 'invalid_min_detections'
  | 'filter_too_long';

export const FIRMS_FILTER_MAX_CHARS = 64;

export function normaliseFirmsConfig(
  raw: Record<string, unknown> | undefined,
): { config: FirmsProximityConfig } | { error: FirmsConfigError } {
  const r = raw ?? {};

  const radius = Number(r.radius_km ?? FIRMS_DEFAULT_RADIUS_KM);
  if (
    !Number.isFinite(radius) ||
    radius < FIRMS_MIN_RADIUS_KM ||
    radius > FIRMS_MAX_RADIUS_KM
  ) {
    return { error: 'invalid_radius' };
  }

  let facilityType: FirmsFacilityType | null = null;
  const ftRaw = r.facility_type;
  if (ftRaw !== undefined && ftRaw !== null && ftRaw !== '') {
    if (!FIRMS_FACILITY_TYPES.includes(ftRaw as FirmsFacilityType)) {
      return { error: 'invalid_facility_type' };
    }
    facilityType = ftRaw as FirmsFacilityType;
  }

  const country = typeof r.country === 'string' ? r.country.trim() : '';
  const facilityName =
    typeof r.facility_name === 'string' ? r.facility_name.trim() : '';
  if (
    country.length > FIRMS_FILTER_MAX_CHARS ||
    facilityName.length > FIRMS_FILTER_MAX_CHARS
  ) {
    return { error: 'filter_too_long' };
  }

  const minFrp = r.min_frp === undefined || r.min_frp === null ? 0 : Number(r.min_frp);
  if (!Number.isFinite(minFrp) || minFrp < 0) return { error: 'invalid_min_frp' };

  const minDet =
    r.min_detections === undefined || r.min_detections === null
      ? 1
      : Number(r.min_detections);
  if (!Number.isFinite(minDet) || minDet < 1) {
    return { error: 'invalid_min_detections' };
  }

  return {
    config: {
      facility_type: facilityType,
      country: country.length > 0 ? country : null,
      facility_name: facilityName.length > 0 ? facilityName : null,
      radius_km: radius,
      min_frp: minFrp,
      min_detections: Math.floor(minDet),
      significant_only: r.significant_only === true,
    },
  };
}

/**
 * How many facilities a filter set resolves to, and how many of those
 * are actually inside an ingest bbox.
 *
 * Called at rule-creation time so we can REFUSE to save a rule that
 * can never fire. Two distinct ways that happens today:
 *
 *  1. No facility matches at all. Refinery country attribution is
 *     effectively absent (3 of 634 rows), so facility_type='refinery'
 *     + country='Russia' resolves to zero facilities.
 *  2. Facilities match but none are ingested. China has 39,796
 *     facilities and zero inside any FIRMS bbox; every one of their
 *     observation rows reads detection_count = 0 forever, which looks
 *     identical to "nothing is burning" but means "nobody looked".
 *
 * Either case must fail closed at creation rather than producing a
 * healthy-looking rule that is silent by construction.
 */
export async function getRuleCoverage(
  supabase: SupabaseClient,
  config: FirmsProximityConfig,
): Promise<FirmsCoverage | null> {
  const { data, error } = await supabase.rpc('firms_rule_coverage', {
    p_facility_type: config.facility_type ?? null,
    p_country: config.country ?? null,
    p_facility_name: config.facility_name ?? null,
    p_regions: firmsRegionBoxes(),
  });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  const matching = Number(row.matching_facilities);
  const monitored = Number(row.monitored_facilities);
  if (!Number.isFinite(matching) || !Number.isFinite(monitored)) return null;
  return { matching, monitored };
}

/**
 * Default rule name. Says "thermal anomaly near X", never "fire at X"
 * — the name shows up as the notification subject line.
 */
export function suggestFirmsRuleName(config: FirmsProximityConfig): string {
  const what =
    config.facility_type === 'power_plant'
      ? 'power plants'
      : config.facility_type === 'refinery'
      ? 'refineries'
      : 'monitored facilities';
  const where = config.country ? ` in ${config.country}` : '';
  const named = config.facility_name ? ` matching "${config.facility_name}"` : '';
  return `Thermal anomaly within ${config.radius_km} km of ${what}${where}${named}`;
}

// ─── Evaluation ──────────────────────────────────────────────────

/**
 * Evaluate one firms_proximity rule.
 *
 * Dedup is a CLAIM, not a read-then-write: candidate facility-days are
 * inserted into firms_alert_dispatches, whose unique index on
 * (rule_id, facility_type, facility_id, period) rejects anything
 * already alerted. Only the rows that actually land are returned, so
 * two overlapping cron ticks can never alert on the same facility-day
 * and a facility flaring for a week yields one alert per day, not one
 * per 15-minute tick.
 *
 * Returns null when there is nothing new — the caller treats that as
 * no_match and does not dispatch.
 */
export async function evaluateFirmsProximityRule(
  supabase: SupabaseClient,
  rule: { id: string; created_at: string; config: unknown },
): Promise<FirmsProximityResult | null> {
  const parsed = normaliseFirmsConfig(rule.config as Record<string, unknown>);
  if ('error' in parsed) return null;
  const config = parsed.config;

  // Never replay history older than the rule itself, and never more
  // than the lookback window on a brand-new rule.
  const createdMs = new Date(rule.created_at).getTime();
  const lookbackMs = Date.now() - FIRMS_LOOKBACK_DAYS * 24 * 60 * 60_000;
  const sinceMs = Math.max(
    Number.isFinite(createdMs) ? createdMs : lookbackMs,
    lookbackMs,
  );
  const sincePeriod = new Date(sinceMs).toISOString().slice(0, 10);

  const { data, error } = await supabase.rpc('firms_match_facility_alerts', {
    p_facility_type: config.facility_type ?? null,
    p_country: config.country ?? null,
    p_facility_name: config.facility_name ?? null,
    p_radius_km: config.radius_km,
    p_min_frp: config.min_frp ?? 0,
    p_min_detections: config.min_detections ?? 1,
    p_since_period: sincePeriod,
    // Spatial coverage gate — see firmsRegionBoxes(). Without this a
    // facility outside every ingest bbox would be evaluated as though
    // its permanent detection_count = 0 were a measurement.
    p_regions: firmsRegionBoxes(),
    p_limit: FIRMS_MATCH_LIMIT,
  });
  if (error) throw new Error(`firms_match_facility_alerts: ${error.message}`);

  let candidates = (data ?? []) as FirmsMatchRow[];
  if (candidates.length === 0) return null;

  // Significance gate. Narrow the candidate facility-days to those
  // migration 085 classified as a departure from the facility's own
  // baseline, BEFORE the claim step — claiming a routine flare would
  // burn its dispatch slot and suppress a genuinely significant event
  // on the same facility-day later in the window.
  //
  // Fails CLOSED: if firms_significant_events cannot be read we alert
  // on nothing rather than falling back to raw detections, because the
  // fallback is exactly the every-day-forever behaviour the flag was
  // set to avoid.
  const significanceByKey = new Map<string, FirmsEventType>();
  if (config.significant_only) {
    const { data: sig, error: sigErr } = await supabase
      .from('firms_significant_events')
      .select('facility_type, facility_id, period, event_type')
      .gte('period', sincePeriod)
      .in(
        'facility_id',
        Array.from(new Set(candidates.map(c => c.facility_id))),
      );
    if (sigErr) {
      throw new Error(`firms_significant_events: ${sigErr.message}`);
    }
    for (const row of (sig ?? []) as Array<{
      facility_type: string;
      facility_id: string;
      period: string;
      event_type: FirmsEventType;
    }>) {
      significanceByKey.set(
        `${row.facility_type}|${row.facility_id}|${row.period}`,
        row.event_type,
      );
    }
    candidates = candidates.filter(c =>
      significanceByKey.has(`${c.facility_type}|${c.facility_id}|${c.period}`),
    );
    if (candidates.length === 0) return null;
  }

  // Claim step — the unique index does the de-duplication.
  const { data: claimedRows, error: claimErr } = await supabase
    .from('firms_alert_dispatches')
    .upsert(
      candidates.map(c => ({
        rule_id: rule.id,
        facility_type: c.facility_type,
        facility_id: c.facility_id,
        period: c.period,
        detection_count: c.detection_count,
        max_frp: c.max_frp,
        nearest_km: c.nearest_km,
        facility_country: c.facility_country,
      })),
      {
        onConflict: 'rule_id,facility_type,facility_id,period',
        ignoreDuplicates: true,
      },
    )
    .select('facility_type, facility_id, period');

  if (claimErr) throw new Error(`firms_alert_dispatches: ${claimErr.message}`);

  const claimedKeys = new Set(
    (claimedRows ?? []).map(
      (r: { facility_type: string; facility_id: string; period: string }) =>
        `${r.facility_type}|${r.facility_id}|${r.period}`,
    ),
  );
  if (claimedKeys.size === 0) return null;

  const claimed = candidates.filter(c =>
    claimedKeys.has(`${c.facility_type}|${c.facility_id}|${c.period}`),
  );
  if (claimed.length === 0) return null;

  return {
    claimed,
    summary: buildSummary(claimed, config),
    detailLines: buildDetailLines(claimed, config, significanceByKey),
  };
}

// ─── Copy ────────────────────────────────────────────────────────

function fmtKm(km: number | null): string {
  if (km === null || !Number.isFinite(km)) return 'an unknown distance';
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

function facilityLabel(row: FirmsMatchRow): string {
  const name = row.facility_name?.trim();
  const kind = row.facility_type === 'power_plant' ? 'power plant' : 'refinery';
  const base = name && name.length > 0 ? name : `an unnamed ${kind}`;
  const country = row.facility_country?.trim();
  return country ? `${base} (${country})` : base;
}

/**
 * One-line headline. Deliberately reads "thermal anomaly detected
 * within X km of Y" — a statement about a satellite measurement, not
 * about an event at the facility.
 */
export function buildSummary(
  rows: FirmsMatchRow[],
  config: FirmsProximityConfig,
): string {
  if (rows.length === 1) {
    const r = rows[0];
    return `Thermal anomaly detected within ${fmtKm(r.nearest_km)} of ${facilityLabel(r)} on ${r.period}.`;
  }
  const sites = new Set(rows.map(r => `${r.facility_type}|${r.facility_id}`)).size;
  return `Thermal anomalies detected within ${config.radius_km} km of ${sites} monitored ${
    sites === 1 ? 'facility' : 'facilities'
  } (${rows.length} facility-days).`;
}

/** How each 085 event class is described to a reader. Phrased as an
 *  observation about the satellite record, never as a facility state:
 *  "no detections recorded", not "the refinery is down". */
const EVENT_PHRASE: Record<FirmsEventType, string> = {
  ignition:
    'first detection after a period with none recorded — a change from this site’s own baseline',
  elevated:
    'detected heat well above this site’s own typical lit-day level',
  went_dark:
    'no detections recorded across several consecutive COVERED days at a site that normally registers them',
};

export function buildDetailLines(
  rows: FirmsMatchRow[],
  config: FirmsProximityConfig,
  significance?: Map<string, FirmsEventType>,
): string[] {
  const lines: string[] = [];
  const seenEvents = new Set<FirmsEventType>();

  for (const r of rows.slice(0, FIRMS_MAX_DETAIL_FACILITIES)) {
    const frp = r.max_frp !== null && Number.isFinite(Number(r.max_frp))
      ? `, peak FRP ${Number(r.max_frp).toFixed(1)} MW`
      : '';
    const ev = significance?.get(`${r.facility_type}|${r.facility_id}|${r.period}`);
    if (ev) seenEvents.add(ev);
    const evNote = ev ? ` [${ev}: ${EVENT_PHRASE[ev]}]` : '';
    lines.push(
      `${r.period} — ${r.detection_count} detection${
        r.detection_count === 1 ? '' : 's'
      } within ${fmtKm(r.nearest_km)} of ${facilityLabel(r)}${frp}${evNote}.`,
    );
  }
  if (rows.length > FIRMS_MAX_DETAIL_FACILITIES) {
    lines.push(`… and ${rows.length - FIRMS_MAX_DETAIL_FACILITIES} more facility-days.`);
  }

  lines.push(
    `Filter: within ${config.radius_km} km of ${
      config.facility_type
        ? config.facility_type === 'power_plant'
          ? 'power plants'
          : 'refineries'
        : 'monitored facilities'
    }${config.country ? ` in ${config.country}` : ''}${
      config.facility_name ? ` matching "${config.facility_name}"` : ''
    }.`,
  );

  // ─── Non-negotiable caveats. Every notification carries these. ──
  lines.push(
    'What this is: a thermal anomaly detection by a NASA FIRMS satellite radiometer. It is NOT confirmation of a fire, an explosion or a strike.',
  );
  lines.push(
    'Many detections at refineries and petrochemical sites are routine industrial gas flaring. Attributing this signal to any event is inference, not something this alert establishes.',
  );
  lines.push(
    'Absence of a detection does not imply absence of fire — cloud cover, satellite overpass timing and the ~375 m pixel floor all hide real events.',
  );
  lines.push(
    'Proximity is measured to the facility footprint and does not establish that the heat source is the facility itself.',
  );

  if (config.significant_only) {
    lines.push(
      'This rule reports only departures from each facility’s OWN baseline, not routine activity. Baseline is built from that facility’s prior COVERED days; a site with too little history is not judged at all.',
    );
  }
  if (seenEvents.has('went_dark')) {
    // The outage read is the most valuable and the most abusable
    // signal here, so it gets its own caveat. Sustained absence over
    // covered days is evidence, not proof — the same cloud cover that
    // makes a single quiet day meaningless can persist for several.
    lines.push(
      'A "went_dark" flag means detections STOPPED at a site that normally registers them, across several days we know were covered. It is an inference about the satellite record, NOT a confirmed outage, shutdown or loss of production — persistent cloud, seasonal maintenance and changes in flaring practice all produce the same signature.',
    );
  }

  return lines;
}

export function buildFirmsProximityFirePayload(
  rule: { name: string },
  result: FirmsProximityResult,
  firedAtIso: string,
): FirePayload {
  return {
    ruleName: rule.name,
    ruleType: 'firms_proximity',
    summary: result.summary,
    detailLines: result.detailLines,
    rationale: null,
    firedAtIso,
  };
}
