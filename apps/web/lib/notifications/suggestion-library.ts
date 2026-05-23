import type { PersonaId } from '@/lib/intelligence-analyst/personas';
import type { DataBucket } from './tools';

// Persona-specific starter rules (§4) + universal cross-data block
// (§5). Both render on /notif as click-to-prefill cards. The
// builder consumes a Suggestion via its `prefill` prop and lands on
// the right mode tab with the config already filled in.
//
// PR 1 honesty pass (2026-05-23): the library was pruned from 55 to
// 28 entries. Suggestions whose copy promised capabilities the
// evaluator cannot yet fulfil (count-over-window aggregation, AIS
// gap detection, anomaly_flags / precursor_library / weather
// buckets, per-rule geofence, cross-feed entity linking) were
// removed. Surviving entries were relabeled where the copy
// over-promised on what the evaluator can actually do. PR 9
// (suggestion library v2) refills the library once PRs 2-8 add the
// missing primitives.
//
// IMPORTANT: every config below MUST round-trip cleanly through the
// rule builder + API. Tool ids must exist in SINGLE_EVENT_TOOLS;
// bucket names must be in DATA_BUCKETS.

export type SuggestionRuleType =
  | 'single_event'
  | 'multi_event'
  | 'outcome_ai'
  | 'cross_data_ai';

export interface SingleEventSuggestionConfig {
  rule_type: 'single_event';
  tool: string;
  filters: Record<string, string | number>;
}

export interface MultiEventSuggestionConfig {
  rule_type: 'multi_event';
  predicates: Array<{ tool: string; filters: Record<string, string | number> }>;
  window_hours: number;
}

export interface OutcomeAiSuggestionConfig {
  rule_type: 'outcome_ai';
  outcome_statement: string;
  buckets?: DataBucket[];
}

export interface CrossDataAiSuggestionConfig {
  rule_type: 'cross_data_ai';
  outcome_statement: string;
  buckets: DataBucket[];
}

export type SuggestionConfig =
  | SingleEventSuggestionConfig
  | MultiEventSuggestionConfig
  | OutcomeAiSuggestionConfig
  | CrossDataAiSuggestionConfig;

export interface Suggestion {
  /** Stable across edits — used for telemetry / dedupe in the future. */
  id: string;
  /** Card headline. Used as the rule name default after click. */
  title: string;
  config: SuggestionConfig;
  /** Optional override; falls back to DEFAULT_COOLDOWN_MINUTES. */
  cooldown_minutes?: number;
}

// ─── Persona libraries (§4) ──────────────────────────────────────

const ANALYST: Suggestion[] = [
  {
    id: 'analyst-conflict-pinned-50f',
    title: 'Major conflict event (≥50 fatalities) in any pinned theatre',
    config: {
      rule_type: 'single_event',
      tool: 'conflict_events',
      filters: { min_fatalities: 50, country: '', event_type: '' },
    },
  },
  {
    id: 'analyst-refinery-status',
    title: 'Refinery ingestion event in a sanctioned country',
    config: {
      rule_type: 'single_event',
      tool: 'refineries',
      filters: { country: '', min_capacity_bpd: 0 },
    },
  },
  {
    id: 'analyst-power-outage-500mw',
    title: 'Power-plant ingestion event ≥500 MW (country filter optional)',
    config: {
      rule_type: 'single_event',
      tool: 'power_plants',
      filters: { country: '', min_capacity_mw: 500 },
    },
  },
  {
    id: 'analyst-outcome-hormuz',
    title: 'Hormuz tension: qualitative reads from conflict + maritime feeds',
    config: {
      rule_type: 'outcome_ai',
      outcome_statement:
        'Material elevation in the Hormuz tension picture, judged qualitatively from recent conflict and maritime events.',
      buckets: ['Conflict', 'Maritime'],
    },
  },
];

const JOURNALIST: Suggestion[] = [
  {
    id: 'journ-refinery-sanctioned',
    title: 'Refinery ingestion event ≥10,000 bpd in a sanctioned country',
    config: {
      rule_type: 'single_event',
      tool: 'refineries',
      filters: { country: '', min_capacity_bpd: 10000 },
    },
  },
  {
    id: 'journ-outcome-story-escalation',
    title: 'Convergence-of-anomalies suggesting a story-worthy escalation',
    config: {
      rule_type: 'outcome_ai',
      outcome_statement:
        'Convergence-of-anomalies that suggests a story-worthy escalation (qualitative — model judgement).',
    },
  },
];

