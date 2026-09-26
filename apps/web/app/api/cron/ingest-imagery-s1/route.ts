import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { fetchCdseToken } from '@/lib/imagery/cdse';
import { S1_ENGINE_VERSION, S1_PARAMS, catalogPasses, readPass, type S1Row } from '@/lib/imagery/s1';
import type { DueAoi } from '@/lib/imagery/s2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 300;

/**
 * Sentinel-1 measurement study · daily (Imagery Layer IMG-3, mig 185).
 *
 * NO USER SURFACE. For each anchorage AOI with s1_grd switched on
 * (imagery_enable_s1_study — by hand, after three days of hourly AIS
 * counts), it lists the IW passes over the polygon with their exact sensing
 * times (Catalog API), reads each pass's bright-target area (Statistical
 * API), writes one row per pass through imagery_upsert_obs('s1_grd', …) and
 * logs the check. imagery_s1_study() pairs those rows with ais_aoi_counts
 * and decides admission; until a reading is admitted nothing reads it.
 *
 * Fails loud: 503 unconfigured, 502 when every AOI failed. Echoes the engine
 * version and every pinned parameter so a stale deploy is visible.
 */

const DEFAULT_LIMIT = 20;

async function handle(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const p = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(parseInt(p.get('limit') || String(DEFAULT_LIMIT)) || DEFAULT_LIMIT, 1), 40);
  const minAgeHours = Math.max(parseInt(p.get('min_age_hours') || '20') || 20, 1);
  const echo = { engine: S1_ENGINE_VERSION, params: S1_PARAMS, limit, min_age_hours: minAgeHours, surface: 'none — study only' };

  const clientId = process.env.CDSE_CLIENT_ID;
  const clientSecret = process.env.CDSE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ ok: false, ...echo, error: 'CDSE_CLIENT_ID / CDSE_CLIENT_SECRET not set' }, { status: 503 });
  }

  const startedAt = Date.now();
  const runId = `s1-${new Date().toISOString()}`;
  const supabase = createServerSupabase();

  const { data: due, error: dueErr } = await supabase.rpc('imagery_sensor_due', {
    p_sensor: 's1_grd',
    p_limit: limit,
    p_min_age_hours: minAgeHours,
  });
  if (dueErr) return NextResponse.json({ ok: false, ...echo, error: `imagery_sensor_due: ${dueErr.message}` }, { status: 502 });
  const aois = (due ?? []) as DueAoi[];

  let token: string;
  try {
    token = await fetchCdseToken(clientId, clientSecret);
  } catch (err) {
    return NextResponse.json({ ok: false, ...echo, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }

  const results: Array<Record<string, unknown>> = [];
  const errors: string[] = [];
  let aoisOk = 0;
  let rowsWritten = 0;
  let puTotal = 0;

  for (const aoi of aois) {
    try {
      const { passes, pu: catalogPu } = await catalogPasses(token, aoi);
      let pu = catalogPu;
      const rows: S1Row[] = [];
      for (const t of passes) {
        const row = await readPass(token, aoi, t, runId);
        if (row) {
          rows.push(row);
          pu += row.pu_cost;
        }
      }
      let written = 0;
      if (rows.length > 0) {
        const { data: up, error: upErr } = await supabase.rpc('imagery_upsert_obs', { p_sensor: 's1_grd', p_rows: rows });
        if (upErr) throw new Error(`imagery_upsert_obs: ${upErr.message}`);
        written = Number((up as Array<{ written: number }> | null)?.[0]?.written ?? 0);
        if (written !== rows.length) throw new Error(`imagery_upsert_obs wrote ${written} of ${rows.length} rows`);
      }
      const { error: checkErr } = await supabase.from('imagery_aoi_checks').insert({
        aoi_id: aoi.aoi_id,
        sensor: 's1_grd',
        window_from: aoi.window_from,
        window_to: aoi.window_to,
        acquisitions_found: rows.length,
        rows_written: written,
        pu_estimate: Math.round(pu * 10000) / 10000,
      });
      if (checkErr) throw new Error(`imagery_aoi_checks: ${checkErr.message}`);
      aoisOk += 1;
      rowsWritten += written;
      puTotal += pu;
      results.push({
        aoi_id: aoi.aoi_id,
        passes_listed: passes.length,
        looks: rows.length,
        clear: rows.filter(r => r.coverage_state === 'clear').length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${aoi.aoi_id}: ${message}`);
      await supabase.from('imagery_aoi_checks').insert({
        aoi_id: aoi.aoi_id,
        sensor: 's1_grd',
        window_from: aoi.window_from,
        window_to: aoi.window_to,
        error: message.slice(0, 500),
      });
    }
  }

  const ok = aois.length === 0 || aoisOk > 0;
  return NextResponse.json(
    {
      ok,
      ...echo,
      run_id: runId,
      aois_due: aois.length,
      aois_ok: aoisOk,
      rows_written: rowsWritten,
      pu_estimate: Math.round(puTotal * 10000) / 10000,
      pu_note: 'estimated from the documented PU definition (orthorectification factor assumed); CDSE reports no metered figure per request',
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
