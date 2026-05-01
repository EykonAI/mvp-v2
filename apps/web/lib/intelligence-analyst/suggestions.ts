// ─── Personalised Suggested-tab generator (§3.3) ─────────────────
// Builds up to 8 suggestions per the brief's algorithm:
//   3 history-inferred  · ≥2 cross-data
//   2 trending          · ≥1 cross-data
//   2 anomaly-driven    · cross-data by construction
//   1 always-on meta    · cross-data by definition
// Hard floor: ≥4 of 8 surfaced suggestions must be cross-data.
//
// Cold start (<3 historic queries) returns the curated static list,
// which itself satisfies the ≥half cross-data rule (§3.3 last para).

import type { UserQueryRow } from './relevance';

// ── Cross-data taxonomy (the §3.3 ten-bucket list) ─────────────
// One bucket per row in the brief — the keys for cross-data tally.
export const CROSS_DATA_BUCKETS = [
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
] as const;
export type CrossDataBucket = (typeof CROSS_DATA_BUCKETS)[number];

// Each Claude tool maps to exactly one cross-data bucket. This is
// finer-grained than the user-facing TOOL_BUCKETS in persistence.ts —
// the latter tags rows for display ("Energy"); this one classifies
// suggestions ("EnergyRefineries") for the cross-data tally.
export const BUCKET_FROM_TOOL: Record<string, CrossDataBucket | undefined> = {
  query_aircraft:     'Air',
  query_vessels:      'Maritime',
  query_conflicts:    'Conflict',
  query_power_plants: 'EnergyPower',
  query_pipelines:    'EnergyPipelines',
  query_refineries:   'EnergyRefineries',
  query_mines:        'Mining',
  query_airports:     'AviationInfra',
  query_ports:        'MaritimeInfra',
  query_weather:      'Weather',
};

// Coarse user-facing bucket — what we *display* on a row when the
// fine-grained label is overkill. Used to translate user_queries
// domain_tags (which carry "Energy", "Maritime", etc.) back into
// the §3.3 ten-bucket space.
const COARSE_TO_FINE: Record<string, readonly CrossDataBucket[]> = {
  Energy:   ['EnergyPower', 'EnergyPipelines', 'EnergyRefineries'],
  Maritime: ['Maritime', 'MaritimeInfra'],
  Aviation: ['AviationInfra'],
  Air:      ['Air'],
  Conflict: ['Conflict'],
  Mining:   ['Mining'],
  Weather:  ['Weather'],
};

// Adjacency graph: which buckets pair productively? Used by the
// history-inferred slot to pick "adjacent" buckets the user hasn't
// queried yet (purposeful cross-pollination, not echo).
const ADJACENT: Record<CrossDataBucket, readonly CrossDataBucket[]> = {
  Air:              ['EnergyPower', 'Conflict', 'AviationInfra'],
  Maritime:         ['EnergyRefineries', 'Conflict', 'MaritimeInfra', 'Weather'],
  Conflict:         ['EnergyRefineries', 'EnergyPipelines', 'Mining', 'Maritime'],
  EnergyPower:      ['Weather', 'Conflict', 'Air'],
  EnergyPipelines:  ['Conflict', 'Mining'],
  EnergyRefineries: ['Maritime', 'Conflict'],
  Mining:           ['Conflict', 'EnergyPipelines'],
  AviationInfra:    ['Air', 'Conflict'],
  MaritimeInfra:    ['Maritime', 'EnergyRefineries'],
  Weather:          ['EnergyPower', 'Maritime'],
};

// ── Suggestion shape exposed to the UI ─────────────────────────
export type SuggestionSlot = 'history' | 'trending' | 'anomaly' | 'meta' | 'cold-start';

export interface Suggestion {
  text: string;
  buckets: readonly CrossDataBucket[];
  slot: SuggestionSlot;
}

export function isCrossData(s: Suggestion): boolean {
  return s.buckets.length >= 2;
}

// ── Template library ────────────────────────────────────────────
// Curated bank of suggestions, each tagged with its cross-data
// bucket pair. The algorithm picks from here for the history,
// trending, and cold-start slots. Region hints let us prefer
// templates that overlap with the user's revealed regions.

interface Template {
  text: string;
  buckets: readonly CrossDataBucket[];
  region_hint?: string;
}

