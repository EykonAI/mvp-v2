import type { PersonaId } from '@/lib/intelligence-analyst/personas';
import type { DataBucket } from './tools';

// Persona-specific starter rules (§4) + universal cross-data block
// (§5). Both render on /notif as click-to-prefill cards. The
// builder consumes a Suggestion via its `prefill` prop and lands on
// the right mode tab with the config already filled in.
//
// PR 9 — suggestion library v2 (2026-05-23). The library was pruned
// from 55 → 28 in PR 1's honesty pass; PR 9 refills it to ~56 on
// top of the new primitives shipped in PRs 2-8:
//   • per-rule country narrowing (PR 2) — every AI rule can scope
//   • AnomalyFlags + ConvergenceEvents buckets (PR 3)
//   • real AIS-gap detection (PR 4)
//   • geofence lookup — Air/Maritime by overflight (PR 6)
//   • precursor cosine surfaced via theatre keywords (PR 7)
//   • Weather sampled on-demand at the region centroid (PR 8)
//
// Aggregate-rule suggestions (rule_type='aggregate', PR 5) are
// intentionally NOT in the library yet — the rule builder has no
// Aggregate tab, so a one-click suggestion would dead-end. A
// follow-up UI PR adds the tab and the aggregate suggestions.
// Aggregate rules remain creatable via the POST /api/notifications/
// rules endpoint directly.
//
// IMPORTANT: every config below MUST round-trip cleanly through the
// rule builder + API. Tool ids must exist in SINGLE_EVENT_TOOLS;
// bucket names must be in DATA_BUCKETS. Outcome statements that
// mention a known theatre slug or label (red-sea, hormuz, black-sea,
// taiwan-strait, suez, malacca, bosphorus, bab-el-mandeb, panama)
// trigger the precursor-cosine block in the AI evaluator's prompt.

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
  /** Optional per-rule country narrowing (PR 2). When set on an AI
   *  suggestion, the evaluator scopes Conflict / Air / Maritime /
   *  Energy* / Mining / *Infra to the slug — Air + Maritime resolve
   *  via lat/lon geofence (PR 6). */
  country?: string;
}

export interface CrossDataAiSuggestionConfig {
  rule_type: 'cross_data_ai';
  outcome_statement: string;
  buckets: DataBucket[];
  /** See OutcomeAiSuggestionConfig.country. */
  country?: string;
}

export type SuggestionConfig =
  | SingleEventSuggestionConfig
  | MultiEventSuggestionConfig
  | OutcomeAiSuggestionConfig
  | CrossDataAiSuggestionConfig;

/**
 * Feed-availability gating for the self-healing library (PR honesty
 * v2). The /notif page probes BUCKET_TABLES once per render via
 * getFeedHealth() and hides any suggestion whose `requires` cannot
 * be satisfied. Suggestions reappear automatically the moment their
 * feed comes back online — no library edit required.
 *
 *   warm: bucket must have ANY rows (count > 0)
 *   hot:  bucket must have rows AND last-ingest within 24h
 *
 * Both lists are AND-combined: every bucket listed must pass. Omit
 * `requires` entirely when the suggestion is feed-agnostic.
 */
export interface SuggestionRequires {
  warm?: DataBucket[];
  hot?: DataBucket[];
}