const DAY_TRADER: Suggestion[] = [
  {
    id: 'trader-refinery-100kbpd',
    title: 'Refinery ingestion event ≥100,000 bpd capacity (any country)',
    config: {
      rule_type: 'single_event',
      tool: 'refineries',
      filters: { country: '', min_capacity_bpd: 100000 },
    },
    cooldown_minutes: 60,
  },
  {
    id: 'trader-outcome-wti',
    title: 'Conditions that could materially move oil prices (qualitative, model-judged)',
    config: {
      rule_type: 'outcome_ai',
      outcome_statement:
        'Conditions in conflict, maritime, refinery, and pipeline feeds that could materially affect oil-price direction (qualitative — model has no price feed).',
      buckets: ['Conflict', 'Maritime', 'EnergyRefineries', 'EnergyPipelines'],
    },
    cooldown_minutes: 120,
  },
];

const COMMODITIES: Suggestion[] = [
  {
    id: 'comm-chokepoint-closure',
    title: 'Chokepoint disruption signals (Hormuz, Malacca, Suez, Bab-el-Mandeb) — qualitative',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Maritime + conflict signals indicating disruption risk at any of Hormuz, Malacca, Suez, or Bab-el-Mandeb (qualitative — no weather data feed yet).',
      buckets: ['Maritime', 'Conflict'],
    },
  },
  {
    id: 'comm-refinery-turnaround',
    title: 'Refinery ingestion event ≥50,000 bpd in a top-3 producing country',
    config: {
      rule_type: 'single_event',
      tool: 'refineries',
      filters: { country: '', min_capacity_bpd: 50000 },
    },
  },
  {
    id: 'comm-outcome-eu-semiconductors',
    title: 'Threats to EU critical-mineral supply (qualitative; conflict + maritime feeds)',
    config: {
      rule_type: 'outcome_ai',
      outcome_statement:
        'Conditions in conflict and maritime feeds that could threaten EU critical-mineral supply chains (qualitative — mining feed is frozen).',
      buckets: ['Conflict', 'Maritime'],
    },
  },
  {
    id: 'comm-cross-supply-chain',
    title: 'Maritime + conflict convergence affecting critical-mineral chains',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Convergence of maritime and conflict signals affecting critical-mineral supply chains (mining feed currently frozen).',
      buckets: ['Maritime', 'Conflict'],
    },
  },
];

const NGO: Suggestion[] = [
  {
    id: 'ngo-conflict-50f-watchlist',
    title: 'Conflict event ≥50 fatalities (country filter optional)',
    config: {
      rule_type: 'single_event',
      tool: 'conflict_events',
      filters: { min_fatalities: 50, country: '', event_type: '' },
    },
  },
  {
    id: 'ngo-power-crisis-zone',
    title: 'Power-plant ingestion event ≥100 MW in a crisis country',
    config: {
      rule_type: 'single_event',
      tool: 'power_plants',
      filters: { country: '', min_capacity_mw: 100 },
    },
  },
  {
    id: 'ngo-outcome-displacement',
    title: 'Conditions that could trigger mass displacement (qualitative)',
    config: {
      rule_type: 'outcome_ai',
      outcome_statement:
        'Conditions in conflict and power feeds that could displace tens of thousands of people in a watchlist region (qualitative — no weather data feed yet).',
      buckets: ['Conflict', 'EnergyPower'],
    },
  },
  {
    id: 'ngo-cross-aid-corridor',
    title: 'Aid-corridor risk signals (maritime + conflict feeds)',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Multi-feed risk signals affecting humanitarian aid corridors across maritime and conflict feeds (qualitative — no weather data feed yet).',
      buckets: ['Maritime', 'Conflict'],
    },
  },
];