const TEMPLATES: readonly Template[] = [
  // ── Cross-data (energy ↔ everything) ──
  { text: 'Tanker traffic near Saudi refinery export terminals in the last 7 days', buckets: ['EnergyRefineries', 'Maritime'], region_hint: 'Saudi Arabia' },
  { text: 'LNG carriers loading at Qatar export terminals', buckets: ['EnergyPipelines', 'Maritime'], region_hint: 'Qatar' },
  { text: 'Refineries within 200 km of conflict events in the last 30 days', buckets: ['EnergyRefineries', 'Conflict'] },
  { text: 'Operating gas pipelines crossing into countries with active armed conflict', buckets: ['EnergyPipelines', 'Conflict'] },
  { text: 'Power plants offline in regions under storm warnings', buckets: ['EnergyPower', 'Weather'] },
  { text: 'Aircraft activity near critical energy infrastructure', buckets: ['Air', 'EnergyPower'] },
  // ── Cross-data (mining ↔ conflict / maritime) ──
  { text: 'Lithium mines along contested border regions', buckets: ['Mining', 'Conflict'] },
  { text: 'Cobalt mines in DRC near recent conflict events', buckets: ['Mining', 'Conflict'], region_hint: 'Democratic Republic of the Congo' },
  { text: 'Copper mines and the ports they ship through in Chile', buckets: ['Mining', 'MaritimeInfra'], region_hint: 'Chile' },
  // ── Cross-data (maritime ↔ conflict / weather) ──
  { text: 'Vessels transiting Bab-el-Mandeb under conflict-risk advisories', buckets: ['Maritime', 'Conflict'], region_hint: 'Bab-el-Mandeb' },
  { text: 'Ports in storm-warning zones along the US Gulf Coast', buckets: ['MaritimeInfra', 'Weather'], region_hint: 'Gulf of Mexico' },
  // ── Cross-data (aviation ↔ conflict) ──
  { text: 'Airports within 100 km of recent conflict events', buckets: ['AviationInfra', 'Conflict'] },
  // ── Single-data starters ──
  { text: 'Operating refineries in Saudi Arabia with capacity > 200,000 bpd', buckets: ['EnergyRefineries'], region_hint: 'Saudi Arabia' },
  { text: 'Vessels currently transiting the Strait of Hormuz', buckets: ['Maritime'], region_hint: 'Strait of Hormuz' },
  { text: 'Conflict events in West Africa in the last 30 days', buckets: ['Conflict'] },
  { text: 'Lithium mines in Australia', buckets: ['Mining'], region_hint: 'Australia' },
  { text: 'Aircraft activity near Iranian airbases', buckets: ['Air'], region_hint: 'Iran' },
  { text: 'Top 3 shadow-fleet leads with AIS gaps over 12 hours', buckets: ['Maritime'] },
  { text: 'Operating coal-fired power plants in India', buckets: ['EnergyPower'], region_hint: 'India' },
];

// ── Cold-start curated list (8 prompts, ≥4 cross-data) ─────────
// Returned verbatim when the user has fewer than 3 historic queries.
// Hand-curated to satisfy the ≥half cross-data floor.
export const COLD_START_SUGGESTIONS: readonly Suggestion[] = [
  // 4 cross-data
  { text: 'Tanker traffic near Saudi refinery export terminals in the last 7 days', buckets: ['EnergyRefineries', 'Maritime'], slot: 'cold-start' },
  { text: 'Refineries within 200 km of conflict events in the last 30 days', buckets: ['EnergyRefineries', 'Conflict'], slot: 'cold-start' },
  { text: 'Power plants offline in regions under storm warnings', buckets: ['EnergyPower', 'Weather'], slot: 'cold-start' },
  { text: 'Lithium mines along contested border regions', buckets: ['Mining', 'Conflict'], slot: 'cold-start' },
  // 4 single-data
  { text: 'Operating refineries in Saudi Arabia with capacity > 200,000 bpd', buckets: ['EnergyRefineries'], slot: 'cold-start' },
  { text: 'Top 3 shadow-fleet leads with AIS gaps over 12 hours', buckets: ['Maritime'], slot: 'cold-start' },
  { text: 'Conflict events in West Africa in the last 30 days', buckets: ['Conflict'], slot: 'cold-start' },
  { text: 'Lithium mines in Australia', buckets: ['Mining'], slot: 'cold-start' },
];

// ── Algorithm ───────────────────────────────────────────────────

export interface BuildOptions {
  history: UserQueryRow[];
  // Pre-fetched anomaly suggestions from convergence_events for
  // the user's pinned theatres. Empty array = no theatres pinned
  // or convergences endpoint degraded; that slot is skipped.
  anomalySuggestions?: Suggestion[];
}

const COLD_START_THRESHOLD = 3;

