import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { parseSdnCsv, type SdnRow } from '@/lib/ofac/sdn-parser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const SDN_CSV_URL = 'https://www.treasury.gov/ofac/downloads/sdn.csv';
const USER_AGENT = 'eykon.ai/calibration-ledger (+https://eykon.ai)';
const FETCH_PAGE = 1000;
const WRITE_CHUNK = 500;

interface ExistingRow {
  ent_num: number;
  sdn_name: string;
  programs: string[] | null;
  removed_at: string | null;
}

/**
 * OFAC SDN ingest · daily.
 *
 * Fetches Treasury's public SDN.CSV, parses, compares against the
 * current `ofac_designations` snapshot, and writes only the diff:
 *
 *   • additions     — ent_num absent in DB → INSERT
 *   • reactivations — ent_num present but removed_at IS NOT NULL → clear removed_at, refresh fields
 *   • updates       — ent_num present + active, content differs → refresh fields
 *   • removals      — ent_num active in DB but absent in CSV → set removed_at = NOW()
 *
 * Unchanged rows are skipped entirely. A clean replay against an
 * unchanged SDN is a no-op (zero writes).
 *
 * Auth: Bearer <CRON_SECRET>. Recommended Railway schedule: daily,
 * ideally 02:00 UTC (Treasury updates throughout the US business day;
 * an early-AM UTC fire catches the previous day's designations).
 */
async function handle(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const startedAt = Date.now();
  const supabase = createServerSupabase();
  const now = new Date().toISOString();

  let csv: string;
  try {
    const res = await fetch(SDN_CSV_URL, {
      cache: 'no-store',
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/csv,*/*' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    csv = await res.text();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        stage: 'fetch',
        error: err instanceof Error ? err.message : String(err),
        elapsed_ms: Date.now() - startedAt,
      },
      { status: 502 },
    );
  }

  const rows = parseSdnCsv(csv);
  if (rows.length === 0) {
    return NextResponse.json(
      { ok: false, stage: 'parse', error: 'SDN CSV produced 0 rows', elapsed_ms: Date.now() - startedAt },
      { status: 502 },
    );
  }

  let existing: ExistingRow[];
  try {
    existing = await fetchAllDesignations(supabase);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        stage: 'snapshot',
        error: err instanceof Error ? err.message : String(err),
        elapsed_ms: Date.now() - startedAt,
      },
      { status: 500 },
    );
  }

  const existingByEnt = new Map<number, ExistingRow>();
  for (const r of existing) existingByEnt.set(r.ent_num, r);
  const csvEntSet = new Set<number>();

  const additions: SdnRow[] = [];
  const refreshes: Array<SdnRow & { removed_at: null }> = []; // reactivations + content updates
  const removals: number[] = [];

  for (const r of rows) {
    csvEntSet.add(r.ent_num);
    const ex = existingByEnt.get(r.ent_num);
    if (!ex) {
      additions.push(r);
    } else if (ex.removed_at != null) {
      refreshes.push({ ...r, removed_at: null });
    } else if (ex.sdn_name !== r.sdn_name || !arraysEqualUnordered(ex.programs ?? [], r.programs)) {
      refreshes.push({ ...r, removed_at: null });
    }
  }

  for (const [entNum, ex] of existingByEnt) {
    if (ex.removed_at == null && !csvEntSet.has(entNum)) {
      removals.push(entNum);
    }
  }

  const errors: Array<{ stage: string; error: string }> = [];

  if (additions.length > 0) {
    for (const chunk of chunked(additions, WRITE_CHUNK)) {
      const { error } = await supabase.from('ofac_designations').insert(chunk);
      if (error) errors.push({ stage: 'insert_additions', error: error.message });
    }
  }

  if (refreshes.length > 0) {
    for (const chunk of chunked(refreshes, WRITE_CHUNK)) {
      const { error } = await supabase
        .from('ofac_designations')
        .upsert(chunk, { onConflict: 'ent_num' });
      if (error) errors.push({ stage: 'upsert_refreshes', error: error.message });
    }
  }

  if (removals.length > 0) {
    for (const chunk of chunked(removals, WRITE_CHUNK)) {
      const { error } = await supabase
        .from('ofac_designations')
        .update({ removed_at: now })
        .in('ent_num', chunk);
      if (error) errors.push({ stage: 'mark_removed', error: error.message });
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    fetched: rows.length,
    additions: additions.length,
    refreshes: refreshes.length,
    removed: removals.length,
    errors,
    elapsed_ms: Date.now() - startedAt,
  });
}

async function fetchAllDesignations(
  supabase: ReturnType<typeof createServerSupabase>,
): Promise<ExistingRow[]> {
  const out: ExistingRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('ofac_designations')
      .select('ent_num, sdn_name, programs, removed_at')
      .order('ent_num', { ascending: true })
      .range(from, from + FETCH_PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as ExistingRow[];
    out.push(...batch);
    if (batch.length < FETCH_PAGE) break;
    from += FETCH_PAGE;
  }
  return out;
}

function arraysEqualUnordered(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
  return true;
}

function* chunked<T>(arr: T[], size: number): Generator<T[], void, unknown> {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
