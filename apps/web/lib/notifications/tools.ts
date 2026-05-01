// Tool registry for the single-event rule type. Each entry maps to a
// feed table and declares the filters the rule builder renders. The
// cheap-cron evaluator (PR 6) reads from this same registry to compile
// SQL — both sides must agree on filter ids and types.
//
// Lean v1 set covers the brief's persona examples (§4): conflict
// events, refinery status, power-plant status, mining, vessels-going-
// dark, aircraft activity. PR 11 (suggestion library) and the
// evaluator can extend the registry without breaking saved rules
// because rule.config carries the tool id forward.

export const SINGLE_EVENT_TOOLS = [
  {
    id: 'conflict_events',
    label: 'Conflict events',
    description: 'New ACLED / GDELT conflict event matching the filter.',
    table: 'conflict_events',
    filters: [
      {
        id: 'min_fatalities',
        label: 'Minimum fatalities',
        type: 'number' as const,
        default: 0,
      },
      {
        id: 'country',
        label: 'Country (ISO-2 or name; blank = any)',
        type: 'string' as const,
        default: '',
      },
      {
        id: 'event_type',
        label: 'Event type (battle, violence_against_civilians; blank = any)',
        type: 'string' as const,
        default: '',
      },
    ],
  },
  {
    id: 'refineries',
    label: 'Refinery status change',
    description: 'Refinery comes online, offline, or starts a turnaround.',
    table: 'refineries',
    filters: [
      {
        id: 'country',
        label: 'Country (ISO-2 or name; blank = any)',
        type: 'string' as const,
        default: '',
      },
      {
        id: 'min_capacity_bpd',
        label: 'Minimum capacity (bpd)',
        type: 'number' as const,
        default: 0,
      },
    ],
  },
  {
    id: 'power_plants',
    label: 'Power-plant outage',
    description: 'Plant goes dark or capacity drops below the threshold.',
    table: 'power_plants',
    filters: [
      {
        id: 'country',
        label: 'Country (ISO-2 or name; blank = any)',
        type: 'string' as const,
        default: '',
      },
      {
        id: 'min_capacity_mw',
        label: 'Minimum capacity (MW)',
        type: 'number' as const,
        default: 500,
      },
    ],
  },
  {
    id: 'mines',
    label: 'Mine status change',
    description: 'Mine offline at any site producing the listed commodity.',
    table: 'mines',
    filters: [
      {
        id: 'commodity',
        label: 'Commodity (lithium, cobalt, copper, …; blank = any)',
        type: 'string' as const,
        default: '',
      },
      {
        id: 'country',
        label: 'Country (blank = any)',
        type: 'string' as const,
        default: '',
      },
    ],
  },
  {
    id: 'vessel_positions',
    label: 'Vessel AIS gap (going dark)',
    description: 'Vessel in the watchlist with no AIS pings for the listed gap.',
    table: 'vessel_positions',
    filters: [
      {
        id: 'min_gap_hours',
        label: 'Minimum AIS gap (hours)',
        type: 'number' as const,
        default: 12,
      },
      {
        id: 'vessel_class',
        label: 'Vessel class (tanker, cargo; blank = any)',
        type: 'string' as const,
        default: '',
      },
    ],
  },
  {
    id: 'aircraft_positions',
    label: 'Aircraft activity uptick',
    description: 'Aircraft activity above the listed threshold inside a country.',
    table: 'aircraft_positions',
    filters: [
      {
        id: 'country',
        label: 'Country (ISO-2 or name)',
        type: 'string' as const,
        default: '',
      },
      {
        id: 'min_count',
        label: 'Minimum unique aircraft in window',
        type: 'number' as const,
        default: 5,
      },
    ],
  },
] as const;

export type SingleEventToolId = (typeof SINGLE_EVENT_TOOLS)[number]['id'];

export type FilterValue = string | number;

export interface SingleEventConfig {
  tool: SingleEventToolId;
  filters: Record<string, FilterValue>;
}