export function buildSuggestions({ history, anomalySuggestions = [] }: BuildOptions): Suggestion[] {
  if (history.length < COLD_START_THRESHOLD) {
    return [...COLD_START_SUGGESTIONS];
  }

  const userBuckets = bucketsFromHistory(history);
  const userRegions = regionsFromHistory(history);
  const topBucket = userBuckets[0]?.bucket;
  const unusedBuckets = CROSS_DATA_BUCKETS.filter(
    b => !userBuckets.some(u => u.bucket === b),
  );

  const used: Set<string> = new Set();

  // Slot 1: 3 history-inferred. ≥2 cross-data, prefer (topBucket, unused) pairs.
  const historyInferred = pickTemplates({
    count: 3,
    requireBucket: topBucket,
    preferAdjacent: topBucket ? ADJACENT[topBucket] : undefined,
    preferUnused: unusedBuckets,
    preferRegions: userRegions,
    crossDataMin: 2,
    used,
  }).map(t => makeSuggestion(t, 'history'));
  for (const s of historyInferred) used.add(s.text);

  // Slot 2: 2 trending. ≥1 cross-data, same primary bucket.
  const trending = pickTemplates({
    count: 2,
    requireBucket: topBucket,
    preferRegions: userRegions,
    crossDataMin: 1,
    used,
  }).map(t => makeSuggestion(t, 'trending'));
  for (const s of trending) used.add(s.text);

  // Slot 3: 2 anomaly-driven. Caller pre-fetched these.
  const anomaly = anomalySuggestions.slice(0, 2);
  for (const s of anomaly) used.add(s.text);

  // Slot 4: 1 meta. Always present; cross-data by definition.
  const meta: Suggestion = {
    text: 'Show me anything new since I last logged in.',
    buckets: ['Air', 'Maritime', 'Conflict', 'EnergyPower'], // marker — the prompt spans every feed
    slot: 'meta',
  };

  return [...historyInferred, ...trending, ...anomaly, meta];
}

// ── Internals ───────────────────────────────────────────────────

interface PickOptions {
  count: number;
  requireBucket: CrossDataBucket | undefined;
  preferAdjacent?: readonly CrossDataBucket[];
  preferUnused?: readonly CrossDataBucket[];
  preferRegions?: readonly string[];
  crossDataMin: number;
  used: Set<string>;
}

function pickTemplates(opts: PickOptions): Template[] {
  const candidates = TEMPLATES.filter(t => !opts.used.has(t.text));
  // Score every candidate, then greedy-pick top N subject to the
  // cross-data minimum constraint.
  const scored = candidates.map(t => ({ t, score: scoreTemplate(t, opts) })).sort((a, b) => b.score - a.score);

  const picked: Template[] = [];
  let crossPicked = 0;
  for (const { t } of scored) {
    if (picked.length >= opts.count) break;
    picked.push(t);
    if (t.buckets.length >= 2) crossPicked += 1;
  }

  // If we under-shot the cross-data minimum, swap singles for crosses.
  if (crossPicked < opts.crossDataMin) {
    const remainingCross = scored
      .map(s => s.t)
      .filter(t => t.buckets.length >= 2 && !picked.includes(t));
    while (crossPicked < opts.crossDataMin && remainingCross.length > 0) {
      const next = remainingCross.shift()!;
      // Find a single-data slot to evict
      const singleIdx = picked.findIndex(t => t.buckets.length < 2);
      if (singleIdx === -1) break;
      picked[singleIdx] = next;
      crossPicked += 1;
    }
  }

  return picked.slice(0, opts.count);
}

function scoreTemplate(t: Template, opts: PickOptions): number {
  let s = 0;
  if (opts.requireBucket && t.buckets.includes(opts.requireBucket)) s += 3;
  if (opts.preferAdjacent && t.buckets.some(b => opts.preferAdjacent!.includes(b))) s += 2;
  if (opts.preferUnused && t.buckets.some(b => opts.preferUnused!.includes(b))) s += 2;
  if (t.buckets.length >= 2) s += 1; // mild cross-data bias
  if (
    t.region_hint &&
    opts.preferRegions &&
    opts.preferRegions.some(r => r.toLowerCase() === t.region_hint!.toLowerCase())
  ) {
    s += 2;
  }
  return s;
}

function makeSuggestion(t: Template, slot: SuggestionSlot): Suggestion {
  return { text: t.text, buckets: t.buckets, slot };
}

// Translate the user's coarse domain_tags ("Energy", "Saudi Arabia") into
// fine-grained bucket frequencies. Region tags pass through into the
// regions output. Returns buckets sorted by frequency desc.
function bucketsFromHistory(rows: UserQueryRow[]): { bucket: CrossDataBucket; n: number }[] {
  const counts = new Map<CrossDataBucket, number>();
  for (const row of rows) {
    // Prefer fine-grained: look at the actual tool calls if present.
    for (const tc of row.tool_calls ?? []) {
      const b = BUCKET_FROM_TOOL[tc.name];
      if (b) counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    // Fallback: project coarse tags onto fine buckets.
    for (const tag of row.domain_tags ?? []) {
      const fine = COARSE_TO_FINE[tag];
      if (!fine) continue;
      // Distribute the count evenly across the candidate fine buckets
      // (a row tagged "Energy" doesn't tell us which energy sub-bucket).
      const share = 1 / fine.length;
      for (const f of fine) counts.set(f, (counts.get(f) ?? 0) + share);
    }
  }
  return Array.from(counts.entries())
    .map(([bucket, n]) => ({ bucket, n }))
    .sort((a, b) => b.n - a.n);
}

function regionsFromHistory(rows: UserQueryRow[]): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const tag of row.domain_tags ?? []) {
      // Heuristic: tags that aren't a coarse bucket name are regions.
      if (!(tag in COARSE_TO_FINE)) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([region]) => region);
}
