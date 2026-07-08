import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { fetchComtradeAnnualExports } from '@/lib/comtrade/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Comtrade aggregate queries can take tens of seconds per code.
export const maxDuration = 300;

/**
 * UN Comtrade minerals ingest · monthly (P2b, INTEL P2 §3.5).
 *
 * Writes mineral_trade_flows (migration 079): annual export flows to
 * partner=World, one row per reporting country, for the critical-
 * minerals HS codes below. `mineral` maps each HS code to the Minerals/
 * Commodities workspace slug where one exists (cobalt, ree, copper —
 * consumed by the export-shares widget); nickel and graphite are stored
 * for the wider minerals picture. Lithium has no clean 4-digit HS code
 * (2530 is "mineral substances n.e.s.") and is deliberately absent —
 * never approximate.
 *
 * Period: latest full year (currentYear − 1), falling back one more
 * year per code when reporters haven't filed yet — annual Comtrade
 * data lags 6–18 months.
 *
 * Budget: one request per HS code per tick (2 worst-case with the
 * fallback), monthly — trivially inside the free tier's ~500 calls/day.
 *
 * Idempotency: ON CONFLICT (hs_code, reporter, partner, flow, period)
 * DO UPDATE. Per-code isolation: a failing code lands in errors[]
 * without blocking the others.
 *
 * Requires COMTRADE_API_KEY (free registration at comtradeplus.un.org);
 * returns {skipped} with 200 when unset so the cron never pages before
 * the key exists.
 */

const HS_CODES: ReadonlyArray<{ hs: string; mineral: string; label: string }> = [
  { hs: '2605', mineral: 'cobalt', label: 'Cobalt ores and concentrates' },
  { hs: '2604', mineral: 'nickel', label: 'Nickel ores and concentrates' },
  { hs: '2504', mineral: 'graphite', label: 'Natural graphite' },
  { hs: '2846', mineral: 'ree', label: 'Rare-earth compounds' },
  { hs: '2603', mineral: 'copper', label: 'Copper ores and concentrates' },
];

const SOURCE = 'un_comtrade';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function handle(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const apiKey = process.env.COMTRADE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: true, skipped: 'COMTRADE_API_KEY not set' });
  }

  const startedAt = Date.now();
  const supabase = createServerSupabase();
  const now = new Date().toISOString();
  const latestFullYear = new Date().getUTCFullYear() - 1;

  const errors: string[] = [];
  const perCode: Record<string, { period: string; reporters: number; upserted: number }> = {};
  let upsertedTotal = 0;

  for (let i = 0; i < HS_CODES.length; i++) {
    const { hs, mineral } = HS_CODES[i];
    if (i > 0) await sleep(1100); // stay polite on the free tier

    let flows: Awaited<ReturnType<typeof fetchComtradeAnnualExports>> = [];
    let year = latestFullYear;
    try {
      flows = await fetchComtradeAnnualExports({ apiKey, hsCode: hs, year });
      if (flows.length === 0) {
        // Annual filings lag — try the previous year before giving up.
        year -= 1;
        await sleep(1100);
        flows = await fetchComtradeAnnualExports({ apiKey, hsCode: hs, year });
      }
    } catch (err) {
      errors.push(`HS ${hs} fetch: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    if (flows.length === 0) {
      errors.push(`HS ${hs}: no reporters for ${latestFullYear} or ${year} — skipped, not fabricated`);
      continue;
    }

    const rows = flows.map((f) => ({
      hs_code: hs,
      mineral,
      reporter: f.reporter,
      partner: 'World',
      flow: 'export' as const,
      period: f.period,
      value_usd: f.value_usd,
      netweight_kg: f.netweight_kg,
      source: SOURCE,
      fetched_at: now,
    }));

    const { error, count } = await supabase
      .from('mineral_trade_flows')
      .upsert(rows, {
        onConflict: 'hs_code,reporter,partner,flow,period',
        count: 'exact',
      });

    if (error) {
      errors.push(`HS ${hs} upsert: ${error.message}`);
      continue;
    }

    const upserted = count ?? rows.length;
    perCode[hs] = { period: String(year), reporters: rows.length, upserted };
    upsertedTotal += upserted;
  }

  const allFailed = Object.keys(perCode).length === 0 && errors.length > 0;

  return NextResponse.json(
    {
      ok: !allFailed,
      upserted: upsertedTotal,
      per_code: perCode,
      errors,
      elapsed_ms: Date.now() - startedAt,
    },
    { status: allFailed ? 502 : 200 },
  );
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
