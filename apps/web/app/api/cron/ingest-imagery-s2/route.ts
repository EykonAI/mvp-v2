import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { fetchCdseToken } from '@/lib/imagery/cdse';
import { S2_ENGINE_VERSION, S2_PARAMS, chipPath, fetchChip, observeAoi, type DueAoi } from '@/lib/imagery/s2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 300;

/**
 * Sentinel-2 observation engine · daily (Imagery Layer IMG-2, mig 184).
 *
 * Replaces ingest-sentinel-tiles (monthly, mines only, scene-level cloud
 * filter, NDVI MEAN, cloudy passes silently skipped). For each AOI that
 * imagery_s2_due() returns — today the mine AOIs, the only kind switched on —
 * it:
 *
 *   1. asks the Statistical API for every acquisition day in the AOI's
 *      window (last checked window minus 5 days, so late-publishing L2A
 *      products are re-read), measured over the AOI POLYGON;
 *   2. writes ONE ROW PER ACQUISITION through imagery_upsert_s2(): clear
 *      looks with their median NDVI, cloudy / partly-cloudy / partial-swath
 *      looks as VOID rows with no value;
 *   3. fetches a true-colour chip for the newest clear look only;
 *   4. logs the check (window, acquisitions, rows, PU estimate or error) in
 *      imagery_aoi_checks — "looked, nothing there" is on record.
 *
 * FAIL LOUD: a run in which every AOI errored returns 502. The response
 * echoes the engine version and every pinned threshold, so a stale deploy
 * is visible from outside (brief §3.1).
 *
 * Query params: ?limit=N (default 30, max 60) · ?min_age_hours=H (default 20).
 */

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 60;
const BUCKET = 'sentinel';

async function handle(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const params = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(parseInt(params.get('limit') || String(DEFAULT_LIMIT)) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const minAgeHours = Math.max(parseInt(params.get('min_age_hours') || '20') || 20, 1);
  const echo = { engine: S2_ENGINE_VERSION, params: S2_PARAMS, limit, min_age_hours: minAgeHours };

  const clientId = process.env.CDSE_CLIENT_ID;
  const clientSecret = process.env.CDSE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    // Not ok:true — an unconfigured imagery engine has written nothing, and
    // saying so loudly is the point (brief §0.2).
    return NextResponse.json(
      { ok: false, ...echo, error: 'CDSE_CLIENT_ID / CDSE_CLIENT_SECRET not set' },
      { status: 503 },
    );
  }

  const startedAt = Date.now();
  const runId = `s2-${new Date().toISOString()}`;
  const supabase = createServerSupabase();

  const { data: due, error: dueErr } = await supabase.rpc('imagery_s2_due', {
    p_limit: limit,
    p_min_age_hours: minAgeHours,
  });
  if (dueErr) {
    return NextResponse.json({ ok: false, ...echo, error: `imagery_s2_due: ${dueErr.message}` }, { status: 502 });
  }
  const aois = (due ?? []) as DueAoi[];

  let token: string;
  try {
    token = await fetchCdseToken(clientId, clientSecret);
  } catch (err) {
    return NextResponse.json({ ok: false, ...echo, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }

  const results: Array<Record<string, unknown>> = [];
  let aoisOk = 0;
  let rowsWritten = 0;
  let clearLooks = 0;
  let chips = 0;
  let puTotal = 0;
  const errors: string[] = [];

  for (const aoi of aois) {
    try {
      const { rows, puEstimate, daysReturned } = await observeAoi(token, aoi, runId);
      let pu = puEstimate;

      // Chip for the newest clear look only (1 Process call, ~1 PU).
      const clear = rows.filter(r => r.coverage_state === 'clear').sort((a, b) => b.acquired_at.localeCompare(a.acquired_at));
      if (clear.length > 0) {
        const newest = clear[0];
        const { png, pu: chipPu } = await fetchChip(token, aoi, newest.acquired_at);
        const path = chipPath(aoi.aoi_id, newest.acquired_at);
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, png, { contentType: 'image/png', upsert: true });
        if (upErr) throw new Error(`storage upload: ${upErr.message}`);
        newest.chip_path = path;
        pu += chipPu;
        chips += 1;
      }

      let written = 0;
      if (rows.length > 0) {
        const { data: up, error: upsertErr } = await supabase.rpc('imagery_upsert_s2', { p_rows: rows });
        if (upsertErr) throw new Error(`imagery_upsert_s2: ${upsertErr.message}`);
        written = Number((up as Array<{ written: number }> | null)?.[0]?.written ?? 0);
        if (written !== rows.length) throw new Error(`imagery_upsert_s2 wrote ${written} of ${rows.length} rows`);
      }

      const { error: checkErr } = await supabase.from('imagery_aoi_checks').insert({
        aoi_id: aoi.aoi_id,
        sensor: 's2_l2a',
        window_from: aoi.window_from,
        window_to: aoi.window_to,
        acquisitions_found: rows.length,
        rows_written: written,
        pu_estimate: Math.round(pu * 10000) / 10000,
      });
      if (checkErr) throw new Error(`imagery_aoi_checks: ${checkErr.message}`);

      aoisOk += 1;
      rowsWritten += written;
      clearLooks += clear.length;
      puTotal += pu;
      results.push({
        aoi_id: aoi.aoi_id,
        days_returned: daysReturned,
        looks: rows.length,
        clear: clear.length,
        states: rows.reduce<Record<string, number>>((acc, r) => ((acc[r.coverage_state] = (acc[r.coverage_state] ?? 0) + 1), acc), {}),
        chip: clear.length > 0,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${aoi.aoi_id}: ${message}`);
      // The failure is logged as a check too, so the AOI is retried and the
      // error is readable later without the Railway log.
      await supabase.from('imagery_aoi_checks').insert({
        aoi_id: aoi.aoi_id,
        sensor: 's2_l2a',
        window_from: aoi.window_from,
        window_to: aoi.window_to,
        error: message.slice(0, 500),
      });
    }
  }

  // Nothing due is a success; everything failing is not.
  const ok = aois.length === 0 || aoisOk > 0;
  return NextResponse.json(
    {
      ok,
      ...echo,
      run_id: runId,
      aois_due: aois.length,
      aois_ok: aoisOk,
      rows_written: rowsWritten,
      clear_looks: clearLooks,
      chips,
      pu_estimate: Math.round(puTotal * 10000) / 10000,
      pu_note: 'estimated from the documented PU definition; CDSE reports no metered figure per request',
      results,
      errors,
      elapsed_ms: Date.now() - startedAt,
    },
    { status: ok ? 200 : 502 },
  );
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
