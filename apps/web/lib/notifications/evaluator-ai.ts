import type { SupabaseClient } from '@supabase/supabase-js';
import { getAnthropic } from '@/lib/anthropic';
import {
  DATA_BUCKETS,
  AI_K_EVENTS_DEFAULT,
  AI_K_EVENTS_MAX,
  getBucketTable,
  type DataBucket,
  type OutcomeAiConfig,
  type CrossDataAiConfig,
} from './tools';
import type { FirePayload } from './dispatch';
import type { RuleRow } from './evaluator-cheap';
import { findPrecursorMatches, formatPrecursorBlockForPrompt } from './precursor-matches';
import { fetchWeatherForRegion } from './weather';

// AI evaluator for outcome_ai and cross_data_ai rule types. Runs
// on the hourly cron at /api/cron/evaluate-rules-ai. Brief §3.7:
//
//   • K = 50 events / 8,000 input tokens per rule per evaluation —
//     older events truncated to fit the budget.
//   • Anthropic prompt caching enabled — system prompt + tool /
//     bucket inventory are stable across consecutive evaluations of
//     the same rule, dropping cached input tokens to ~10% of std.
//
// Decision shape: { fire: boolean, rationale: string } returned via
// a single-tool tool_use call (more reliable than free-text JSON).

// Match the Intelligence Center cron pattern: claude-opus-4-7 for
// the main reasoning, fall back to a smaller model in a future tune.
const MODEL = 'claude-opus-4-7';
const MAX_TOKENS_OUT = 400;

// ─── Bucket → table mapping ──────────────────────────────────────
// Source-of-truth for "what data lives in each of the §3.5 buckets".
// The cron pulls the most-recent rows from each table the rule's
// buckets touch and concatenates them into the events list.

interface BucketSpec {
  bucket: DataBucket;
  table: string;
  /** Columns to select — kept tight to control token cost. */
  columns: string;
  /** ORDER BY column (most-recent first). */
  recencyColumn: string;
  /**
   * Optional column to apply rule.config.country against via ILIKE.
   * Buckets without one (Maritime — flag ≠ operational country;
   * Weather — no table) leave this undefined and skip the country
   * filter. PR 6 (geofence lookup) will resolve those via lat/lon.
   * For Air the column IS the aircraft's registration country, not
   * its overflight country — see the format-string comment.
   */
  countryColumn?: string;
  /** One-line label format used in the events block. */
  format: (row: Record<string, unknown>) => string;
}

