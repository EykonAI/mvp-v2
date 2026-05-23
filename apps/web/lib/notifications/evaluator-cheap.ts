import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getSingleEventTool,
  type SingleEventConfig,
  type SingleEventToolId,
  type FilterValue,
  type MultiEventConfig,
} from './tools';
import type { FirePayload } from './dispatch';

// Pure-SQL evaluator for the cheap cron (15-min cadence, brief §3.7).
// PR 6 wires the single_event branch only; PR 7 adds multi_event.
//
// Window semantics (single_event):
//   • from_iso = MAX(rule.last_fired_at, rule.created_at)
//   • Look for rows in the tool's table with `ingested_at > from_iso`
//     that match the rule's filters.
//   • Return the FIRST match (most-recent-first ordering). The cron
//     fires once per evaluation pass per rule — repeat matches in the
//     same window are suppressed by cooldown_minutes on the next pass.

export interface RuleRow {
  id: string;
  user_id: string;
  name: string;
  rule_type: 'single_event' | 'multi_event' | 'outcome_ai' | 'cross_data_ai';
  config: SingleEventConfig | Record<string, unknown>;
  channel_ids: string[];
  active: boolean;
  cooldown_minutes: number;
  last_fired_at: string | null;
  created_at: string;
}

export interface MatchedEvent {
  /** Raw row pulled from the feed table. */
  row: Record<string, unknown>;
  /** One-line headline used in the email subject + summary. */
  summary: string;
  /** ~3-6 short bullet lines for the email body. */
  detailLines: string[];
}

const MAX_LOOKBACK_HOURS = 24;

export function isCooldownActive(rule: RuleRow, now: Date = new Date()): boolean {
  if (!rule.last_fired_at) return false;
  const last = new Date(rule.last_fired_at).getTime();
  return now.getTime() - last < rule.cooldown_minutes * 60_000;
}

export function evaluationFromIso(rule: RuleRow, now: Date = new Date()): string {
  const candidates: number[] = [];
  if (rule.last_fired_at) candidates.push(new Date(rule.last_fired_at).getTime());
  if (rule.created_at) candidates.push(new Date(rule.created_at).getTime());
  const cap = now.getTime() - MAX_LOOKBACK_HOURS * 60 * 60_000;
  // Floor at "now - lookback" so a rule that hasn't fired in days
  // doesn't replay a 30-day-old match — only fires for fresh events.
  const start = Math.max(cap, ...(candidates.length ? candidates : [cap]));
  return new Date(start).toISOString();
}

/**
 * Find the most-recent matching event for a single_event rule. Returns
 * null when nothing matches the filters in the evaluation window.
 */
export async function findSingleEventMatch(
  supabase: SupabaseClient,
  rule: RuleRow,
): Promise<MatchedEvent | null> {
  const config = rule.config as SingleEventConfig;
  if (!config?.tool) return null;
  const fromIso = evaluationFromIso(rule);
  return queryToolForMatch(supabase, config, fromIso);
}

/**
 * Generic per-tool query — used by single_event directly and by
 * multi_event once per predicate. Returns the most-recent matching
 * row with its ingested_at carried through on `row` so the caller
 * can check window alignment.
 */
export async function queryToolForMatch(
  supabase: SupabaseClient,
  config: SingleEventConfig,
  fromIso: string,
): Promise<MatchedEvent | null> {
  const tool = getSingleEventTool(config.tool);
  if (!tool) return null;
  const filters = config.filters ?? {};

  switch (config.tool as SingleEventToolId) {
    case 'conflict_events':
      return queryConflictEvents(supabase, fromIso, filters);
    case 'refineries':
      return queryRefineries(supabase, fromIso, filters);
    case 'power_plants':
      return queryPowerPlants(supabase, fromIso, filters);
    case 'mines':
      return queryMines(supabase, fromIso, filters);
    case 'vessel_positions':
      return queryVesselPositions(supabase, fromIso, filters);
    case 'aircraft_positions':
      return queryAircraftPositions(supabase, fromIso, filters);
    default:
      return null;
  }
}

