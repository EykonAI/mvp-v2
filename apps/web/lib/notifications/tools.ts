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
    description:
      'Vessel that was previously pinging but has stopped reporting AIS for at least the listed gap.',
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

// ─── AI rule configs (PR 8) ─────────────────────────────────────
// Both AI rule types share the same Claude evaluator. cross_data_ai
// additionally requires ≥2 buckets per brief §3.5; outcome_ai will
// auto-select buckets if none are specified, falling back to "all"
// when the user wants the broadest recall.

export const DATA_BUCKETS = [
  'Air',
  'Maritime',
  'Conflict',
  'EnergyPower',
  'EnergyPipelines',
  'EnergyRefineries',
  'Mining',
  'AviationInfra',
  'MaritimeInfra',
  'Weather',
  // PR 3: in-house signal-detection tables that pre-date the
  // Notification Center. anomaly_flags is written by the per-domain
  // detectors; convergence_events is written by the
  // /api/cron/compute-convergences cron that clusters recent
  // anomalies into joint p-value windows.
  'AnomalyFlags',
  'ConvergenceEvents',
] as const;
export type DataBucket = (typeof DATA_BUCKETS)[number];

const DATA_BUCKET_SET: ReadonlySet<string> = new Set(DATA_BUCKETS);

export function isValidDataBucket(value: unknown): value is DataBucket {
  return typeof value === 'string' && DATA_BUCKET_SET.has(value);
}

export interface OutcomeAiConfig {
  outcome_statement: string;
  k_events: number;       // capped at AI_K_EVENTS_MAX in the evaluator
  buckets?: DataBucket[]; // optional scope; empty = all
  /**
   * Optional per-rule country narrowing (PR 2). When set, gatherEvents
   * applies an ILIKE filter on each bucket's country column before
   * Claude sees the rows. Buckets without a country column (Maritime
   * — flag ≠ operational country; Weather — no table) are left
   * unfiltered; PR 6 (geofence lookup) will close that gap.
   */
  country?: string;
}

export interface CrossDataAiConfig {
  outcome_statement: string;
  buckets: DataBucket[];  // ≥2 required
  /** See OutcomeAiConfig.country. */
  country?: string;
}

/** Max length of the optional country filter (ISO-2 or short name). */
export const RULE_COUNTRY_FILTER_MAX_CHARS = 32;

// ─── Bucket → table metadata (PR 5) ──────────────────────────────
// Source-of-truth for "which table backs each bucket" — used by the
// aggregate evaluator (cheap cron) and by evaluator-ai's
// BUCKET_SPECS (which layers a per-bucket format function on top).
// Weather is intentionally absent — it has no persistent table.

export interface BucketTableSpec {
  bucket: DataBucket;
  table: string;
  /** ORDER BY column for recency-based filtering. */
  recencyColumn: string;
  /** Column to apply rule.config.country / filter.country against via ILIKE. */
  countryColumn?: string;
  /** Default column for metric='count_distinct' when distinct_on is not set. */
  defaultDistinctColumn?: string;
  /**
   * When set, country filter resolves via geo_regions (PR 6 — migration
   * 042) using ST_Intersects on this bucket's geom column rather than
   * the ILIKE-on-countryColumn fallback. The string is the Supabase
   * RPC function name (recent_aircraft_in_region /
   * recent_vessels_in_region). countryColumn is ignored when this is
   * present.
   *
   * Maritime: vessel.flag is flag-of-registration, not operational
   *           country — the RPC gives operational country via lat/lon.
   * Air:      country column is registration country, not overflight
   *           country — the RPC gives overflight country.
   */
  geoRegionRpc?: string;
}

export const BUCKET_TABLES: ReadonlyArray<BucketTableSpec> = [
  { bucket: 'Conflict',          table: 'conflict_events',   recencyColumn: 'ingested_at', countryColumn: 'country',     defaultDistinctColumn: 'event_id' },
  { bucket: 'Air',               table: 'aircraft_positions',recencyColumn: 'ingested_at', countryColumn: 'country',     defaultDistinctColumn: 'icao24', geoRegionRpc: 'recent_aircraft_in_region' },
  { bucket: 'Maritime',          table: 'vessel_positions',  recencyColumn: 'ingested_at',                                defaultDistinctColumn: 'mmsi',   geoRegionRpc: 'recent_vessels_in_region' },
  { bucket: 'EnergyPower',       table: 'power_plants',      recencyColumn: 'ingested_at', countryColumn: 'country' },
  { bucket: 'EnergyRefineries',  table: 'refineries',        recencyColumn: 'ingested_at', countryColumn: 'country' },
  { bucket: 'EnergyPipelines',   table: 'gas_pipelines',     recencyColumn: 'ingested_at', countryColumn: 'country' },
  { bucket: 'Mining',            table: 'mines',             recencyColumn: 'ingested_at', countryColumn: 'country' },
  { bucket: 'AviationInfra',     table: 'airports',          recencyColumn: 'ingested_at', countryColumn: 'iso_country' },
  { bucket: 'MaritimeInfra',     table: 'ports',             recencyColumn: 'ingested_at', countryColumn: 'country' },
  { bucket: 'AnomalyFlags',      table: 'anomaly_flags',     recencyColumn: 'created_at' },
  { bucket: 'ConvergenceEvents', table: 'convergence_events',recencyColumn: 'created_at',  countryColumn: 'location' },
  // Weather has no persistent table — intentionally excluded so the
  // aggregate evaluator rejects 'Weather' as a bucket choice.
];

const BUCKET_TABLE_BY_BUCKET: ReadonlyMap<DataBucket, BucketTableSpec> = new Map(
  BUCKET_TABLES.map(b => [b.bucket, b]),
);

