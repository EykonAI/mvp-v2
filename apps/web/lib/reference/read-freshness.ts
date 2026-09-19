// ─── Reference-snapshot freshness: server reader ───
//
// Reads public.reference_snapshot_freshness (migration 167) with the service
// role. Two readers:
//
//   readReferenceSnapshot(table) — one row, filtered on table_name. Every
//     branch of the view carries a constant table_name, so the other seven
//     tables are pruned at plan time (~90 ms for power_plants, exact count).
//     Cached in-process for ten minutes: /api/power-plants is called on every
//     map pan, and a registry loaded once in April does not change between
//     pans. Failures are NOT cached, and never throw — a failed read returns
//     an 'unknown' snapshot so the surface says "age unknown" instead of
//     going quiet (silence must never read as health).
//
//   readAllReferenceSnapshots() — every row, for the founder's ingest-health
//     page (~1.4 s cold; uncached, page-only).

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  REFERENCE_SNAPSHOT_COLUMNS,
  unknownSnapshot,
  type ReferenceSnapshot,
  type ReferenceTable,
} from './freshness';

const VIEW = 'reference_snapshot_freshness';
const TTL_MS = 10 * 60 * 1000;

const cache = new Map<ReferenceTable, { at: number; value: ReferenceSnapshot }>();

function normalise(row: Record<string, unknown>): ReferenceSnapshot {
  const num = (v: unknown): number | null =>
    v === null || v === undefined || v === '' || !isFinite(Number(v)) ? null : Number(v);
  return {
    table_name: row.table_name as ReferenceTable,
    source: String(row.source ?? ''),
    row_count: num(row.row_count),
    loaded_at: (row.loaded_at as string | null) ?? null,
    oldest_row_at: (row.oldest_row_at as string | null) ?? null,
    age_days: num(row.age_days),
    expected_refresh_days: num(row.expected_refresh_days),
    refresh_reason: String(row.refresh_reason ?? ''),
    freshness_state: (row.freshness_state as ReferenceSnapshot['freshness_state']) ?? 'unknown',
    is_stale: row.is_stale === true,
    stale_after: (row.stale_after as string | null) ?? null,
    reload_via: String(row.reload_via ?? ''),
  };
}

export async function readReferenceSnapshot(
  supabase: SupabaseClient,
  table: ReferenceTable,
): Promise<ReferenceSnapshot> {
  const hit = cache.get(table);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  try {
    const { data, error } = await supabase
      .from(VIEW)
      .select(REFERENCE_SNAPSHOT_COLUMNS)
      .eq('table_name', table)
      .maybeSingle();
    if (error || !data) {
      if (error) console.error(`[reference-freshness] ${table}: ${error.message}`);
      return unknownSnapshot(table);
    }
    const value = normalise(data as unknown as Record<string, unknown>);
    cache.set(table, { at: Date.now(), value });
    return value;
  } catch (err: any) {
    console.error(`[reference-freshness] ${table}: ${err?.message ?? err}`);
    return unknownSnapshot(table);
  }
}

export async function readAllReferenceSnapshots(
  supabase: SupabaseClient,
): Promise<{ rows: ReferenceSnapshot[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from(VIEW)
      .select(REFERENCE_SNAPSHOT_COLUMNS)
      .order('table_name', { ascending: true });
    if (error) return { rows: [], error: `reference_snapshot_freshness: ${error.message}` };
    return {
      rows: ((data ?? []) as unknown as Record<string, unknown>[]).map(normalise),
      error: null,
    };
  } catch (err: any) {
    return { rows: [], error: `reference_snapshot_freshness: ${err?.message ?? err}` };
  }
}