// ─── Multi-event evaluator (PR 7) ────────────────────────────────

export interface MultiEventMatchResult {
  /** Most-recent matched event per predicate, in input order. */
  matches: MatchedEvent[];
  /** ISO timestamps of each match (parallel to `matches`). */
  matchedAtIso: string[];
}

/**
 * Multi-event AND semantics: every predicate must have at least one
 * matching event in the last `window_hours` AND the spread between
 * the oldest and newest match must be ≤ `window_hours`.
 *
 * The per-predicate floor is MAX(rule.created_at, now - window_hours)
 * so a brand-new rule doesn't replay events from before it existed.
 * Cooldown is applied by the caller (cron route) — same gate as the
 * single-event branch.
 */
export async function findMultiEventMatch(
  supabase: SupabaseClient,
  rule: RuleRow,
): Promise<MultiEventMatchResult | null> {
  const config = rule.config as unknown as MultiEventConfig;
  const predicates = Array.isArray(config?.predicates) ? config.predicates : [];
  if (predicates.length < 2) return null;
  const windowHours = Number(config.window_hours);
  if (!Number.isFinite(windowHours) || windowHours <= 0) return null;

  const now = Date.now();
  const windowMs = windowHours * 60 * 60_000;
  const createdAtMs = new Date(rule.created_at).getTime();
  const fromMs = Math.max(createdAtMs, now - windowMs);
  const fromIso = new Date(fromMs).toISOString();

  const perPredicate = await Promise.all(
    predicates.map(p => queryToolForMatch(supabase, p, fromIso)),
  );
  if (perPredicate.some(m => m === null)) return null;

  // Pull the timestamp from each match. A row that doesn't expose
  // ingested_at falls back to `now` so the window check still passes.
  const matchedAtMs = perPredicate.map(m => {
    const ts = (m!.row as Record<string, unknown>).ingested_at;
    const parsed = typeof ts === 'string' ? new Date(ts).getTime() : Number.NaN;
    return Number.isFinite(parsed) ? parsed : now;
  });
  const span = Math.max(...matchedAtMs) - Math.min(...matchedAtMs);
  if (span > windowMs) return null;

  return {
    matches: perPredicate as MatchedEvent[],
    matchedAtIso: matchedAtMs.map(t => new Date(t).toISOString()),
  };
}

/**
 * Build a FirePayload for a multi-event fire. Concatenates each
 * predicate's headline into the summary and folds detail lines into
 * one labelled list so the recipient sees what each leg contributed.
 */
export function buildMultiEventFirePayload(
  rule: RuleRow,
  result: MultiEventMatchResult,
  firedAtIso: string,
): FirePayload {
  const config = rule.config as unknown as MultiEventConfig;
  const summary = `${result.matches.length} predicates matched within ${config.window_hours}h: ${result.matches
    .map(m => m.summary.replace(/\.$/, ''))
    .join(' · ')}.`;
  const detailLines: string[] = [];
  result.matches.forEach((m, idx) => {
    detailLines.push(`Predicate ${idx + 1}: ${m.summary}`);
    for (const line of m.detailLines.slice(0, 3)) {
      detailLines.push(`  · ${line}`);
    }
  });
  return {
    ruleName: rule.name,
    ruleType: rule.rule_type,
    summary,
    detailLines,
    rationale: null,
    firedAtIso,
  };
}

// ─── Per-tool queries ────────────────────────────────────────────