export function getBucketTable(bucket: DataBucket): BucketTableSpec | undefined {
  return BUCKET_TABLE_BY_BUCKET.get(bucket);
}

export function isAggregatableBucket(bucket: unknown): bucket is DataBucket {
  return typeof bucket === 'string' && BUCKET_TABLE_BY_BUCKET.has(bucket as DataBucket);
}

// ─── Aggregate rule type (PR 5) ──────────────────────────────────
// Brief §5.1. Subset implemented in PR 5; sum/avg + sigma_above_baseline
// are rejected by the API validator with a not_yet_supported error and
// will be wired in a future PR on top of migration 041's CHECK extension.

export const AGGREGATE_METRICS_SUPPORTED = ['count_total', 'count_distinct'] as const;
export type AggregateMetricSupported = (typeof AGGREGATE_METRICS_SUPPORTED)[number];
export const AGGREGATE_METRICS_DEFERRED = ['sum', 'avg'] as const;
export type AggregateMetricDeferred = (typeof AGGREGATE_METRICS_DEFERRED)[number];
export type AggregateMetric = AggregateMetricSupported | AggregateMetricDeferred;

export const AGGREGATE_THRESHOLD_KINDS_SUPPORTED = [
  'absolute_above',
  'absolute_below',
  'pct_change_vs_prev_window',
] as const;
export type AggregateThresholdKindSupported = (typeof AGGREGATE_THRESHOLD_KINDS_SUPPORTED)[number];
export const AGGREGATE_THRESHOLD_KINDS_DEFERRED = ['sigma_above_baseline'] as const;
export type AggregateThresholdKindDeferred = (typeof AGGREGATE_THRESHOLD_KINDS_DEFERRED)[number];
export type AggregateThresholdKind =
  | AggregateThresholdKindSupported
  | AggregateThresholdKindDeferred;

/**
 * Free-form filter object on aggregate rules. PR 5 honours only
 * `country` (matching PR 2's country filter behaviour). Other keys
 * are accepted for forward compatibility but unused.
 */
export interface AggregateFilter {
  country?: string;
  /** Forward-compat. Ignored by the PR 5 evaluator. */
  event_type?: string;
  vessel_class?: string;
  commodity?: string;
  min_fatalities?: number;
  min_capacity_mw?: number;
  min_capacity_bpd?: number;
}

export interface AggregateConfig {
  bucket: DataBucket;
  filter?: AggregateFilter;
  metric: AggregateMetric;
  /** Required when metric='count_distinct'. */
  distinct_on?: string;
  /** Required when metric='sum' or 'avg' (deferred). */
  metric_field?: string;
  /** Evaluation window in hours. 1 ≤ N ≤ AGGREGATE_WINDOW_HOURS_MAX. */
  window_hours: number;
  threshold_kind: AggregateThresholdKind;
  /** Interpretation depends on threshold_kind. Always > 0. */
  threshold_value: number;
  /** Defaults to window_hours when omitted. Reserved for sigma_above_baseline. */
  baseline_window_hours?: number;
}

export const AGGREGATE_WINDOW_HOURS_MIN = 1;
export const AGGREGATE_WINDOW_HOURS_MAX = 720; // 30 days; bounds the cron query.
/** Max rows fetched per pass when metric='count_distinct'. Sanity cap. */
export const AGGREGATE_DISTINCT_ROW_CAP = 5000;
/** Max length of distinct_on / metric_field strings (column identifiers). */
export const AGGREGATE_COLUMN_NAME_MAX_CHARS = 48;

export function isAggregateMetricSupported(v: unknown): v is AggregateMetricSupported {
  return typeof v === 'string' && (AGGREGATE_METRICS_SUPPORTED as readonly string[]).includes(v);
}

export function isAggregateMetricDeferred(v: unknown): v is AggregateMetricDeferred {
  return typeof v === 'string' && (AGGREGATE_METRICS_DEFERRED as readonly string[]).includes(v);
}

export function isAggregateThresholdKindSupported(
  v: unknown,
): v is AggregateThresholdKindSupported {
  return (
    typeof v === 'string' &&
    (AGGREGATE_THRESHOLD_KINDS_SUPPORTED as readonly string[]).includes(v)
  );
}

export function isAggregateThresholdKindDeferred(
  v: unknown,
): v is AggregateThresholdKindDeferred {
  return (
    typeof v === 'string' &&
    (AGGREGATE_THRESHOLD_KINDS_DEFERRED as readonly string[]).includes(v)
  );
}

// Brief §10 caps. K=50 events / 8,000 input tokens per evaluation.
export const AI_K_EVENTS_DEFAULT = 50;
export const AI_K_EVENTS_MAX = 50;
export const AI_INPUT_TOKEN_BUDGET = 8000;
export const CROSS_DATA_AI_MIN_BUCKETS = 2;

export const OUTCOME_STATEMENT_MAX_CHARS = 600;
export const OUTCOME_STATEMENT_MIN_CHARS = 12;

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
 * Auto-generate a name for an AI rule from its outcome statement.
 * Truncates to 120 chars; same shape used by both outcome_ai and
 * cross_data_ai.
 */
export function suggestAiRuleName(
  ruleType: 'outcome_ai' | 'cross_data_ai',
  outcomeStatement: string,
): string {
  const prefix = ruleType === 'cross_data_ai' ? 'Cross-data AI · ' : 'Outcome AI · ';
  const trimmed = outcomeStatement.trim().replace(/\s+/g, ' ');
  return `${prefix}${trimmed}`.slice(0, 120);
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
