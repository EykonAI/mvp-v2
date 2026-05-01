// ─── Query History relevance ranker ─────────────────────────────
// Ranks user_queries rows for the §3.2 "most relevant" history list.
// Weights are tunable without redeploying — the brief asks for them
// to live as a constants block (§3.2 "expose the weights as a
// constants block").

export const RELEVANCE_WEIGHTS = {
  recency: 0.5,
  engagement: 0.3,
  specificity: 0.2,
} as const;

export const RECENCY_HALF_LIFE_DAYS = 7;

// Cap on tool-iterations per chat request (matches /api/chat). Used
// to normalise the specificity score into [0, 1].
const MAX_PRODUCTIVE_TOOL_CALLS = 5;

export interface UserQueryRow {
  id: string;
  query_text: string;
  response_text: string;
  tool_calls: ToolCallSummary[] | null;
  domain_tags: string[] | null;
  created_at: string;
  last_run_at: string;
  run_count: number;
  exported_at: string | null;
  starred: boolean;
}

export interface ToolCallSummary {
  name: string;
  input: Record<string, any>;
  row_count: number | null;
}

/**
 * Exponential decay on age in days. Half-life of 7 days per §3.2:
 *   ageDays =  0  → 1.00
 *   ageDays =  7  → 0.50
 *   ageDays = 14  → 0.25
 *   ageDays = 30  → 0.05
 */
export function recencyScore(lastRunAtIso: string, nowMs: number = Date.now()): number {
  const ageDays = (nowMs - new Date(lastRunAtIso).getTime()) / 86_400_000;
  if (!Number.isFinite(ageDays) || ageDays < 0) return 1;
  return Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
}

/**
 * Engagement is the mean of three binary signals from §3.2:
 *   - exported_at IS NOT NULL  (PDF export)
 *   - run_count > 1             (the user re-ran this query)
 *   - starred                   (the user pinned it, §4.1)
 */
export function engagementScore(row: UserQueryRow): number {
  let n = 0;
  if (row.exported_at) n += 1;
  if (row.run_count > 1) n += 1;
  if (row.starred) n += 1;
  return n / 3;
}

/**
 * Specificity = number of tool calls that returned ≥1 row, normalised
 * by the per-request iteration cap. Penalises empty-result queries.
 */
export function specificityScore(row: UserQueryRow): number {
  const calls = row.tool_calls ?? [];
  let productive = 0;
  for (const c of calls) {
    if ((c.row_count ?? 0) > 0) productive += 1;
  }
  return Math.min(productive / MAX_PRODUCTIVE_TOOL_CALLS, 1);
}

/**
 * Composite relevance score in [0, 1]. Higher = more relevant.
 */
export function relevanceScore(row: UserQueryRow, nowMs: number = Date.now()): number {
  return (
    RELEVANCE_WEIGHTS.recency * recencyScore(row.last_run_at, nowMs) +
    RELEVANCE_WEIGHTS.engagement * engagementScore(row) +
    RELEVANCE_WEIGHTS.specificity * specificityScore(row)
  );
}

/**
 * Sort a list of rows by:
 *   1. starred=true first  (pin to top, §4.1)
 *   2. relevanceScore desc within each starred bucket
 *
 * Returns a new array; does not mutate the input.
 */
export function rankByRelevance(rows: UserQueryRow[], nowMs: number = Date.now()): UserQueryRow[] {
  return rows
    .map(r => ({ row: r, score: relevanceScore(r, nowMs) }))
    .sort((a, b) => {
      if (a.row.starred !== b.row.starred) return a.row.starred ? -1 : 1;
      return b.score - a.score;
    })
    .map(s => s.row);
}