async function queryConflictEvents(
  supabase: SupabaseClient,
  fromIso: string,
  filters: Record<string, FilterValue>,
): Promise<MatchedEvent | null> {
  let q = supabase
    .from('conflict_events')
    .select('id, event_id, event_type, country, fatalities, event_date, ingested_at, actor1, actor2')
    .gt('ingested_at', fromIso);

  const minFatal = num(filters.min_fatalities);
  if (minFatal > 0) q = q.gte('fatalities', minFatal);
  const country = str(filters.country);
  if (country) q = q.ilike('country', `%${country}%`);
  const eventType = str(filters.event_type);
  if (eventType) q = q.ilike('event_type', `%${eventType}%`);

  const { data } = await q.order('ingested_at', { ascending: false }).limit(1);
  const row = data?.[0];
  if (!row) return null;
  return {
    row,
    summary: `Conflict event in ${row.country ?? 'unknown'}: ${row.event_type ?? 'unspecified'} · ${row.fatalities ?? 0} fatalities.`,
    detailLines: [
      `Event type: ${row.event_type ?? 'n/a'}`,
      `Country: ${row.country ?? 'n/a'}`,
      `Fatalities: ${row.fatalities ?? 0}`,
      row.actor1 ? `Actor 1: ${row.actor1}` : '',
      row.actor2 ? `Actor 2: ${row.actor2}` : '',
      `Event date: ${row.event_date ?? 'n/a'}`,
    ].filter(Boolean) as string[],
  };
}

async function queryRefineries(
  supabase: SupabaseClient,
  fromIso: string,
  filters: Record<string, FilterValue>,
): Promise<MatchedEvent | null> {
  let q = supabase
    .from('refineries')
    .select('id, refinery_name, country, capacity_bpd, ingested_at')
    .gt('ingested_at', fromIso);
  const country = str(filters.country);
  if (country) q = q.ilike('country', `%${country}%`);
  const minBpd = num(filters.min_capacity_bpd);
  if (minBpd > 0) q = q.gte('capacity_bpd', minBpd);

  const { data } = await q.order('ingested_at', { ascending: false }).limit(1);
  const row = data?.[0];
  if (!row) return null;
  return {
    row,
    summary: `Refinery activity: ${row.refinery_name ?? 'unnamed'} (${row.country ?? 'n/a'}).`,
    detailLines: [
      `Refinery: ${row.refinery_name ?? 'n/a'}`,
      `Country: ${row.country ?? 'n/a'}`,
      `Capacity: ${row.capacity_bpd ?? 'unknown'} bpd`,
    ],
  };
}

async function queryPowerPlants(
  supabase: SupabaseClient,
  fromIso: string,
  filters: Record<string, FilterValue>,
): Promise<MatchedEvent | null> {
  let q = supabase
    .from('power_plants')
    .select('id, plant_name, country, capacity_mw, fuel_type, status, ingested_at')
    .gt('ingested_at', fromIso);
  const country = str(filters.country);
  if (country) q = q.ilike('country', `%${country}%`);
  const minMw = num(filters.min_capacity_mw);
  if (minMw > 0) q = q.gte('capacity_mw', minMw);

  const { data } = await q.order('ingested_at', { ascending: false }).limit(1);
  const row = data?.[0];
  if (!row) return null;
  return {
    row,
    summary: `Power plant: ${row.plant_name ?? 'unnamed'} · ${row.capacity_mw ?? '?'} MW (${row.country ?? 'n/a'}).`,
    detailLines: [
      `Plant: ${row.plant_name ?? 'n/a'}`,
      `Country: ${row.country ?? 'n/a'}`,
      `Capacity: ${row.capacity_mw ?? '?'} MW`,
      `Fuel: ${row.fuel_type ?? 'n/a'}`,
      `Status: ${row.status ?? 'n/a'}`,
    ],
  };
}

async function queryMines(
  supabase: SupabaseClient,
  fromIso: string,
  filters: Record<string, FilterValue>,
): Promise<MatchedEvent | null> {
  let q = supabase
    .from('mines')
    .select('id, site_name, country, commod1, commodities, dev_stat, ingested_at')
    .gt('ingested_at', fromIso);
  const country = str(filters.country);
  if (country) q = q.ilike('country', `%${country}%`);
  const commodity = str(filters.commodity);
  if (commodity) q = q.contains('commodities', [commodity]);

  const { data } = await q.order('ingested_at', { ascending: false }).limit(1);
  const row = data?.[0];
  if (!row) return null;
  return {
    row,
    summary: `Mine activity: ${row.site_name ?? 'unnamed'} (${row.country ?? 'n/a'}, ${row.commod1 ?? 'unspecified commodity'}).`,
    detailLines: [
      `Site: ${row.site_name ?? 'n/a'}`,
      `Country: ${row.country ?? 'n/a'}`,
      `Primary commodity: ${row.commod1 ?? 'n/a'}`,
      `Status: ${row.dev_stat ?? 'n/a'}`,
    ],
  };
}