export interface Suggestion {
  /** Stable across edits — used for telemetry / dedupe in the future. */
  id: string;
  /** Card headline. Used as the rule name default after click. */
  title: string;
  config: SuggestionConfig;
  /** Optional override; falls back to DEFAULT_COOLDOWN_MINUTES. */
  cooldown_minutes?: number;
  /** Feed-availability gating — see SuggestionRequires. */
  requires?: SuggestionRequires;
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
    title: 'Hormuz tension — qualitative reads with historical precursor anchor',
    config: {
      rule_type: 'outcome_ai',
      outcome_statement:
        'Material elevation in the Hormuz tension picture, judged qualitatively from recent conflict, maritime, and air events. Use historical precursor matches as soft analogs.',
      buckets: ['Conflict', 'Maritime', 'Air'],
      country: 'hormuz',
    },
  },
  {
    id: 'analyst-cross-anomaly-density',
    title: 'Anomaly density spike across distinct feeds in a watched theatre',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Anomaly density spike: a cluster of recent anomaly_flags rows across distinct domains in the same theatre, corroborated by raw events.',
      buckets: ['AnomalyFlags', 'Conflict', 'Maritime', 'Air'],
    },
    requires: { warm: ['AnomalyFlags'] },
  },
  {
    id: 'analyst-cross-black-sea-precursor',
    title: 'Black Sea posture shift — multi-domain pattern with precursor lookup',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Multi-domain pattern across conflict, maritime, and air in the Black Sea theatre that meaningfully rhymes with a labelled historical episode (cosine match surfaces in the prompt).',
      buckets: ['Conflict', 'Maritime', 'Air', 'ConvergenceEvents'],
      country: 'black-sea',
    },
  },
  {
    id: 'analyst-multi-conflict-energy-hormuz',
    title: 'Conflict + refinery co-occurrence in Hormuz (6h)',
    config: {
      rule_type: 'multi_event',
      predicates: [
        { tool: 'conflict_events', filters: { min_fatalities: 1, country: '', event_type: '' } },
        { tool: 'refineries', filters: { country: '', min_capacity_bpd: 50000 } },
      ],
      window_hours: 6,
    },
    requires: { hot: ['EnergyRefineries'] },
  },
  {
    id: 'analyst-single-vessel-dark-hormuz',
    title: 'Vessel going dark in the Strait of Hormuz (≥12 h gap)',
    config: {
      rule_type: 'single_event',
      tool: 'vessel_positions',
      filters: { min_gap_hours: 12, vessel_class: '' },
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
  {
    id: 'journ-single-vessel-dark-redsea',
    title: 'Vessel going dark in the Red Sea (≥6 h gap)',
    config: {
      rule_type: 'single_event',
      tool: 'vessel_positions',
      filters: { min_gap_hours: 6, vessel_class: '' },
    },
  },
  {
    id: 'journ-cross-anomaly-corroboration',
    title: 'Cross-feed anomaly corroboration via ConvergenceEvents synthesis',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Anomaly_flags + ConvergenceEvents convergence: when multiple recent anomalies cluster into a low-p-value convergence event with a non-trivial synthesis.',
      buckets: ['AnomalyFlags', 'ConvergenceEvents', 'Conflict'],
    },
    requires: { warm: ['AnomalyFlags', 'ConvergenceEvents'] },
  },
  {
    id: 'journ-cross-weather-conflict-zone',
    title: 'Weather extreme over an active conflict zone',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Weather extreme (storm, flood, extreme temperature) over a country with active conflict in the same period — humanitarian / logistics angle.',
      buckets: ['Weather', 'Conflict'],
    },
  },
  {
    id: 'journ-outcome-bosphorus-tension',
    title: 'Bosphorus tension shift — multi-domain pattern (precursor-anchored)',
    config: {
      rule_type: 'outcome_ai',
      outcome_statement:
        'Material posture shift in or around the Bosphorus / Black Sea, surfaced with historical precursor analogs in the prompt.',
      buckets: ['Conflict', 'Maritime', 'Air'],
      country: 'bosphorus',
    },
  },
  {
    id: 'journ-cross-aviation-airspace',
    title: 'Aviation activity surge + conflict co-occurrence in a country',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Aviation activity surge co-occurring with conflict signals in the same country — coverage angle for airspace-restriction stories.',
      buckets: ['Air', 'Conflict', 'AviationInfra'],
    },
    requires: { warm: ['Air'] },
  },
  {
    id: 'journ-cross-corroboration-anomaly',
    title: 'Multi-source corroboration in the same theatre (AnomalyFlags-driven)',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Same-window anomalies across ≥2 distinct domains in the same theatre, surfaced as a single AnomalyFlags cluster.',
      buckets: ['AnomalyFlags', 'Conflict', 'Maritime'],
    },
    requires: { warm: ['AnomalyFlags'] },
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
    title: 'Conditions that could materially move oil prices (qualitative)',
    config: {
      rule_type: 'outcome_ai',
      outcome_statement:
        'Conditions in conflict, maritime, refinery, and pipeline feeds that could materially affect oil-price direction (qualitative — model has no price feed).',
      buckets: ['Conflict', 'Maritime', 'EnergyRefineries', 'EnergyPipelines'],
    },
    cooldown_minutes: 120,
  },
  {
    id: 'trader-outcome-hormuz-oil-spike',
    title: 'Oil-spike risk anchored on Hormuz (precursor-aware)',
    config: {
      rule_type: 'outcome_ai',
      outcome_statement:
        'Conditions around the Strait of Hormuz that could materially affect oil-price direction. Use historical precursor matches as soft analogs.',
      buckets: ['Conflict', 'Maritime', 'EnergyRefineries'],
      country: 'hormuz',
    },
    cooldown_minutes: 120,
  },
  {
    id: 'trader-multi-tanker-conflict-hormuz',
    title: 'Tanker going dark + conflict event in Hormuz (6h)',
    config: {
      rule_type: 'multi_event',
      predicates: [
        { tool: 'vessel_positions', filters: { min_gap_hours: 6, vessel_class: 'tanker' } },
        { tool: 'conflict_events', filters: { min_fatalities: 1, country: '', event_type: '' } },
      ],
      window_hours: 6,
    },
    cooldown_minutes: 120,
  },
  {
    id: 'trader-cross-suez-supply-chain',
    title: 'Suez supply-chain disruption signals (Maritime + Conflict + Weather)',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Disruption signals around the Suez Canal across maritime, conflict, and weather feeds.',
      buckets: ['Maritime', 'Conflict', 'Weather'],
      country: 'suez',
    },
    cooldown_minutes: 120,
  },
  {
    id: 'trader-outcome-redsea-disruption',
    title: 'Red Sea shipping disruption — qualitative read with precursor anchor',
    config: {
      rule_type: 'outcome_ai',
      outcome_statement:
        'Red Sea shipping disruption signals across maritime, conflict, and weather feeds — qualitative read, precursor analogs surface in the prompt.',
      buckets: ['Maritime', 'Conflict', 'Weather'],
      country: 'red-sea',
    },
    cooldown_minutes: 120,
  },
  {
    id: 'trader-cross-anomaly-energy',
    title: 'Energy-sector anomaly cluster (AnomalyFlags + refineries + pipelines)',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Recent anomaly_flags in energy domains converging with refinery / pipeline events — early warning for trading-relevant disruptions.',
      buckets: ['AnomalyFlags', 'EnergyRefineries', 'EnergyPipelines'],
    },
    cooldown_minutes: 180,
    requires: { warm: ['AnomalyFlags'] },
  },
];

