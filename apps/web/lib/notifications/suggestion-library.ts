import type { PersonaId } from '@/lib/intelligence-analyst/personas';
import type { DataBucket } from './tools';

// Persona-specific starter rules (§4) + universal cross-data block
// (§5). Both render on /notif as click-to-prefill cards. The
// builder consumes a Suggestion via its `prefill` prop and lands on
// the right mode tab with the config already filled in.
//
// IMPORTANT: every config below MUST round-trip cleanly through the
// rule builder + API. Tool ids must exist in SINGLE_EVENT_TOOLS;
// bucket names must be in DATA_BUCKETS. Brief examples that don't
// have a SQL evaluator (precursor library, supervisor convergences,
// agent reports) are encoded as outcome_ai or cross_data_ai so the
// AI cron handles them via Claude.

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
    title: 'Refinery in a sanctioned country comes online or offline',
    config: {
      rule_type: 'single_event',
      tool: 'refineries',
      filters: { country: '', min_capacity_bpd: 0 },
    },
  },
  {
    id: 'analyst-power-outage-500mw',
    title: 'Power plant >500 MW goes dark in a pinned country',
    config: {
      rule_type: 'single_event',
      tool: 'power_plants',
      filters: { country: '', min_capacity_mw: 500 },
    },
  },
  {
    id: 'analyst-multi-air-ais-gap',
    title: 'Aircraft activity uptick AND AIS coverage drop in the same theatre within 6 h',
    config: {
      rule_type: 'multi_event',
      predicates: [
        { tool: 'aircraft_positions', filters: { country: '', min_count: 30 } },
        { tool: 'vessel_positions', filters: { min_gap_hours: 6, vessel_class: '' } },
      ],
      window_hours: 6,
    },
  },
  {
    id: 'analyst-multi-conflict-cluster',
    title: '≥2 conflict events of "battle" type within 6 h in the same admin-1 region',
    config: {
      rule_type: 'multi_event',
      predicates: [
        { tool: 'conflict_events', filters: { min_fatalities: 0, country: '', event_type: 'battle' } },
        { tool: 'conflict_events', filters: { min_fatalities: 0, country: '', event_type: 'battle' } },
      ],
      window_hours: 6,
    },
  },
  {
    id: 'analyst-outcome-hormuz',
    title: 'Anything that could elevate the Hormuz posture score by ≥0.1 in the next 24 h',
    config: {
      rule_type: 'outcome_ai',
      outcome_statement:
        'Anything that could elevate the Hormuz posture score by ≥0.1 in the next 24 hours.',
    },
  },
  {
    id: 'analyst-cross-precursor',
    title: 'Multi-domain pattern matching the precursor library for an inter-state opening',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Multi-domain pattern matching the precursor library for an inter-state conflict opening — fires on ≥0.75 cosine against any labelled historical episode.',
      buckets: ['Conflict', 'Maritime', 'Air'],
    },
  },
  {
    id: 'analyst-cross-anomaly-of-anomalies',
    title: 'Anomaly-of-anomalies: ≥3 anomaly flags within 24 h in the same theatre',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Anomaly-of-anomalies: ≥3 anomaly flags within 24 hours in the same theatre, regardless of feed.',
      buckets: ['Conflict', 'Maritime', 'Air', 'EnergyRefineries'],
    },
  },
];