/**
 * AIS-gap detector (PR 4). Detects vessels going dark — vessels that
 * pinged in the "prior window" but have NOT pinged in the "recent
 * window" of duration min_gap_hours. Implemented as a two-step set
 * difference because Supabase v2 does not expose window functions
 * via the JS client.
 *
 *   prior window   = [now − min_gap_hours − 24h, now − min_gap_hours]
 *   recent window  = (now − min_gap_hours, now]
 *   gone dark      = mmsis(prior) − mmsis(recent)
 *
 * Returns the prior-window ping of the most-recently-active gone-dark
 * vessel, plus a count of how many vessels in total went dark in the
 * pass. `fromIso` is not used for this detector — the windows are
 * computed from `now` and the gap threshold.
 */
async function queryVesselPositions(
  supabase: SupabaseClient,
  _fromIso: string,
  filters: Record<string, FilterValue>,
): Promise<MatchedEvent | null> {
  // Clamp the gap: a gap of 0 means "no gap", which collapses the
  // detector. Default 12h matches the tool's filter default.
  const rawGap = num(filters.min_gap_hours);
  const minGap = rawGap > 0 ? rawGap : 12;

  const now = Date.now();
  const gapCutoffMs = now - minGap * 3_600_000;
  const priorCutoffMs = gapCutoffMs - 24 * 3_600_000;
  const gapCutoffIso = new Date(gapCutoffMs).toISOString();
  const priorCutoffIso = new Date(priorCutoffMs).toISOString();

  // vessel_type is an integer code in the schema; the legacy `name`
  // ILIKE is preserved for vessel-class filtering (PR 6's actual fix
  // would normalise this against an entity registry).
  const vesselClass = str(filters.vessel_class);

  // Step 1 — vessels that pinged in the prior window. Keep the
  // most-recent ping per mmsi so the eventual summary has a real
  // last-seen timestamp + identifying metadata.
  let priorQ = supabase
    .from('vessel_positions')
    .select('mmsi, name, vessel_type, flag, destination, ingested_at')
    .gt('ingested_at', priorCutoffIso)
    .lte('ingested_at', gapCutoffIso)
    .order('ingested_at', { ascending: false })
    .limit(500);
  if (vesselClass) priorQ = priorQ.ilike('name', `%${vesselClass}%`);
  const { data: priorRows } = await priorQ;
  if (!priorRows || priorRows.length === 0) return null;

  type PriorRow = (typeof priorRows)[number];
  const priorByMmsi = new Map<string, PriorRow>();
  for (const r of priorRows) {
    const mmsi = String((r as Record<string, unknown>).mmsi ?? '');
    if (!mmsi) continue;
    // First insertion wins → most-recent ping per mmsi (rows are
    // already ordered desc by ingested_at).
    if (!priorByMmsi.has(mmsi)) priorByMmsi.set(mmsi, r);
  }
  if (priorByMmsi.size === 0) return null;
  const priorMmsis = Array.from(priorByMmsi.keys());

  // Step 2 — of those, which pinged AGAIN in the recent window? Pass
  // the prior set as an .in() filter so we only fetch the relevant
  // mmsis. Cap at 2000 to bound the query — if more vessels are
  // active than that the gap detector is operating outside its
  // sensible regime anyway.
  const { data: recentRows } = await supabase
    .from('vessel_positions')
    .select('mmsi')
    .gt('ingested_at', gapCutoffIso)
    .in('mmsi', priorMmsis)
    .limit(2000);
  const stillActive = new Set<string>();
  for (const r of recentRows ?? []) {
    const mmsi = String((r as Record<string, unknown>).mmsi ?? '');
    if (mmsi) stillActive.add(mmsi);
  }

  // Step 3 — set difference.
  const goneDark: PriorRow[] = [];
  for (const [mmsi, row] of priorByMmsi) {
    if (!stillActive.has(mmsi)) goneDark.push(row);
  }
  if (goneDark.length === 0) return null;

  // Pick the gone-dark vessel with the most-recent prior-window ping
  // — most informative for the email body. Already roughly sorted
  // because of priorRows ordering, but be explicit.
  goneDark.sort((a, b) =>
    String((b as Record<string, unknown>).ingested_at ?? '').localeCompare(
      String((a as Record<string, unknown>).ingested_at ?? ''),
    ),
  );
  const head = goneDark[0] as Record<string, unknown>;
  const headLabel = head.name ?? head.mmsi ?? 'unknown';
  const lastSeen = typeof head.ingested_at === 'string' ? head.ingested_at : 'unknown';
  const otherCount = goneDark.length - 1;
  return {
    row: head,
    summary: `Vessel going dark: ${headLabel} (no AIS pings for ≥${minGap}h; last seen ${lastSeen}).${
      otherCount > 0 ? ` ${otherCount} other vessel${otherCount === 1 ? '' : 's'} also gone dark in this window.` : ''
    }`,
    detailLines: [
      `Vessel: ${head.name ?? 'n/a'}`,
      `MMSI: ${head.mmsi ?? 'n/a'}`,
      `Flag: ${head.flag ?? 'n/a'}`,
      `Last destination: ${head.destination ?? 'n/a'}`,
      `Last ping: ${lastSeen}`,
      `Gap threshold: ≥${minGap}h`,
      `Gone-dark count this pass: ${goneDark.length}`,
    ],
  };
}

