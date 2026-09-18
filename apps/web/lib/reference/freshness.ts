// ─── Reference-snapshot freshness: types + chip rule (client-safe) ───
//
// The static registries the product serves (power plants, pipelines,
// refineries, airports, ports, mines) were each loaded once, in late April /
// early May 2026, and nothing on any surface said so. power_plants in
// particular is two GEM releases behind while looking perfectly healthy.
//
// Migration 167 (reference_snapshot_freshness) states, per table, when it was
// loaded, how old it is and the refresh interval it is held to. This module
// is the one place that turns a row of that view into a chip decision, so
// the map panel, the map tooltip, the analyst tool and the admin page cannot
// disagree about what "stale" means.
//
// The rule is the view's, not ours: stale = older than the table's declared
// refresh contract (expected_refresh_days). A snapshot inside its interval
// renders NO chip. A snapshot whose age could not be read renders an
// "age unknown" chip — silence must never read as health.
//
// No server imports here: this file is imported by client components.

/** The states the view emits, plus 'unknown' when the read itself failed. */
export type FreshnessState = 'stale' | 'within_interval' | 'upstream_frozen' | 'empty' | 'unknown';

/** Tables the view covers (supabase/migrations/167_reference_snapshot_freshness.sql). */
export type ReferenceTable =
  | 'power_plants'
  | 'oil_pipelines'
  | 'gas_pipelines'
  | 'lng_terminals'
  | 'refineries'
  | 'airports'
  | 'ports'
  | 'mines';

/** One row of public.reference_snapshot_freshness, as the API forwards it. */
export interface ReferenceSnapshot {
  table_name: ReferenceTable;
  source: string;
  row_count: number | null;
  /** max(ingested_at) — the newest INSERT, not the last reload (mig 167 header). */
  loaded_at: string | null;
  oldest_row_at: string | null;
  age_days: number | null;
  expected_refresh_days: number | null;
  refresh_reason: string;
  freshness_state: FreshnessState;
  is_stale: boolean;
  stale_after: string | null;
  /** The ingest route or seed script that reloads it — "fix here". Stripped
   *  from public API responses (publicSnapshot). */
  reload_via?: string;
}

/** Column list for the view read — every column the type above names. */
export const REFERENCE_SNAPSHOT_COLUMNS =
  'table_name,source,row_count,loaded_at,oldest_row_at,age_days,expected_refresh_days,refresh_reason,freshness_state,is_stale,stale_after,reload_via';

/** Stand-in when the view could not be read (missing migration, DB error). */
export function unknownSnapshot(table: ReferenceTable, source = ''): ReferenceSnapshot {
  return {
    table_name: table,
    source,
    row_count: null,
    loaded_at: null,
    oldest_row_at: null,
    age_days: null,
    expected_refresh_days: null,
    refresh_reason: '',
    freshness_state: 'unknown',
    is_stale: false,
    stale_after: null,
    reload_via: '',
  };
}

/**
 * What a public API response may carry. reload_via names operator routes,
 * scripts and env vars — the founder's ingest-health page shows it; the
 * public layer routes do not.
 */
export function publicSnapshot(s: ReferenceSnapshot): Omit<ReferenceSnapshot, 'reload_via'> {
  const { reload_via: _omit, ...rest } = s;
  return rest;
}

const LABEL: Record<ReferenceTable, string> = {
  power_plants: 'Power-plant registry',
  oil_pipelines: 'Oil-pipeline registry',
  gas_pipelines: 'Gas-pipeline registry',
  lng_terminals: 'LNG-terminal registry',
  refineries: 'Refinery registry',
  airports: 'Airport registry',
  ports: 'Port registry',
  mines: 'Mine registry',
};

function day(iso: string | null): string {
  return iso ? iso.slice(0, 10) : 'an unknown date';
}

export interface SnapshotChip {
  /** ProvenanceChip state: 'stale' (amber) or 'cached' (neutral) for unknown. */
  state: 'stale' | 'cached';
  /** Visible label; ProvenanceChip appends the age. */
  label: string;
  /** Age in hours for ProvenanceChip's age formatter; undefined when unknown. */
  ageHours?: number;
  /** Screen-reader text; names the state in words. */
  sr: string;
  /** Tooltip sentence: what was loaded, when, and against which interval. */
  title: string;
}

/**
 * The chip rule. Returns null — render nothing — for a snapshot inside its
 * refresh interval, an upstream-frozen dataset (its age is not the defect),
 * or an empty table (the layer already shows no data). Renders for a stale
 * snapshot, and for one whose age could not be read.
 */
export function snapshotChip(s: ReferenceSnapshot | null | undefined): SnapshotChip | null {
  if (!s) return null;
  const what = LABEL[s.table_name] ?? 'Reference registry';
  if (s.freshness_state === 'unknown') {
    return {
      state: 'cached',
      label: 'Age unknown',
      sr: `${what}: load date could not be read`,
      title: `${what}: the load date could not be read, so its age is unknown. Treat it as possibly out of date.`,
    };
  }
  if (s.freshness_state !== 'stale' || !s.is_stale) return null;
  const ageDays = typeof s.age_days === 'number' && isFinite(s.age_days) ? s.age_days : null;
  const interval = s.expected_refresh_days;
  return {
    state: 'stale',
    label: 'Stale snapshot',
    ageHours: ageDays !== null ? ageDays * 24 : undefined,
    sr: `${what} is a stale snapshot${ageDays !== null ? `, loaded ${ageDays} days ago` : ''}`,
    title:
      `${what} loaded ${day(s.loaded_at)}` +
      (ageDays !== null ? ` — ${ageDays} days ago` : '') +
      (interval ? `, past its ${interval}-day refresh interval` : '') +
      (s.source ? ` (${s.source})` : '') +
      '. Anything built, retired or changed since then is not shown.',
  };
}

/**
 * The same decision as a sentence for a tool payload. Null when no chip
 * would render — a fresh snapshot adds no note.
 */
export function snapshotNote(s: ReferenceSnapshot | null | undefined): string | null {
  if (!s) return null;
  const what = LABEL[s.table_name] ?? 'Reference registry';
  if (s.freshness_state === 'unknown') {
    return `SNAPSHOT AGE UNKNOWN: the ${what.toLowerCase()}'s load date could not be read. Do not describe any row as current.`;
  }
  if (s.freshness_state !== 'stale' || !s.is_stale) return null;
  return (
    `STALE REFERENCE SNAPSHOT: the ${what.toLowerCase()} was loaded ${day(s.loaded_at)}` +
    (s.age_days !== null ? ` (${s.age_days} days ago)` : '') +
    (s.expected_refresh_days ? ` and is past its ${s.expected_refresh_days}-day refresh interval` : '') +
    '. Status, capacity and ownership are as the source recorded them at that load; anything built, retired or re-rated since is missing. ' +
    `Quote it as "as of the ${day(s.loaded_at)} load", never as current.`
  );
}