const BUCKET_SPECS: ReadonlyArray<BucketSpec> = [
  {
    bucket: 'Conflict',
    table: 'conflict_events',
    columns: 'event_type, country, fatalities, event_date, ingested_at',
    recencyColumn: 'ingested_at',
    countryColumn: 'country',
    format: r =>
      `[Conflict @${r.ingested_at ?? '?'}] ${r.event_type ?? '?'} in ${r.country ?? '?'} · ${r.fatalities ?? 0} fatalities · ${r.event_date ?? '?'}`,
  },
  {
    bucket: 'Air',
    table: 'aircraft_positions',
    columns: 'callsign, country, ingested_at',
    recencyColumn: 'ingested_at',
    // country here is the aircraft's registration country (ISO from
    // the ADS-B feed), NOT the overflight country. The (reg:…)
    // qualifier in the format string signals this to Claude so it
    // does not reason about airspace from this field alone.
    countryColumn: 'country',
    format: r => `[Air @${r.ingested_at ?? '?'}] ${r.callsign ?? '?'} (reg:${r.country ?? '?'})`,
  },
  {
    bucket: 'Maritime',
    table: 'vessel_positions',
    columns: 'name, mmsi, flag, destination, ingested_at',
    recencyColumn: 'ingested_at',
    // No countryColumn: vessel.flag is the flag-state of registration,
    // not the vessel's current operational country. PR 6 (geofence
    // lookup against lat/lon) will land per-vessel country resolution.
    format: r =>
      `[Maritime @${r.ingested_at ?? '?'}] ${r.name ?? r.mmsi ?? '?'} · flag ${r.flag ?? '?'} → ${r.destination ?? '?'}`,
  },
  {
    bucket: 'EnergyPower',
    table: 'power_plants',
    columns: 'plant_name, country, capacity_mw, fuel_type, status, ingested_at',
    recencyColumn: 'ingested_at',
    countryColumn: 'country',
    format: r =>
      `[EnergyPower @${r.ingested_at ?? '?'}] ${r.plant_name ?? '?'} · ${r.capacity_mw ?? '?'} MW ${r.fuel_type ?? ''} · ${r.country ?? '?'} · ${r.status ?? ''}`,
  },
  {
    bucket: 'EnergyRefineries',
    table: 'refineries',
    columns: 'refinery_name, country, capacity_bpd, ingested_at',
    recencyColumn: 'ingested_at',
    countryColumn: 'country',
    format: r =>
      `[EnergyRefineries @${r.ingested_at ?? '?'}] ${r.refinery_name ?? '?'} · ${r.capacity_bpd ?? '?'} bpd · ${r.country ?? '?'}`,
  },
  {
    bucket: 'EnergyPipelines',
    table: 'gas_pipelines',
    columns: 'name, country, status, ingested_at',
    recencyColumn: 'ingested_at',
    countryColumn: 'country',
    format: r => `[EnergyPipelines @${r.ingested_at ?? '?'}] ${r.name ?? '?'} · ${r.country ?? '?'} · ${r.status ?? ''}`,
  },
  {
    bucket: 'Mining',
    table: 'mines',
    columns: 'site_name, country, commod1, dev_stat, ingested_at',
    recencyColumn: 'ingested_at',
    countryColumn: 'country',
    format: r =>
      `[Mining @${r.ingested_at ?? '?'}] ${r.site_name ?? '?'} · ${r.commod1 ?? '?'} · ${r.country ?? '?'} · ${r.dev_stat ?? ''}`,
  },
  {
    bucket: 'AviationInfra',
    table: 'airports',
    columns: 'name, iso_country, type, ingested_at',
    recencyColumn: 'ingested_at',
    countryColumn: 'iso_country',
    format: r => `[AviationInfra @${r.ingested_at ?? '?'}] ${r.name ?? '?'} · ${r.iso_country ?? '?'} · ${r.type ?? ''}`,
  },
  {
    bucket: 'MaritimeInfra',
    table: 'ports',
    columns: 'port_name, country, harbor_size, ingested_at',
    recencyColumn: 'ingested_at',
    countryColumn: 'country',
    format: r =>
      `[MaritimeInfra @${r.ingested_at ?? '?'}] ${r.port_name ?? '?'} · ${r.country ?? '?'} · ${r.harbor_size ?? ''}`,
  },
  // ─── In-house signal-detection tables (PR 3) ─────────────────
  // Two tables that pre-date the Notification Center but were not
  // previously exposed to the AI evaluator. anomaly_flags = the
  // raw per-domain anomaly stream; convergence_events = clustered
  // anomalies with a joint p-value and a Claude-written synthesis.
  // Both use `created_at` as the recency column (no ingested_at).
  {
    bucket: 'AnomalyFlags',
    table: 'anomaly_flags',
    columns: 'domain, flag_type, severity, source, created_at',
    recencyColumn: 'created_at',
    // No clean country column — region may live inside the JSONB
    // payload but is not normalised. PR 6 (geofence) is the right
    // place to revisit this.
    format: r =>
      `[AnomalyFlags @${r.created_at ?? '?'}] ${r.domain ?? '?'}/${r.flag_type ?? '?'} · severity ${r.severity ?? '?'} · source ${r.source ?? '?'}`,
  },
  {
    bucket: 'ConvergenceEvents',
    table: 'convergence_events',
    columns: 'location, joint_p_value, synthesis, created_at',
    recencyColumn: 'created_at',
    // location is free-form text written by the compute-convergences
    // cron — usually a country, region, or chokepoint name. ILIKE
    // works as a best-effort country narrowing until PR 6 lands a
    // proper geofence resolver against bounding_box.
    countryColumn: 'location',
    format: r =>
      `[ConvergenceEvents @${r.created_at ?? '?'}] ${r.location ?? '?'} · p=${r.joint_p_value ?? '?'} · ${typeof r.synthesis === 'string' ? r.synthesis.slice(0, 120) : ''}`,
  },
  // Weather bucket has no persistent table — it's an Open-Meteo
  // pull-on-demand. AI rules that lean on Weather get a "no recent
  // weather rows" footnote in the events block.
];