async function queryAircraftPositions(
  supabase: SupabaseClient,
  fromIso: string,
  filters: Record<string, FilterValue>,
): Promise<MatchedEvent | null> {
  // Fires when at least `min_count` distinct aircraft have been
  // observed in the country within the window. Implemented with a
  // small SELECT followed by client-side de-dupe so we can surface
  // a representative row in the email.
  const country = str(filters.country);
  const minCount = num(filters.min_count) || 5;
  let q = supabase
    .from('aircraft_positions')
    .select('id, icao24, callsign, country, ingested_at')
    .gt('ingested_at', fromIso);
  if (country) q = q.ilike('country', `%${country}%`);
  const { data } = await q.order('ingested_at', { ascending: false }).limit(500);
  if (!data || data.length === 0) return null;

  const distinct = new Set<string>();
  for (const r of data) distinct.add(String((r as Record<string, unknown>).icao24 ?? ''));
  if (distinct.size < minCount) return null;

  const head = data[0];
  return {
    row: head,
    summary: `Aircraft activity: ${distinct.size} distinct aircraft observed${country ? ` over ${country}` : ''} in the window.`,
    detailLines: [
      `Distinct aircraft: ${distinct.size}`,
      `Country filter: ${country || 'any'}`,
      `Most recent callsign: ${head.callsign ?? 'n/a'}`,
      `Most recent icao24: ${head.icao24 ?? 'n/a'}`,
    ],
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

function num(v: FilterValue | undefined): number {
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: FilterValue | undefined): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Shape a MatchedEvent into the FirePayload sent to the channel
 * dispatcher. Centralised here so PR 7 / PR 8 can build their own
 * payloads without re-deriving the headline format.
 */
export function buildFirePayload(rule: RuleRow, match: MatchedEvent, firedAtIso: string): FirePayload {
  return {
    ruleName: rule.name,
    ruleType: rule.rule_type,
    summary: match.summary,
    detailLines: match.detailLines,
    rationale: null,
    firedAtIso,
  };
}
