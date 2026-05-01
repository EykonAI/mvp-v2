import type { SupabaseClient } from '@supabase/supabase-js';
import { getAnthropic } from '@/lib/anthropic';
import {
  DATA_BUCKETS,
  AI_K_EVENTS_DEFAULT,
  AI_K_EVENTS_MAX,
  type DataBucket,
  type OutcomeAiConfig,
  type CrossDataAiConfig,
} from './tools';
import type { FirePayload } from './dispatch';
import type { RuleRow } from './evaluator-cheap';

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
  /** One-line label format used in the events block. */
  format: (row: Record<string, unknown>) => string;
}

const BUCKET_SPECS: ReadonlyArray<BucketSpec> = [
  {
    bucket: 'Conflict',
    table: 'conflict_events',
    columns: 'event_type, country, fatalities, event_date, ingested_at',
    recencyColumn: 'ingested_at',
    format: r =>
      `[Conflict] ${r.event_type ?? '?'} in ${r.country ?? '?'} · ${r.fatalities ?? 0} fatalities · ${r.event_date ?? '?'}`,
  },
  {
    bucket: 'Air',
    table: 'aircraft_positions',
    columns: 'callsign, country, ingested_at',
    recencyColumn: 'ingested_at',
    format: r => `[Air] ${r.callsign ?? '?'} over ${r.country ?? '?'}`,
  },
  {
    bucket: 'Maritime',
    table: 'vessel_positions',
    columns: 'name, mmsi, flag, destination, ingested_at',
    recencyColumn: 'ingested_at',
    format: r =>
      `[Maritime] ${r.name ?? r.mmsi ?? '?'} · flag ${r.flag ?? '?'} → ${r.destination ?? '?'}`,
  },
  {
    bucket: 'EnergyPower',
    table: 'power_plants',
    columns: 'plant_name, country, capacity_mw, fuel_type, status, ingested_at',
    recencyColumn: 'ingested_at',
    format: r =>
      `[EnergyPower] ${r.plant_name ?? '?'} · ${r.capacity_mw ?? '?'} MW ${r.fuel_type ?? ''} · ${r.country ?? '?'} · ${r.status ?? ''}`,
  },
  {
    bucket: 'EnergyRefineries',
    table: 'refineries',
    columns: 'refinery_name, country, capacity_bpd, ingested_at',
    recencyColumn: 'ingested_at',
    format: r =>
      `[EnergyRefineries] ${r.refinery_name ?? '?'} · ${r.capacity_bpd ?? '?'} bpd · ${r.country ?? '?'}`,
  },
  {
    bucket: 'EnergyPipelines',
    table: 'gas_pipelines',
    columns: 'name, country, status, ingested_at',
    recencyColumn: 'ingested_at',
    format: r => `[EnergyPipelines] ${r.name ?? '?'} · ${r.country ?? '?'} · ${r.status ?? ''}`,
  },
  {
    bucket: 'Mining',
    table: 'mines',
    columns: 'site_name, country, commod1, dev_stat, ingested_at',
    recencyColumn: 'ingested_at',
    format: r =>
      `[Mining] ${r.site_name ?? '?'} · ${r.commod1 ?? '?'} · ${r.country ?? '?'} · ${r.dev_stat ?? ''}`,
  },
  {
    bucket: 'AviationInfra',
    table: 'airports',
    columns: 'name, iso_country, type, ingested_at',
    recencyColumn: 'ingested_at',
    format: r => `[AviationInfra] ${r.name ?? '?'} · ${r.iso_country ?? '?'} · ${r.type ?? ''}`,
  },
  {
    bucket: 'MaritimeInfra',
    table: 'ports',
    columns: 'port_name, country, harbor_size, ingested_at',
    recencyColumn: 'ingested_at',
    format: r =>
      `[MaritimeInfra] ${r.port_name ?? '?'} · ${r.country ?? '?'} · ${r.harbor_size ?? ''}`,
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
  2. An events list pulled from up to 10 data buckets (Air, Maritime, Conflict,
     EnergyPower, EnergyPipelines, EnergyRefineries, Mining, AviationInfra,
     MaritimeInfra, Weather), most-recent first. Older events have been
     truncated to fit a token budget.
  3. The rule type — outcome_ai (single-domain or open) or cross_data_ai (≥2
     buckets, expects multi-domain convergence).

Your decision rules:
  • Fire only when the events meaningfully support the outcome statement —
    not on weak surface-level keyword matches.
  • For cross_data_ai, the supporting events MUST span ≥2 distinct buckets.
  • Bias toward NOT firing when evidence is thin. False fires erode user trust.
  • Respect persona context: "day-trader" wants sub-24-h material moves;
    "NGO" wants humanitarian risk, not market signals.

Output: call the report_decision tool with:
  • fire: boolean
  • rationale: one sentence (≤220 chars) explaining the call. Cite specific
    event details ("ACLED battle event in Yemen with 60+ fatalities, plus a
    Hormuz tanker AIS gap in the same window"). Avoid hedging language.

Bucket inventory and approximate semantics:
  Air                — ADS-B aircraft pings (movements / patrol density).
  Maritime           — AIS vessel positions (movements / dark-vessel gaps).
  Conflict           — ACLED / GDELT conflict events.
  EnergyPower        — Global Energy Monitor power-plant registry.
  EnergyPipelines    — gas pipelines + LNG terminals + oil pipelines registry.
  EnergyRefineries   — OpenStreetMap oil-refinery registry.
  Mining             — USGS MRDS mineral-deposit registry.
  AviationInfra      — OurAirports registry.
  MaritimeInfra      — World Port Index registry.
  Weather            — current conditions (Open-Meteo, on-demand only).`;

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
 * Pull the most-recent events from each bucket the rule covers,
 * up to a per-bucket cap so a single high-volume bucket can't
 * crowd out everything else. Returns event lines pre-formatted for
 * the user message.
 */
export async function gatherEvents(
  supabase: SupabaseClient,
  rule: RuleRow,
  buckets: DataBucket[],
  totalCap: number,
): Promise<string[]> {
  if (buckets.length === 0 || totalCap <= 0) return [];
  const perBucketCap = Math.max(1, Math.floor(totalCap / buckets.length));
  const allLines: string[] = [];

  for (const bucket of buckets) {
    const spec = BUCKET_BY_NAME.get(bucket);
    if (!spec) continue;
    const { data } = await supabase
      .from(spec.table)
      .select(spec.columns)
      .order(spec.recencyColumn, { ascending: false })
      .limit(perBucketCap);
    for (const row of data ?? []) {
      allLines.push(spec.format(row as unknown as Record<string, unknown>));
    }
  }
  // Cheap interleave — most-recent across buckets matters more than
  // per-bucket grouping for the model. Sort by ingested_at descending
  // would be ideal, but the formatted lines have already lost the
  // timestamp; return as-is and let the model treat the list
  // unordered.
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
 */
export async function decideWithClaude(
  rule: RuleRow,
  events: string[],
): Promise<AiDecision> {
  const cfg = rule.config as unknown as OutcomeAiConfig | CrossDataAiConfig;
  const outcomeStatement = (cfg?.outcome_statement ?? '').trim();
  const eventsBlock = events.length > 0 ? events.join('\n') : '(no recent events in scope)';

  const userText = `Rule type: ${rule.rule_type}
Outcome statement: ${outcomeStatement}

Events (most-recent first):
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