// Multi-event rule (PR 7). The predicates array is ≥2 single-event
// configs, evaluated as an AND across the window: a fire happens
// when every predicate has at least one matching event within the
// same `window_hours` window. The window walks forward in real time
// — the evaluator looks at the last `window_hours` of feed data on
// each cron tick.
export interface MultiEventConfig {
  predicates: SingleEventConfig[];
  window_hours: number;
}

export const MULTI_EVENT_MIN_PREDICATES = 2;
export const MULTI_EVENT_MAX_PREDICATES = 5;
export const MULTI_EVENT_DEFAULT_WINDOW_HOURS = 6;
export const MULTI_EVENT_MIN_WINDOW_HOURS = 1;
export const MULTI_EVENT_MAX_WINDOW_HOURS = 168; // 7 days — keep the window query bounded.

const TOOL_BY_ID: ReadonlyMap<string, (typeof SINGLE_EVENT_TOOLS)[number]> = new Map(
  SINGLE_EVENT_TOOLS.map(t => [t.id, t]),
);

export function getSingleEventTool(id: string) {
  return TOOL_BY_ID.get(id);
}

export function isValidSingleEventTool(id: unknown): id is SingleEventToolId {
  return typeof id === 'string' && TOOL_BY_ID.has(id);
}

/**
 * Coerce a raw filters object (from the request body) into the
 * registry-defined shape: drop unknown keys, parse numbers, default
 * missing values. Returns the cleaned filters object.
 */
export function coerceFilters(
  toolId: SingleEventToolId,
  raw: Record<string, unknown>,
): Record<string, FilterValue> {
  const tool = getSingleEventTool(toolId);
  if (!tool) return {};
  const out: Record<string, FilterValue> = {};
  for (const filter of tool.filters) {
    const value = raw[filter.id];
    if (filter.type === 'number') {
      const n = typeof value === 'number' ? value : Number(value);
      out[filter.id] = Number.isFinite(n) ? n : filter.default;
    } else {
      out[filter.id] =
        typeof value === 'string' ? value.trim() : String(filter.default);
    }
  }
  return out;
}

/**
 * Build a clean SingleEventConfig from a raw predicate object,
 * validating the tool id and coercing filters. Returns null when the
 * tool is unknown — caller (API) maps this to a 400.
 */
export function coercePredicate(raw: {
  tool?: unknown;
  filters?: Record<string, unknown>;
}): SingleEventConfig | null {
  if (!isValidSingleEventTool(raw.tool)) return null;
  return {
    tool: raw.tool,
    filters: coerceFilters(raw.tool, raw.filters ?? {}),
  };
}

/**
 * Auto-generate a rule name for a multi-event rule. Mirrors the
 * single-event helper: shows up to 2 tool labels and the window.
 */
export function suggestMultiEventRuleName(config: MultiEventConfig): string {
  if (!config.predicates?.length) return 'Multi-event rule';
  const labels = config.predicates
    .slice(0, 2)
    .map(p => getSingleEventTool(p.tool)?.label ?? p.tool)
    .join(' + ');
  const more = config.predicates.length > 2 ? ` (+${config.predicates.length - 2})` : '';
  return `${labels}${more} within ${config.window_hours}h`.slice(0, 120);
}

/**
 * Auto-generate a rule name from the tool + filters. Used as the
 * default in the builder; the user can edit before saving.
 */
export function suggestRuleName(
  toolId: SingleEventToolId,
  filters: Record<string, FilterValue>,
): string {
  const tool = getSingleEventTool(toolId);
  if (!tool) return 'Untitled rule';
  const country = filters.country ? ` · ${filters.country}` : '';
  const min =
    typeof filters.min_fatalities === 'number' && filters.min_fatalities > 0
      ? ` (≥${filters.min_fatalities} fatalities)`
      : typeof filters.min_capacity_mw === 'number' && filters.min_capacity_mw > 0
      ? ` (≥${filters.min_capacity_mw} MW)`
      : typeof filters.min_capacity_bpd === 'number' && filters.min_capacity_bpd > 0
      ? ` (≥${filters.min_capacity_bpd} bpd)`
      : typeof filters.min_gap_hours === 'number'
      ? ` (≥${filters.min_gap_hours} h gap)`
      : '';
  return `${tool.label}${country}${min}`.slice(0, 120);
}