const COMMODITIES: Suggestion[] = [
  {
    id: 'comm-chokepoint-closure',
    title: 'Chokepoint disruption signals (Hormuz, Malacca, Suez, Bab-el-Mandeb)',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Maritime + conflict + weather signals indicating disruption risk at any of Hormuz, Malacca, Suez, or Bab-el-Mandeb.',
      buckets: ['Maritime', 'Conflict', 'Weather'],
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
    title: 'Threats to EU critical-mineral supply (qualitative)',
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
  {
    id: 'comm-outcome-malacca-disruption',
    title: 'Strait of Malacca disruption — precursor-anchored',
    config: {
      rule_type: 'outcome_ai',
      outcome_statement:
        'Disruption risk in the Strait of Malacca across maritime, conflict, and weather feeds — precursor analogs surface in the prompt.',
      buckets: ['Maritime', 'Conflict', 'Weather'],
      country: 'malacca',
    },
  },
  {
    id: 'comm-cross-weather-mineral-chain',
    title: 'Weather + maritime risk over a critical-mineral corridor',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Weather extreme + maritime disruption signals over a critical-mineral shipping corridor (region filter narrows to a chokepoint).',
      buckets: ['Weather', 'Maritime', 'Conflict'],
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
        'Conditions in conflict, power, and weather feeds that could displace tens of thousands of people in a watchlist region.',
      buckets: ['Conflict', 'EnergyPower', 'Weather'],
    },
  },
  {
    id: 'ngo-cross-aid-corridor',
    title: 'Aid-corridor risk signals (maritime + conflict + weather)',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Multi-feed risk signals affecting humanitarian aid corridors across maritime, conflict, and weather feeds.',
      buckets: ['Maritime', 'Conflict', 'Weather'],
    },
  },
  {
    id: 'ngo-cross-weather-conflict-zone',
    title: 'Weather extreme over an active conflict zone',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Weather extreme (storm, flood, drought, extreme temperature) over a country with active conflict — direct humanitarian impact.',
      buckets: ['Weather', 'Conflict'],
    },
  },
  {
    id: 'ngo-cross-anomaly-density-crisis',
    title: 'Anomaly density rising in a humanitarian-watchlist country',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Recent anomaly_flags clustering in a humanitarian-watchlist country, corroborated by raw conflict and power events.',
      buckets: ['AnomalyFlags', 'Conflict', 'EnergyPower'],
    },
    requires: { warm: ['AnomalyFlags'] },
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
    title: 'Aircraft activity uptick (≥15 distinct aircraft in window)',
    config: {
      rule_type: 'single_event',
      tool: 'aircraft_positions',
      filters: { country: '', min_count: 15 },
    },
    requires: { warm: ['Air'] },
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
    title: 'Multi-feed alerts across conflict + power + weather',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Multi-feed alerts across conflict, power, and weather feeds, qualitatively assessed.',
      buckets: ['Conflict', 'EnergyPower', 'Weather'],
    },
  },
  {
    id: 'cit-cross-weather-region',
    title: 'Weather extreme in my region',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Weather extreme (storm, heatwave, flood) in my region — set the country filter on rule create.',
      buckets: ['Weather', 'Conflict'],
    },
  },
  {
    id: 'cit-cross-anomaly-region',
    title: 'Anomaly cluster in my region (AnomalyFlags + ConvergenceEvents)',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Multiple anomaly_flags or a low-p-value convergence event clustering in my region — surfaces unusual conditions across feeds.',
      buckets: ['AnomalyFlags', 'ConvergenceEvents', 'Conflict'],
    },
    requires: { warm: ['AnomalyFlags'] },
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
    requires: { hot: ['EnergyPower'] },
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
    title: 'Convergence across conflict + maritime + energy feeds',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Convergence of conflict, maritime, power, and refinery signals affecting an operations footprint.',
      buckets: ['Conflict', 'Maritime', 'EnergyPower', 'EnergyRefineries'],
    },
  },
  {
    id: 'corp-cross-counterparty-convergence',
    title: 'Counterparty exposure via ConvergenceEvents synthesis',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'A recent convergence_events row whose synthesis names entities or sectors overlapping my counterparty list (set country on create to narrow).',
      buckets: ['ConvergenceEvents', 'Maritime', 'Conflict'],
    },
    requires: { warm: ['ConvergenceEvents'] },
  },
  {
    id: 'corp-cross-weather-ops',
    title: 'Weather risk affecting an operations region (power + weather)',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Weather extreme combined with power-grid stress in an operations region — set the country filter on rule create.',
      buckets: ['Weather', 'EnergyPower', 'Conflict'],
    },
  },
  {
    id: 'corp-cross-bcp-anomaly',
    title: 'BCP trigger watch via AnomalyFlags clustering',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'AnomalyFlags clustering across distinct domains that, in combination, would activate one of my BCP triggers.',
      buckets: ['AnomalyFlags', 'Conflict', 'Maritime', 'EnergyPower'],
    },
    requires: { warm: ['AnomalyFlags'] },
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
    title: 'Co-occurring signals across conflict + refinery + maritime feeds',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Co-occurring signals in conflict, refinery, and maritime feeds across recent events.',
      buckets: ['Conflict', 'EnergyRefineries', 'Maritime'],
    },
  },
  {
    id: 'xd-chokepoint-risk',
    title: 'Chokepoint risk — maritime + conflict + weather convergence',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Maritime + conflict + weather convergence at any major chokepoint or regional sea — set the country filter on rule create.',
      buckets: ['Maritime', 'Conflict', 'Weather'],
    },
  },
  {
    id: 'xd-playbook',
    title: 'Multi-domain pattern signals (qualitative, model-judged)',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Multi-domain pattern signals across conflict, maritime, air, and refinery feeds (qualitative — no playbook library queried).',
      buckets: ['Conflict', 'Maritime', 'Air', 'EnergyRefineries'],
    },
  },
  {
    id: 'xd-anomaly-of-anomalies',
    title: 'Anomaly-of-anomalies — AnomalyFlags clustering across feeds',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'A cluster of recent anomaly_flags rows spanning ≥2 distinct domains in a recent window, corroborated by raw events.',
      buckets: ['AnomalyFlags', 'Conflict', 'Maritime', 'Air'],
    },
    requires: { warm: ['AnomalyFlags'] },
  },
  {
    id: 'xd-convergence-corroboration',
    title: 'Convergence-events corroboration with raw feeds',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'A recent convergence_events row with a low joint p-value, whose synthesis is corroborated by raw conflict and maritime events.',
      buckets: ['ConvergenceEvents', 'Conflict', 'Maritime'],
    },
    requires: { warm: ['ConvergenceEvents'] },
  },
  {
    id: 'xd-weather-ops-disruption',
    title: 'Weather extreme + ops disruption (Weather + EnergyPower + Maritime)',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Weather extreme combined with power-grid or maritime disruption signals — set the country filter on rule create.',
      buckets: ['Weather', 'EnergyPower', 'Maritime'],
    },
  },
  {
    id: 'xd-precursor-hormuz',
    title: 'Hormuz pattern shift — multi-domain with historical precursor anchor',
    config: {
      rule_type: 'cross_data_ai',
      outcome_statement:
        'Multi-domain posture shift around the Strait of Hormuz that meaningfully rhymes with a labelled historical episode (precursor analogs surface in the prompt).',
      buckets: ['Conflict', 'Maritime', 'Air', 'EnergyRefineries'],
      country: 'hormuz',
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

// ─── Feed-aware filtering (honesty-pass v2) ─────────────────────
// /notif renders only the suggestions whose `requires` are satisfied
// by the live feed-health probe. The helpers below are pure — no DB
// access — so they can run on either the server (Next.js Server
// Component) or the client (after a /api/notifications/feeds-health
// fetch). The probe lives in lib/notifications/feed-health.ts.

/**
 * Minimal shape of the feed-health probe consumed by the filter — we
 * only need per-bucket freshness, not the full FeedStatus payload.
 * This lets the filter run without a runtime dep on feed-health.ts
 * (which pulls in a Supabase client). The probe still produces the
 * richer FeedStatus; this is just the slice we read.
 */
export interface SuggestionFeedView {
  freshness: 'live' | 'stale' | 'empty';
}

export type SuggestionFeedHealth = Partial<Record<DataBucket, SuggestionFeedView>>;

/**
 * True when every requires.warm bucket has rows (freshness !==
 * 'empty') and every requires.hot bucket is 'live'. Suggestions with
 * no `requires` field always pass.
 */
export function suggestionFeedRequirementsMet(
  suggestion: Suggestion,
  feedHealth: SuggestionFeedHealth,
): boolean {
  const req = suggestion.requires;
  if (!req) return true;
  for (const b of req.warm ?? []) {
    const st = feedHealth[b];
    if (!st || st.freshness === 'empty') return false;
  }
  for (const b of req.hot ?? []) {
    const st = feedHealth[b];
    if (!st || st.freshness !== 'live') return false;
  }
  return true;
}

/**
 * Compute the set of suggestion ids whose feed requirements are NOT
 * met. The /notif page passes this set to NotifShell, which skips any
 * card whose id is in it. Order of operations:
 *   1. /notif page (Server Component) calls getFeedHealth(supabase)
 *   2. computeHiddenSuggestionIds(feedHealth) → string[]
 *   3. <NotifShell hiddenSuggestionIds={…} />
 */
export function computeHiddenSuggestionIds(
  feedHealth: SuggestionFeedHealth,
): string[] {
  const hidden: string[] = [];
  const all: Suggestion[] = [
    ...Object.values(PERSONA_SUGGESTIONS).flat(),
    ...CROSS_DATA_SUGGESTIONS,
  ];
  for (const s of all) {
    if (!suggestionFeedRequirementsMet(s, feedHealth)) hidden.push(s.id);
  }
  return hidden;
}
