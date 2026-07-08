import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { fetchImfPcpsMonthlyUsd } from '@/lib/imf/client';
import {
  EIA_BRENT_SPOT,
  EIA_WTI_SPOT,
  fetchEiaDailySpot,
} from '@/lib/eia/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Commodity price ingest · monthly (P2b, INTEL P2 §3.5).
 *
 * Writes commodity_prices (migration 079) keyed by
 * (commodity, period, source). Commodity keys are the Commodities
 * workspace slugs. Two source layers per tick:
 *
 *  1. 'imf_pcps_sdmx' — monthly IMF Primary Commodity Price System,
 *     DIRECT from the IMF SDMX API (free, keyless). One request per
 *     slug; last 24 monthly observations each. History: this layer
 *     first shipped on the DBnomics IMF mirror ('imf_pcps_dbnomics'),
 *     which turned out to be frozen at 2025-06 — the IMF had
 *     decommissioned the old CompactData API the mirror scraped. The
 *     direct SDMX feed is current (all 8 indicators verified through
 *     2026-05 on 2026-07-08); FRED was evaluated and rejected — it
 *     mirrors only 5 of our 8 slugs (no cobalt/lithium/REE). Old
 *     'imf_pcps_dbnomics' rows stay in the table; readers prefer the
 *     freshest period per slug, so they age out naturally.
 *
 *  2. 'eia_spot' — daily Brent (RBRTE) / WTI (RWTC) spot FOB from the
 *     EIA v2 API, last ~60 trading days each, so the UI gets daily
 *     energy prices alongside monthly metals. Skipped with an errors[]
 *     entry if EIA_API_KEY is unset — never fails the DBnomics layer.
 *
 * Idempotency: ON CONFLICT (commodity, period, source) DO UPDATE
 * refreshes price/unit/fetched_at. Sources fail independently; ok=false
 * only when nothing at all was upserted.
 */

// IMF PCPS monthly USD indicators → workspace slugs (series key
// G001.<INDICATOR>.USD.M — see lib/imf/client.ts). Units follow the
// IMF PCPS commodity definitions; ttf is proxied by the EU import price
// series and labelled as such.
const PCPS_SERIES: ReadonlyArray<{ slug: string; indicator: string; unit: string }> = [
  { slug: 'wheat', indicator: 'PWHEAMT', unit: 'USD/mt' },
  { slug: 'brent', indicator: 'POILBRE', unit: 'USD/bbl' },
  { slug: 'wti', indicator: 'POILWTI', unit: 'USD/bbl' },
  // IMF "Natural gas, EU" import price — a TTF proxy, not the exchange print.
  { slug: 'ttf', indicator: 'PNGASEU', unit: 'USD/mmbtu (EU import, TTF proxy)' },
  { slug: 'cobalt', indicator: 'PCOBA', unit: 'USD/mt' },
  { slug: 'lithium', indicator: 'PLITH', unit: 'USD/mt' },
  { slug: 'ree', indicator: 'PREODOM', unit: 'USD/mt (IMF REE basket)' },
  { slug: 'copper', indicator: 'PCOPP', unit: 'USD/mt' },
];

const PCPS_SOURCE = 'imf_pcps_sdmx';
const EIA_SOURCE = 'eia_spot';
const MONTHLY_OBS = 24;
const DAILY_OBS = 60;

interface PriceRow {
  commodity: string;
  period: string; // YYYY-MM-DD
  price: number;
  unit: string;
  source: string;
  fetched_at: string;
}

async function handle(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const startedAt = Date.now();
  const supabase = createServerSupabase();
  const now = new Date().toISOString();

  const errors: string[] = [];
  const perCommodity: Record<string, number> = {};
  let upsertedTotal = 0;

  const upsert = async (rows: PriceRow[], label: string) => {
    if (rows.length === 0) return;
    const { error, count } = await supabase
      .from('commodity_prices')
      .upsert(rows, { onConflict: 'commodity,period,source', count: 'exact' });
    if (error) {
      errors.push(`${label} upsert: ${error.message}`);
      return;
    }
    upsertedTotal += count ?? rows.length;
    for (const r of rows) {
      const key = `${r.commodity}:${r.source}`;
      perCommodity[key] = (perCommodity[key] ?? 0) + 1;
    }
  };

  // ── 1. IMF PCPS monthly, direct from the IMF SDMX API ──────────────
  // One request per indicator, isolated so one bad series never sinks
  // the layer. Skip on empty, never fabricate.
  const pcpsResults = await Promise.allSettled(
    PCPS_SERIES.map((s) => fetchImfPcpsMonthlyUsd(s.indicator)),
  );
  {
    const rows: PriceRow[] = [];
    pcpsResults.forEach((result, i) => {
      const s = PCPS_SERIES[i];
      if (result.status === 'rejected') {
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        errors.push(`${PCPS_SOURCE}/${s.slug}: ${msg}`);
        return;
      }
      if (result.value.length === 0) {
        errors.push(`${PCPS_SOURCE}: no observations for '${s.slug}' (${s.indicator})`);
        return;
      }
      for (const o of result.value.slice(-MONTHLY_OBS)) {
        rows.push({
          commodity: s.slug,
          period: o.period,
          price: o.value,
          unit: s.unit,
          source: PCPS_SOURCE,
          fetched_at: now,
        });
      }
    });
    await upsert(rows, PCPS_SOURCE);
  }

  // ── 2. EIA daily Brent/WTI spot ────────────────────────────────────
  const eiaKey = process.env.EIA_API_KEY;
  if (!eiaKey) {
    errors.push(`${EIA_SOURCE}: EIA_API_KEY not set — daily spot layer skipped`);
  } else {
    const spots: ReadonlyArray<{ slug: string; seriesId: string }> = [
      { slug: 'brent', seriesId: EIA_BRENT_SPOT },
      { slug: 'wti', seriesId: EIA_WTI_SPOT },
    ];
    for (const spot of spots) {
      try {
        const obs = await fetchEiaDailySpot({
          apiKey: eiaKey,
          seriesId: spot.seriesId,
          length: DAILY_OBS,
        });
        const rows: PriceRow[] = obs.map((o) => ({
          commodity: spot.slug,
          period: o.period,
          price: o.value,
          unit: o.unit,
          source: EIA_SOURCE,
          fetched_at: now,
        }));
        await upsert(rows, `${EIA_SOURCE}/${spot.seriesId}`);
      } catch (err) {
        errors.push(
          `${EIA_SOURCE}/${spot.seriesId} fetch: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  const ok = upsertedTotal > 0 || errors.length === 0;

  return NextResponse.json(
    {
      ok,
      upserted: upsertedTotal,
      per_commodity: perCommodity,
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