const BUCKET_BY_NAME: ReadonlyMap<DataBucket, BucketSpec> = new Map(
  BUCKET_SPECS.map(s => [s.bucket, s]),
);

// ─── System prompt (cached) ──────────────────────────────────────
// First content block is marked cache_control: ephemeral so the
// shared prefix is reused across all rules processed in a single
// tick (and across consecutive ticks within the 5-min cache TTL,
// when the cron re-fires faster than that).

export const AI_EVALUATOR_SYSTEM_PROMPT = `You are the eYKON.ai Notification Center AI evaluator. Your job is to decide whether a user's outcome-driven rule should fire RIGHT NOW based on a snapshot of recent geopolitical events.

You will receive:
  1. The user's outcome statement (free-text, ≤600 chars). Examples:
     - "Anything that could move WTI by ≥$2/bbl in the next 24 hours."
     - "Conditions that could displace ≥10,000 people in a watchlist region."
     - "A coordinated cyber + kinetic operation in the same theatre."
  2. An events list pulled from up to 12 data buckets (Air, Maritime, Conflict,
     EnergyPower, EnergyPipelines, EnergyRefineries, Mining, AviationInfra,
     MaritimeInfra, Weather, AnomalyFlags, ConvergenceEvents). Each line is
     prefixed with [Bucket @timestamp] — the timestamp is the row's ingestion
     or creation time and lets you reason about ordering and recency across
     buckets. Older events have been truncated to fit a token budget.
  3. The rule type — outcome_ai (single-domain or open) or cross_data_ai (≥2
     buckets, expects multi-domain convergence).

Your decision rules:
  • Fire only when the events meaningfully support the outcome statement —
    not on weak surface-level keyword matches.
  • For cross_data_ai, the supporting events MUST span ≥2 distinct buckets.
  • Bias toward NOT firing when evidence is thin. False fires erode user trust.
  • Respect persona context: "day-trader" wants sub-24-h material moves;
    "NGO" wants humanitarian risk, not market signals.
  • When a "Top historical precursor matches" block is present, treat
    each entry as a soft analog. A high cosine (≥0.75) means the
    current posture rhymes with a labelled episode — useful for
    confidence, but the live events must STILL support the outcome on
    their own merits. Do not fire on precursor similarity alone.

Output: call the report_decision tool with:
  • fire: boolean
  • rationale: one sentence (≤220 chars) explaining the call. Cite specific
    event details ("ACLED battle event in Yemen with 60+ fatalities, plus a
    Hormuz tanker AIS gap in the same window"). Avoid hedging language.

Bucket inventory and approximate semantics:
  Air                — ADS-B aircraft pings. NOTE: the (reg:XX) field is
                       the aircraft's registration country from the ADS-B
                       feed, not the overflight country. Do not infer
                       airspace location from this field alone. When a
                       region filter is in effect (see the per-tick
                       Country / region filter line), the events list has
                       ALREADY been narrowed via lat/lon geofence — every
                       row is in the requested region by overflight.
  Maritime           — AIS vessel positions (movements / dark-vessel gaps).
  Conflict           — ACLED / GDELT conflict events.
  EnergyPower        — Global Energy Monitor power-plant registry.
  EnergyPipelines    — gas pipelines + LNG terminals + oil pipelines registry.
  EnergyRefineries   — OpenStreetMap oil-refinery registry.
  Mining             — USGS MRDS mineral-deposit registry.
  AviationInfra      — OurAirports registry.
  MaritimeInfra      — World Port Index registry.
  Weather            — current conditions (Open-Meteo), sampled at the
                       centroid of the rule's region filter. Only one
                       line per tick (the current snapshot), so use
                       Weather as background context — not as a
                       per-event signal. Format:
                       [Weather @<iso>] <slug>: <temp>°C, <descr>,
                       wind <kph> km/h, RH <pct>%.
                       Omitted when the rule has no region filter or
                       the Open-Meteo fetch failed.
  AnomalyFlags       — eYKON's per-domain anomaly stream (raw flags
                       from the detectors). Use to corroborate other
                       buckets, not as a primary trigger.
  ConvergenceEvents  — clustered anomalies with a joint p-value and a
                       short synthesis. A LOW p-value (e.g. < 0.01)
                       indicates statistically meaningful convergence
                       across distinct domains. The synthesis is a
                       Claude-written one-liner from a prior pass —
                       you may use it as a hint but corroborate
                       against the raw event evidence.

Worked examples (these illustrate the decision rules above — follow the same
reasoning, do not pattern-match on surface keywords):

  EXAMPLE 1 — FIRE (cross_data_ai, strong multi-bucket convergence)
    Outcome: "Conditions around the Strait of Hormuz that could materially
              affect oil-price direction."
    Events:
      [Conflict @2026-05-29T09:12Z] explosion in IR · 6 fatalities · 2026-05-29
      [Maritime @2026-05-29T09:40Z] FRONT ALTAIR · flag MH → (none)   ← AIS gap
      [Maritime @2026-05-29T09:05Z] DELTA STAR · flag PA → Fujairah    ← AIS gap
      [EnergyRefineries @2026-05-29T08:50Z] Bandar Abbas · 350000 bpd · IR
    report_decision → fire=true, rationale="Explosion in Iran near Hormuz plus
      two tanker AIS gaps and a 350k-bpd refinery in the strait — multi-bucket
      convergence with direct oil-price relevance."
    Why: ≥2 distinct buckets, events directly support the outcome, fresh.

  EXAMPLE 2 — NO-FIRE (thin / surface evidence)
    Outcome: "Anything that could move WTI by ≥$2/bbl in the next 24 hours."
    Events:
      [Conflict @2026-05-29T07:00Z] protest in BR · 0 fatalities · 2026-05-29
      [Maritime @2026-05-29T06:30Z] EVER GIVEN · flag PA → Rotterdam (routine)
    report_decision → fire=false, rationale="A non-violent protest in Brazil and
      a routine container transit carry no material catalyst for a ≥$2/bbl WTI
      move; evidence is thin."
    Why: no event meaningfully supports the outcome. Bias toward not firing.

  EXAMPLE 3 — NO-FIRE (high precursor cosine, but live events do not corroborate)
    Outcome: "Black Sea posture shift that rhymes with a historical episode."
    Top historical precursor matches:
      • Feb 2022 · Pre-invasion [state_mobilisation, …] · cosine 0.83
    Events:
      [Conflict @2026-05-29T05:00Z] skirmish in UA · 1 fatality · 2026-05-29
    report_decision → fire=false, rationale="Precursor cosine 0.83 to Feb-2022 is
      suggestive, but a single low-fatality skirmish does not corroborate a
      posture shift; high cosine alone is insufficient."
    Why: precursor similarity is a soft analog, never a standalone trigger.`;