const CITIZEN: Suggestion[] = [
  {
    id: 'cit-conflict-residence',
    title: 'Any conflict event (country filter optional)',
    config: {
      rule_type: 'single_event',
      tool: 'conflict_events',
      filters: { min_fatalities: 1, country: '', event_type: '' },
    },
  },
  {
    id: 'cit-air-disruption',
    title: 'Aircraft activity uptick (≥15 distinct aircraft in window; registration country)',
    config: {
      rule_type: 'single_event',
      tool: 'aircraft_positions',
      filters: { country: '', min_count: 15 },
    },
  },
  {
    id: 'cit-power-grid',
    title: 'Power-plant ingestion event ≥200 MW (country filter optional)',
    config: {
      rule_type: 'single_event',
      tool: 'power_plants',
      filters: { country: '', min_capacity_mw: 200 },
    },
  },
  {
    id: 'cit-outcome-travel',
    title: 'Anything that could affect travel safety in my country in the next 24 h',
    config: {
      rule_type: 'outcome_ai',
      outcome_statement:
        'Anything that could affect travel safety in my country in the next 24 hours.',
    },
  },
  {
    id: 'cit-cross-watchlist',
    title: 'Multi-feed alerts across conflict + power feeds (qualitative)',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Multi-feed alerts across conflict and power feeds, qualitatively assessed (no per-user topic personalisation yet).',
      buckets: ['Conflict', 'EnergyPower'],
    },
  },
];

const CORPORATE: Suggestion[] = [
  {
    id: 'corp-conflict-near-facility',
    title: 'Conflict event (country filter optional)',
    config: {
      rule_type: 'single_event',
      tool: 'conflict_events',
      filters: { min_fatalities: 1, country: '', event_type: '' },
    },
  },
  {
    id: 'corp-critical-infra-outage',
    title: 'Power-plant + conflict events co-occurring (country filter optional)',
    config: {
      rule_type: 'multi_event',
      predicates: [
        { tool: 'power_plants', filters: { country: '', min_capacity_mw: 100 } },
        { tool: 'conflict_events', filters: { min_fatalities: 0, country: '', event_type: '' } },
      ],
      window_hours: 24,
    },
  },
  {
    id: 'corp-outcome-bcp',
    title: 'Conditions matching the trigger criteria of my business-continuity plan',
    config: {
      rule_type: 'outcome_ai',
      outcome_statement:
        'Conditions matching the trigger criteria of my business-continuity plan: facility access disrupted, supply chain interrupted, or workforce safety at risk.',
    },
  },
  {
    id: 'corp-cross-operations-footprint',
    title: 'Convergence across conflict + maritime + energy feeds (qualitative)',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Convergence of conflict, maritime, power, and refinery signals (qualitative; per-rule geofence and sector matching not yet implemented).',
      buckets: ['Conflict', 'Maritime', 'EnergyPower', 'EnergyRefineries'],
    },
  },
];

export const PERSONA_SUGGESTIONS: Record<PersonaId, Suggestion[]> = {
  analyst: ANALYST,
  journalist: JOURNALIST,
  'day-trader': DAY_TRADER,
  commodities: COMMODITIES,
  ngo: NGO,
  citizen: CITIZEN,
  corporate: CORPORATE,
};

// ─── Universal cross-data block (§5) ─────────────────────────────
// Surfaced regardless of persona, below the persona-specific list.
// Each invokes ≥2 buckets — same definition of "cross-data" as in
// the AI Chat Suggested tab.

export const CROSS_DATA_SUGGESTIONS: Suggestion[] = [
  {
    id: 'xd-conflict-refinery-maritime',
    title: 'Co-occurring signals across conflict + refinery + maritime feeds (qualitative)',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Co-occurring signals in conflict, refinery, and maritime feeds across recent events (qualitative; per-theatre geofence not yet enforced).',
      buckets: ['Conflict', 'EnergyRefineries', 'Maritime'],
    },
  },
  {
    id: 'xd-chokepoint-risk',
    title: 'Chokepoint risk: maritime + conflict convergence (qualitative)',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Maritime and conflict convergence at any major chokepoint or regional sea (qualitative — no weather data feed yet).',
      buckets: ['Maritime', 'Conflict'],
    },
  },
  {
    id: 'xd-playbook',
    title: 'Multi-domain pattern signals across conflict + maritime + air + refinery (qualitative)',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Multi-domain pattern signals across conflict, maritime, air, and refinery feeds (qualitative — no playbook library queried).',
      buckets: ['Conflict', 'Maritime', 'Air', 'EnergyRefineries'],
    },
  },
];

// ─── Utility ─────────────────────────────────────────────────────

/**
 * Bucket count for the "× N" badge — same affordance as the AI
 * Chat panel's Suggested tab (brief §3.5).
 */
export function suggestionBucketCount(suggestion: Suggestion): number {
  const cfg = suggestion.config;
  if (cfg.rule_type === 'cross_data_ai' || cfg.rule_type === 'outcome_ai') {
    return cfg.buckets?.length ?? 0;
  }
  if (cfg.rule_type === 'multi_event') {
    return cfg.predicates.length;
  }
  return 1;
}