const JOURNALIST: Suggestion[] = [
  {
    id: 'journ-first-conflict-cold-region',
    title: 'First confirmed conflict event in a country with none for 6+ months',
    config: {
      rule_type: 'outcome_ai',
      outcome_statement:
        'First confirmed conflict event in a country that has had none in the previous 6+ months.',
      buckets: ['Conflict'],
    },
  },
  {
    id: 'journ-refinery-sanctioned',
    title: 'New refinery commissioning in a sanctioned country',
    config: {
      rule_type: 'single_event',
      tool: 'refineries',
      filters: { country: '', min_capacity_bpd: 10000 },
    },
  },
  {
    id: 'journ-vessels-going-dark',
    title: 'A previously-tracked sub-fleet of vessels suddenly going dark (≥3, ≥12 h gap)',
    config: {
      rule_type: 'single_event',
      tool: 'vessel_positions',
      filters: { min_gap_hours: 12, vessel_class: '' },
    },
  },
  {
    id: 'journ-multi-conflict-storm',
    title: '≥3 conflict events in a single country within 24 h (story-breaking threshold)',
    config: {
      rule_type: 'multi_event',
      predicates: [
        { tool: 'conflict_events', filters: { min_fatalities: 1, country: '', event_type: '' } },
        { tool: 'conflict_events', filters: { min_fatalities: 1, country: '', event_type: '' } },
        { tool: 'conflict_events', filters: { min_fatalities: 1, country: '', event_type: '' } },
      ],
      window_hours: 24,
    },
  },
  {
    id: 'journ-multi-aviation-airspace',
    title: 'Aviation infrastructure incident AND airspace anomaly in the same admin-1 region',
    config: {
      rule_type: 'multi_event',
      predicates: [
        { tool: 'aircraft_positions', filters: { country: '', min_count: 5 } },
        { tool: 'conflict_events', filters: { min_fatalities: 0, country: '', event_type: '' } },
      ],
      window_hours: 12,
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
  {
    id: 'journ-cross-cyber-kinetic',
    title: 'Combinations suggesting a coordinated cyber + kinetic operation in the same theatre',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Combinations of feeds that suggest a coordinated cyber + kinetic operation in the same theatre.',
      buckets: ['Conflict', 'Air', 'Maritime'],
    },
  },
  {
    id: 'journ-cross-corroboration',
    title: 'Same event reported by ≥2 independent feeds within 1 h',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Multi-source corroboration — same event reported by ≥2 independent feeds within 1 hour, useful for fast verification.',
      buckets: ['Conflict', 'Maritime', 'Air'],
    },
  },
];

const DAY_TRADER: Suggestion[] = [
  {
    id: 'trader-refinery-100kbpd',
    title: 'Refinery outage >100,000 bpd anywhere — fires on detection',
    config: {
      rule_type: 'single_event',
      tool: 'refineries',
      filters: { country: '', min_capacity_bpd: 100000 },
    },
    cooldown_minutes: 60,
  },
  {
    id: 'trader-tanker-rerouting',
    title: 'Major tanker re-routing detected (e.g. Suez avoidance)',
    config: {
      rule_type: 'single_event',
      tool: 'vessel_positions',
      filters: { min_gap_hours: 6, vessel_class: 'tanker' },
    },
    cooldown_minutes: 60,
  },
  {
    id: 'trader-mine-halt',
    title: 'Mine halt at any top-10 lithium / cobalt / copper site',
    config: {
      rule_type: 'single_event',
      tool: 'mines',
      filters: { commodity: 'Lithium', country: '' },
    },
  },
  {
    id: 'trader-multi-conflict-tanker',
    title: 'Conflict near oil infra AND tanker AIS gap in same 200 km radius within 6 h',
    config: {
      rule_type: 'multi_event',
      predicates: [
        { tool: 'conflict_events', filters: { min_fatalities: 1, country: '', event_type: '' } },
        { tool: 'vessel_positions', filters: { min_gap_hours: 6, vessel_class: 'tanker' } },
      ],
      window_hours: 6,
    },
    cooldown_minutes: 120,
  },
  {
    id: 'trader-multi-power-heatwave',
    title: 'Power plant trip AND heatwave in same grid region within 12 h',
    config: {
      rule_type: 'multi_event',
      predicates: [
        { tool: 'power_plants', filters: { country: '', min_capacity_mw: 500 } },
        { tool: 'conflict_events', filters: { min_fatalities: 0, country: '', event_type: '' } },
      ],
      window_hours: 12,
    },
  },
  {
    id: 'trader-outcome-wti',
    title: 'Anything that could move WTI / Brent by ≥$2/bbl in the next 24 h',
    config: {
      rule_type: 'outcome_ai',
      outcome_statement:
        'Anything that could move WTI or Brent by at least $2/bbl in the next 24 hours.',
      buckets: ['Conflict', 'Maritime', 'EnergyRefineries', 'EnergyPipelines'],
    },
    cooldown_minutes: 120,
  },
  {
    id: 'trader-cross-oil-spike',
    title: 'Cross-asset convergence matching historical oil-spike precursors',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Cross-asset convergence matching historical oil-spike precursors (conflict + maritime + refinery within a single 48-hour window).',
      buckets: ['Conflict', 'Maritime', 'EnergyRefineries'],
    },
    cooldown_minutes: 240,
  },
];