// ─── Tool definition for structured output ───────────────────────

const REPORT_DECISION_TOOL = {
  name: 'report_decision',
  description: 'Return the fire / no-fire verdict and a one-sentence rationale.',
  input_schema: {
    type: 'object' as const,
    properties: {
      fire: {
        type: 'boolean' as const,
        description: 'true if the events meaningfully support the outcome statement.',
      },
      rationale: {
        type: 'string' as const,
        description:
          'One sentence ≤220 chars citing specific events. Avoid hedging language.',
      },
    },
    required: ['fire', 'rationale'],
  },
};

// ─── Public API ──────────────────────────────────────────────────

export interface AiDecision {
  fire: boolean;
  rationale: string;
  /** Token usage from the response — surfaced in the cron summary. */
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  } | null;
  /** Events that were sent to the model — included in the log payload. */
  eventsConsidered: string[];
}

/**
 * Resolve which buckets a rule should sample from. cross_data_ai
 * uses the configured buckets verbatim; outcome_ai falls back to the
 * full bucket set when none are configured (broadest recall).
 */
export function resolveBuckets(rule: RuleRow): DataBucket[] {
  if (rule.rule_type === 'cross_data_ai') {
    const cfg = rule.config as unknown as CrossDataAiConfig;
    return Array.isArray(cfg?.buckets) ? cfg.buckets : [];
  }
  if (rule.rule_type === 'outcome_ai') {
    const cfg = rule.config as unknown as OutcomeAiConfig;
    if (Array.isArray(cfg?.buckets) && cfg.buckets.length > 0) return cfg.buckets;
    return [...DATA_BUCKETS];
  }
  return [];
}

/**
 * Read the optional per-rule country filter from rule.config. Returns
 * the trimmed string when present, or null when absent / empty. The
 * field is shared by OutcomeAiConfig and CrossDataAiConfig (PR 2).
 */
