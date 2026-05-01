// ─── Intelligence Analyst — query history persistence ───────────
// Writes one row to user_queries per chat submission. Backs the
// Query History tab (§3.2) and the Personalised Suggested tab (§3.3).
//
// Domain-tag inference is the §4.3 "auto-domain tags" backend: light
// keyword extraction at write-time, no per-write LLM call.

import { createServerSupabase } from '@/lib/supabase-server';
import { extractRegionsFromText, findRegionByIso2 } from '@/lib/geography/countries';

// Map each Claude tool to the §3.3 ten-bucket taxonomy. Intel-Center
// tools (not in the §3.3 list) get the "Intelligence" tag plus any
// secondary bucket they straddle (e.g. shadow-fleet leads → Maritime).
const TOOL_BUCKETS: Record<string, readonly string[]> = {
  // Core live-data — these ten map 1:1 to the §3.3 cross-data buckets.
  query_aircraft:     ['Air'],
  query_vessels:      ['Maritime'],
  query_conflicts:    ['Conflict'],
  query_power_plants: ['Energy'],
  query_pipelines:    ['Energy'],
  query_refineries:   ['Energy'],
  query_mines:        ['Mining'],
  query_airports:     ['Aviation'],
  query_ports:        ['Maritime'],
  query_weather:      ['Weather'],
  // Intelligence Center — tagged separately; not part of cross-data tally.
  query_agent_reports:      ['Intelligence'],
  query_posture_scores:     ['Intelligence'],
  query_convergences:       ['Intelligence'],
  query_shadow_fleet_leads: ['Maritime', 'Intelligence'],
  query_calibration:        ['Intelligence'],
  query_precursor_matches:  ['Intelligence'],
  run_chokepoint_scenario:  ['Maritime', 'Energy'],
  run_sanctions_wargame:    ['Maritime'],
  query_regime_shifts:      ['Intelligence'],
  query_entities:           ['Intelligence'],
  expand_actor_network:     ['Intelligence'],
};

export interface ToolCallRecord {
  name: string;
  input: Record<string, any>;
  row_count: number | null;
}

export interface PersistOptions {
  userId: string;
  queryText: string;
  responseText: string;
  toolCalls: ToolCallRecord[];
}

/**
 * Pulls a row count out of a tool result string. Every tool in
 * tool-executor.ts returns JSON-stringified objects with a top-level
 * `count` field, so the parse is cheap and reliable.
 */
export function rowCountFromToolResult(result: string): number | null {
  try {
    const parsed = JSON.parse(result);
    if (typeof parsed?.count === 'number') return parsed.count;
    return null;
  } catch {
    return null;
  }
}

/**
 * Build the domain_tags array from (a) tool buckets, (b) ISO codes
 * carried in tool inputs, (c) keyword match against the query text.
 * Order is not significant — the field is treated as a set downstream.
 */
export function inferDomainTags(queryText: string, toolCalls: ToolCallRecord[]): string[] {
  const tags = new Set<string>();

  // (a) Bucket tags from each tool name.
  for (const tc of toolCalls) {
    for (const b of TOOL_BUCKETS[tc.name] ?? []) tags.add(b);
  }

  // (b) Country tags from tool inputs. Tools accept either an ISO-2
  //     country code (`country: 'SA'`, `iso_country: 'IR'`) or a free
  //     string. ISO-2 wins because it's canonical; otherwise we fall
  //     back to the text path.
  for (const tc of toolCalls) {
    const candidate = tc.input?.country ?? tc.input?.iso_country;
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (trimmed.length === 2) {
      const region = findRegionByIso2(trimmed);
      if (region) tags.add(region.name);
    }
  }

  // (c) Region tags from the user's query text.
  for (const region of extractRegionsFromText(queryText)) {
    tags.add(region);
  }

  return Array.from(tags);
}

/**
 * Insert one row into user_queries. Failures are logged and swallowed —
 * persistence must never break the chat response. The caller is
 * responsible for skipping when `userId` is absent (auth-disabled
 * fallback path); this helper double-checks belt-and-braces.
 */
export async function persistUserQuery(opts: PersistOptions): Promise<void> {
  if (!opts.userId) return;

  const supabase = createServerSupabase();
  const domain_tags = inferDomainTags(opts.queryText, opts.toolCalls);

  const tool_calls = opts.toolCalls.map(tc => ({
    name: tc.name,
    input: tc.input,
    row_count: tc.row_count,
  }));

  const { error } = await supabase.from('user_queries').insert({
    user_id: opts.userId,
    query_text: opts.queryText,
    response_text: opts.responseText,
    tool_calls,
    domain_tags,
  });

  if (error) {
    console.error('[user_queries] insert failed:', error.message);
  }
}