const COMMODITIES: Suggestion[] = [
  {
    id: 'comm-mine-watchlist',
    title: 'Mine offline at any site producing a watchlist mineral (lithium, cobalt, REE…)',
    config: {
      rule_type: 'single_event',
      tool: 'mines',
      filters: { commodity: 'Lithium', country: '' },
    },
  },
  {
    id: 'comm-chokepoint-closure',
    title: 'Major chokepoint closure scenario triggered (Hormuz, Malacca, Suez, Bab-el-Mandeb)',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Major chokepoint closure scenario triggered at any of Hormuz, Malacca, Suez, or Bab-el-Mandeb.',
      buckets: ['Maritime', 'Conflict', 'Weather'],
    },
  },
  {
    id: 'comm-refinery-turnaround',
    title: 'Refinery turnaround announcement in a top-3 producing country',
    config: {
      rule_type: 'single_event',
      tool: 'refineries',
      filters: { country: '', min_capacity_bpd: 50000 },
    },
  },
  {
    id: 'comm-multi-mine-transport',
    title: 'Mine outage AND transport-corridor disruption affecting same supply chain (7 d)',
    config: {
      rule_type: 'multi_event',
      predicates: [
        { tool: 'mines', filters: { commodity: '', country: '' } },
        { tool: 'vessel_positions', filters: { min_gap_hours: 24, vessel_class: '' } },
      ],
      window_hours: 168,
    },
  },
  {
    id: 'comm-outcome-eu-semiconductors',
    title: 'Conditions threatening EU semiconductor mineral supply (Ga, Ge, In, REEs)',
    config: {
      rule_type: 'outcome_ai',
      outcome_statement:
        'Conditions threatening EU semiconductor mineral supply (gallium, germanium, indium, rare earths).',
      buckets: ['Mining', 'Conflict', 'Maritime'],
    },
  },
  {
    id: 'comm-cross-supply-chain',
    title: 'Convergence of mining + maritime + conflict signals affecting a critical-mineral chain',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Convergence of mining + maritime + conflict signals affecting a critical-mineral supply chain.',
      buckets: ['Mining', 'Maritime', 'Conflict'],
    },
  },
];

const NGO: Suggestion[] = [
  {
    id: 'ngo-conflict-50f-watchlist',
    title: 'Conflict event with ≥50 fatalities in a watchlist region',
    config: {
      rule_type: 'single_event',
      tool: 'conflict_events',
      filters: { min_fatalities: 50, country: '', event_type: '' },
    },
  },
  {
    id: 'ngo-power-crisis-zone',
    title: 'Power plant offline in an active humanitarian-crisis zone for >2 h',
    config: {
      rule_type: 'single_event',
      tool: 'power_plants',
      filters: { country: '', min_capacity_mw: 100 },
    },
  },
  {
    id: 'ngo-weather-conflict-zone',
    title: 'Major weather event over an active conflict zone',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'A major weather event (storm, flood, drought) over an active conflict zone.',
      buckets: ['Weather', 'Conflict'],
    },
  },
  {
    id: 'ngo-multi-high-fatality-cluster',
    title: 'Multiple high-fatality events (≥3 with ≥10 fatalities each) in same country, 7 d',
    config: {
      rule_type: 'multi_event',
      predicates: [
        { tool: 'conflict_events', filters: { min_fatalities: 10, country: '', event_type: '' } },
        { tool: 'conflict_events', filters: { min_fatalities: 10, country: '', event_type: '' } },
        { tool: 'conflict_events', filters: { min_fatalities: 10, country: '', event_type: '' } },
      ],
      window_hours: 168,
    },
  },
  {
    id: 'ngo-outcome-displacement',
    title: 'Conditions that could displace ≥10,000 people in a watchlist region',
    config: {
      rule_type: 'outcome_ai',
      outcome_statement:
        'Conditions that could displace at least 10,000 people in a watchlist region.',
      buckets: ['Conflict', 'Weather', 'EnergyPower'],
    },
  },
  {
    id: 'ngo-cross-aid-corridor',
    title: 'Aid-corridor risk score deteriorating ≥0.2 across maritime + conflict + weather',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Aid-corridor risk score deteriorating by 0.2 or more across maritime, conflict, and weather feeds.',
      buckets: ['Maritime', 'Conflict', 'Weather'],
    },
  },
];