export function resolveCountryFilter(rule: RuleRow): string | null {
  const cfg = rule.config as Record<string, unknown> | null | undefined;
  const raw = cfg?.country;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Pull the most-recent events from each bucket the rule covers,
 * up to a per-bucket cap so a single high-volume bucket can't
 * crowd out everything else. Returns event lines pre-formatted for
 * the user message.
 *
 * When rule.config.country is set, each bucket whose spec declares a
 * countryColumn applies an ILIKE filter before ordering. Buckets
 * without a countryColumn (Maritime, Weather) are NOT filtered —
 * see the BucketSpec comment for why.
 */
export async function gatherEvents(
  supabase: SupabaseClient,
  rule: RuleRow,
  buckets: DataBucket[],
  totalCap: number,
): Promise<string[]> {
  if (buckets.length === 0 || totalCap <= 0) return [];
  const perBucketCap = Math.max(1, Math.floor(totalCap / buckets.length));
  const country = resolveCountryFilter(rule);
  const allLines: string[] = [];

  for (const bucket of buckets) {
    // PR 8: Weather has no persistent table — it's an Open-Meteo
    // fetch keyed on the rule's region filter, cached 1h. When the
    // rule has no country/region filter, we omit the bucket entirely
    // (it would be a global weather sample with no anchoring signal).
    if (bucket === 'Weather') {
      if (!country) continue;
      const line = await fetchWeatherForRegion(country);
      if (line) allLines.push(line);
      continue;
    }
    const spec = BUCKET_BY_NAME.get(bucket);
    if (!spec) continue;
    // PR 6: buckets with geoRegionRpc (Maritime, Air) resolve country
    // via ST_Intersects on lat/lon — not via the ILIKE-on-country
    // fallback. This gives operational country for vessels (which
    // have no country column at all) and overflight country for
    // aircraft (vs the registration country in the column). When the
    // rule has no country filter, we drop through to the regular
    // recency query below.
    const tableMeta = getBucketTable(bucket);
    if (country && tableMeta?.geoRegionRpc) {
      const { data } = await supabase.rpc(tableMeta.geoRegionRpc, {
        p_region_slug: country,
        p_limit: perBucketCap,
      });
      const rows = ((data ?? []) as unknown) as Array<Record<string, unknown>>;
      for (const row of rows) allLines.push(spec.format(row));
      continue;
    }

    let q = supabase
      .from(spec.table)
      .select(spec.columns)
      .order(spec.recencyColumn, { ascending: false })
      .limit(perBucketCap);
    if (country && spec.countryColumn) {
      // ILIKE handles both ISO-2 ("SA") and short-name ("Saudi
      // Arabia") values without forcing the rule author to commit to
      // one convention up-front.
      q = q.ilike(spec.countryColumn, `%${country}%`);
    }
    const { data } = await q;
    for (const row of data ?? []) {
      allLines.push(spec.format(row as unknown as Record<string, unknown>));
    }
  }
  // Cheap interleave — most-recent across buckets matters more than
  // per-bucket grouping for the model. The formatted lines now carry
  // their ingested_at timestamp inline (see BUCKET_SPECS), so the
  // model can read recency directly. A future PR could pre-sort by
  // timestamp; for now, return per-bucket recency-first ordering and
  // let the model reorder mentally.
  return allLines.slice(0, totalCap);
}

/**
 * Truncate the events list to fit the input-token budget. Uses a
 * conservative 4-chars-per-token approximation; the actual ratio is
 * model-dependent but this keeps the call well inside §10's 8k cap.
 */
export function truncateToTokenBudget(lines: string[], tokenBudget: number): string[] {
  const charBudget = tokenBudget * 4;
  const out: string[] = [];
  let remaining = charBudget;
  for (const line of lines) {
    if (line.length + 1 > remaining) break;
    out.push(line);
    remaining -= line.length + 1;
  }
  return out;
}

/**
 * Call Claude for the decision. Marks the system prompt with
 * cache_control: ephemeral so the prefix is shared across all rules
 * evaluated in the same tick.
 *
 * supabase is required (PR 7) — the function queries precursor_library
 * with the service-role client passed by the cron route. When the
 * outcome statement does not name a known theatre, findPrecursorMatches
 * returns [] and the prompt simply omits the block.
 */
export async function decideWithClaude(
  rule: RuleRow,
  events: string[],
  supabase: SupabaseClient,
): Promise<AiDecision> {
  const cfg = rule.config as unknown as OutcomeAiConfig | CrossDataAiConfig;
  const outcomeStatement = (cfg?.outcome_statement ?? '').trim();
  const eventsBlock = events.length > 0 ? events.join('\n') : '(no recent events in scope)';
  const country = resolveCountryFilter(rule);
  const countryBlock = country
    ? `Country / region filter: ${country}. Air and Maritime are narrowed via lat/lon geofence against the geo_regions table (operational/overflight country, not registration). Conflict, EnergyPower, EnergyPipelines, EnergyRefineries, Mining, AviationInfra, MaritimeInfra are narrowed via ILIKE on their country column. ConvergenceEvents is narrowed via ILIKE on the location field. Weather is sampled from Open-Meteo at the region's centroid. AnomalyFlags is NOT narrowed (no per-row geo signal yet).\n\n`
    : '';

  // PR 7: surface top-3 historical precursor analogs when the outcome
  // statement names a known theatre. The block is empty otherwise —
  // theatre detection is intentionally conservative.
  const precursorMatches = await findPrecursorMatches(supabase, outcomeStatement, 3);
  const precursorBlock = formatPrecursorBlockForPrompt(precursorMatches);

  const userText = `Rule type: ${rule.rule_type}
Outcome statement: ${outcomeStatement}

${countryBlock}${precursorBlock}Events (most-recent first):
${eventsBlock}

Decide via the report_decision tool.`;

  const anthropic = getAnthropic();
  // SDK 0.32 types don't yet expose cache_control on the system
  // block, but the API accepts it. Cast through unknown so the
  // ephemeral cache marker reaches the wire — verified against the
  // Anthropic API reference for prompt caching.
  const requestBody = {
    model: MODEL,
    max_tokens: MAX_TOKENS_OUT,
    system: [
      {
        type: 'text',
        text: AI_EVALUATOR_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [REPORT_DECISION_TOOL],
    tool_choice: { type: 'tool', name: 'report_decision' },
    messages: [{ role: 'user' as const, content: userText }],
  };
  const response = await anthropic.messages.create(
    requestBody as unknown as Anthropic.Messages.MessageCreateParamsNonStreaming,
  );

  const usage = response.usage as unknown as AiDecision['usage'];
  const toolUse = response.content.find(
    (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
  );
  if (!toolUse || toolUse.name !== 'report_decision') {
    return { fire: false, rationale: 'AI evaluator returned no decision.', usage, eventsConsidered: events };
  }
  const input = toolUse.input as { fire?: unknown; rationale?: unknown };
  const fire = input.fire === true;
  const rationale =
    typeof input.rationale === 'string' && input.rationale.trim()
      ? input.rationale.trim().slice(0, 280)
      : 'No rationale returned.';
  return { fire, rationale, usage, eventsConsidered: events };
}

/**
 * Compose a FirePayload for an AI fire. Keeps the email body
 * symmetric with the cheap-cron payloads — same template, just an
 * extra rationale block driven by NotificationFired's optional
 * rationale prop.
 */
export function buildAiFirePayload(
  rule: RuleRow,
  decision: AiDecision,
  firedAtIso: string,
): FirePayload {
  const cfg = rule.config as unknown as OutcomeAiConfig | CrossDataAiConfig;
  const summary = (cfg?.outcome_statement ?? '').trim();
  const detailLines = decision.eventsConsidered.slice(0, 8);
  return {
    ruleName: rule.name,
    ruleType: rule.rule_type,
    summary: summary || 'AI rule fired.',
    detailLines,
    rationale: decision.rationale,
    firedAtIso,
  };
}

/**
 * The K cap from the rule config, clamped to AI_K_EVENTS_MAX.
 */
export function resolveKEvents(rule: RuleRow): number {
  if (rule.rule_type === 'outcome_ai') {
    const cfg = rule.config as unknown as OutcomeAiConfig;
    const k = Number(cfg?.k_events);
    if (Number.isFinite(k) && k > 0) return Math.min(AI_K_EVENTS_MAX, Math.floor(k));
  }
  return AI_K_EVENTS_DEFAULT;
}

// re-export for the route — keeps the import surface tight.
import type Anthropic from '@anthropic-ai/sdk';
export type { Anthropic };
