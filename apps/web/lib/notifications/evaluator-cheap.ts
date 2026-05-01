import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getSingleEventTool,
  type SingleEventConfig,
  type SingleEventToolId,
  type FilterValue,
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
  const tool = getSingleEventTool(config.tool);
  if (!tool) return null;

  const fromIso = evaluationFromIso(rule);
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

async function queryVesselPositions(
  supabase: SupabaseClient,
  fromIso: string,
  filters: Record<string, FilterValue>,
): Promise<MatchedEvent | null> {
  // "Going dark" semantics in the v1 evaluator: a vessel whose most
  // recent ping is older than min_gap_hours and whose latest ping
  // landed inside the evaluation window. The vessel_positions table
  // has one row per ping — the AIS gap is implied by the absence of
  // newer rows, which a pure SELECT can't observe directly. For PR 6
  // we approximate by reporting the most recent ping in the window
  // that matches the (optional) vessel_class. PR 7 replaces this
  // heuristic with a window-function-based "max(ingested_at) by mmsi
  // is older than X" query when the multi-event evaluator lands.
  const minGap = num(filters.min_gap_hours);
  let q = supabase
    .from('vessel_positions')
    .select('id, mmsi, name, vessel_type, flag, destination, ingested_at')
    .gt('ingested_at', fromIso);
  // vessel_type is an integer code in the schema; we filter by name
  // contains as a soft match for now.
  const vesselClass = str(filters.vessel_class);
  if (vesselClass) q = q.ilike('name', `%${vesselClass}%`);

  const { data } = await q.order('ingested_at', { ascending: false }).limit(1);
  const row = data?.[0];
  if (!row) return null;
  return {
    row,
    summary: `Vessel signal: ${row.name ?? row.mmsi ?? 'unknown'}${minGap ? ` (gap threshold ${minGap}h)` : ''}.`,
    detailLines: [
      `Vessel: ${row.name ?? 'n/a'}`,
      `MMSI: ${row.mmsi ?? 'n/a'}`,
      `Flag: ${row.flag ?? 'n/a'}`,
      `Destination: ${row.destination ?? 'n/a'}`,
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