const CITIZEN: Suggestion[] = [
  {
    id: 'cit-conflict-residence',
    title: 'Conflict event in my country of residence',
    config: {
      rule_type: 'single_event',
      tool: 'conflict_events',
      filters: { min_fatalities: 1, country: '', event_type: '' },
    },
  },
  {
    id: 'cit-major-weather',
    title: 'Major weather event in my region (storm, heatwave, flood)',
    config: {
      rule_type: 'outcome_ai',
      outcome_statement: 'Major weather event in my region — storm, heatwave, or flood warning.',
      buckets: ['Weather'],
    },
  },
  {
    id: 'cit-air-disruption',
    title: 'Significant air-traffic disruption in my country',
    config: {
      rule_type: 'single_event',
      tool: 'aircraft_positions',
      filters: { country: '', min_count: 15 },
    },
  },
  {
    id: 'cit-power-grid',
    title: 'Power-grid event affecting >100,000 customers in my region',
    config: {
      rule_type: 'single_event',
      tool: 'power_plants',
      filters: { country: '', min_capacity_mw: 200 },
    },
  },
  {
    id: 'cit-multi-incident-cluster',
    title: 'Multiple incidents within 50 km of my home in 48 h',
    config: {
      rule_type: 'multi_event',
      predicates: [
        { tool: 'conflict_events', filters: { min_fatalities: 0, country: '', event_type: '' } },
        { tool: 'conflict_events', filters: { min_fatalities: 0, country: '', event_type: '' } },
      ],
      window_hours: 48,
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
    title: 'Watchlist alerts personalised to the regions and topics I track',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Watchlist alerts personalised to the regions and topics I track in the AI Chat history.',
      buckets: ['Conflict', 'Weather', 'EnergyPower'],
    },
  },
];

const CORPORATE: Suggestion[] = [
  {
    id: 'corp-sanctions-update',
    title: 'Sanctions-list update affecting my registered sector or counterparty list',
    config: {
      rule_type: 'outcome_ai',
      outcome_statement:
        'Sanctions-list update affecting my registered sector or counterparty list.',
    },
  },
  {
    id: 'corp-conflict-near-facility',
    title: 'Conflict event within X km of any registered facility',
    config: {
      rule_type: 'single_event',
      tool: 'conflict_events',
      filters: { min_fatalities: 1, country: '', event_type: '' },
    },
  },
  {
    id: 'corp-vessel-sanctioned-port',
    title: 'Vessel of interest entering a sanctions-denied port',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'A vessel on my watchlist entering a sanctions-denied port.',
      buckets: ['Maritime', 'MaritimeInfra'],
    },
  },
  {
    id: 'corp-critical-infra-outage',
    title: 'Critical infrastructure outage in a registered city of operation',
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
    title: 'Convergence affecting my operations footprint — geo-fenced + sector-tagged signal',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Convergence affecting my operations footprint — geo-fenced and sector-tagged composite signal.',
      buckets: ['Conflict', 'Maritime', 'EnergyPower', 'EnergyRefineries'],
    },
  },
  {
    id: 'corp-cross-counterparty',
    title: 'Counterparty exposure: a watchlist counterparty in a multi-feed event',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'A watchlist counterparty implicated in a multi-feed event spanning vessels, sanctions, and agent reports.',
      buckets: ['Maritime', 'Conflict'],
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
    title: 'Convergence of conflict + refinery + maritime signals in same theatre within 24 h',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Convergence of conflict, refinery, and maritime signals in the same theatre within a 24-hour window.',
      buckets: ['Conflict', 'EnergyRefineries', 'Maritime'],
    },
  },
  {
    id: 'xd-precursor-cosine',
    title: 'Precursor-library cosine ≥0.75 against any historical episode',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Precursor-library cosine ≥0.75 against any labelled historical episode (multi-domain by construction).',
      buckets: ['Conflict', 'Maritime', 'Air', 'EnergyRefineries'],
    },
  },
  {
    id: 'xd-anomaly-of-anomalies',
    title: 'Anomaly-of-anomalies: ≥3 anomaly flags in 24 h in same region across distinct feeds',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Anomaly-of-anomalies: at least 3 anomaly flags within 24 hours in the same region across distinct feeds.',
      buckets: ['Conflict', 'Maritime', 'Air', 'EnergyPower'],
    },
  },
  {
    id: 'xd-corroboration',
    title: 'Cross-feed corroboration: same event reported by ≥2 independent feeds within 1 h',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Cross-feed corroboration: the same event reported by at least 2 independent feeds within 1 hour.',
      buckets: ['Conflict', 'Maritime', 'Air'],
    },
  },
  {
    id: 'xd-chokepoint-risk',
    title: 'Composite chokepoint risk: maritime + conflict + weather convergence',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Composite chokepoint risk: maritime, conflict, and weather convergence at any of the 26 chokepoints / regional seas.',
      buckets: ['Maritime', 'Conflict', 'Weather'],
    },
  },
  {
    id: 'xd-playbook',
    title: 'Multi-domain pattern matching a known geopolitical playbook',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Multi-domain pattern matching a known geopolitical playbook (model-evaluated).',
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
