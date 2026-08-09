import { createServerSupabase } from '@/lib/supabase-server';

/**
 * Commodities workspace — per-commodity market payload builder.
 *
 * Extracted from app/api/intel/commodities/markets/route.ts (PR 2 of
 * the Grounding Brief 2026-08-09 rev. B) so the export snapshot and
 * the compliance review reuse the exact computation the panels render
 * — one source of numbers, no drift. The route is now a thin wrapper.
 *
 * PR 2 additions on top of the P2b grounding:
 *  • export_shares — BOTH paths (D2): UN Comtrade rows when the ingest
 *    has them, else the primary-source seed (commodity_export_shares,
 *    migration 104) for wheat/oil/gas, else USGS/IEA production shares
 *    for the mineral family. The payload names the layer and vintage —
 *    the reader always knows whether they see a live Comtrade period
 *    or a seeded vintage.
 *  • sanction_risk — measured 90d designation trend per country from
 *    ofac_designations.first_seen_at / removed_at. Measured, never
 *    predicted: forecasts belong to predictions_register (house track)
 *    or nowhere.
 *  • futures + volatility — EIA NYMEX front months (wti; henry_hub
 *    labeled as the US benchmark for the ttf view) and 30d realized
 *    volatility computed from stored dailies. No implied vol is
 *    available or implied.
 *  • ribbon.maritime_degraded — the heuristic inherits its inputs'
 *    instrument problems: when the AIS feed is stale the Maritime
 *    component is inherently decaying and the payload says so.
 */

const FAMILY_BY_SLUG: Record<string, string> = {
  wheat: 'agri',
  brent: 'oil',
  wti: 'oil',
  ttf: 'gas',
  cobalt: 'mineral',
  lithium: 'mineral',
  ree: 'mineral',
  copper: 'mineral',
};

// Family key in commodity_export_shares (migration 104 seed).
const SEED_KEY_BY_SLUG: Record<string, string | null> = {
  wheat: 'wheat',
  brent: 'oil',
  wti: 'oil',
  ttf: 'gas',
  cobalt: null, // mineral family: production shares from mineral_production
  lithium: null,
  ree: null,
  copper: null,
};

// OFAC program codes verified against the live ofac_designations ingest
// (programs[] elements, removed_at IS NULL). Countries without a
// country-linked OFAC program list get [] → ofac component 0.
const OFAC_PROGRAMS: Record<string, string[]> = {
  Russia: [
    'RUSSIA-EO14024', 'UKRAINE-EO13660', 'UKRAINE-EO13661', 'UKRAINE-EO13662',
    'UKRAINE-EO13685', 'CAATSA - RUSSIA', 'PEESA',
  ],
  Iran: [
    'IRAN', 'IRAN-EO13902', 'IRAN-EO13846', 'IRAN-EO13876', 'IRAN-EO13871',
    'IRAN-HR', 'IRAN-TRA', 'IFSR', 'IRGC',
  ],
  Venezuela: ['VENEZUELA', 'VENEZUELA-EO13850', 'VENEZUELA-EO13884'],
  Libya: ['LIBYA2', 'LIBYA3'],
  Myanmar: ['BURMA', 'BURMA-EO14014'],
  'DR Congo': ['DRCONGO'],
  China: ['CMIC-EO13959', 'CHINESE-MIL-EO13959', 'HK-EO13936'],
};

// Fixed exporter list per commodity family; fips = FIPS 10-4 code as
// written by the GDELT ingest into conflict_events.country.
const FAMILY_EXPORTERS: Record<string, Array<{ country: string; fips: string }>> = {
  agri: [
    { country: 'Russia', fips: 'RS' },
    { country: 'USA', fips: 'US' },
    { country: 'Canada', fips: 'CA' },
    { country: 'Australia', fips: 'AS' },
    { country: 'Ukraine', fips: 'UP' },
    { country: 'France', fips: 'FR' },
  ],
  oil: [
    { country: 'Russia', fips: 'RS' },
    { country: 'Saudi Arabia', fips: 'SA' },
    { country: 'Iran', fips: 'IR' },
    { country: 'Venezuela', fips: 'VE' },
    { country: 'Libya', fips: 'LY' },
    { country: 'Nigeria', fips: 'NI' },
    { country: 'Norway', fips: 'NO' },
    { country: 'Canada', fips: 'CA' },
  ],
  gas: [
    { country: 'Russia', fips: 'RS' },
    { country: 'USA', fips: 'US' },
    { country: 'Qatar', fips: 'QA' },
    { country: 'Norway', fips: 'NO' },
    { country: 'Algeria', fips: 'AG' },
    { country: 'Australia', fips: 'AS' },
  ],
  mineral: [
    { country: 'China', fips: 'CH' },
    { country: 'DR Congo', fips: 'CG' },
    { country: 'Chile', fips: 'CI' },
    { country: 'Australia', fips: 'AS' },
    { country: 'Indonesia', fips: 'ID' },
    { country: 'Russia', fips: 'RS' },
    { country: 'Myanmar', fips: 'BM' },
    { country: 'Peru', fips: 'PE' },
  ],
};

// Band thresholds: OFAC designation count dominates today because
// GDELT fatalities are always 0.
const BAND_RED = { ofac: 250, fatalities: 500 };
const BAND_AMBER = { ofac: 25, fatalities: 100 };

const SEV_WEIGHT: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 5 };
const RIBBON_NORMALISER = 300; // b = 1 − exp(−D/300)
const WORLD_ALIASES = new Set(['world', 'wld', 'w00', 'all']);
const TREND_WINDOW_DAYS = 90;
// Mineral slug for production-share fallback is the slug itself.

interface PriceRow { period: string; price: number; unit: string; source: string }
interface FlowRow { reporter: string; partner: string; period: string; value_usd: number }
interface FlagRow { severity: string; created_at: string }

export interface ExportSharesPayload {
  layer: 'comtrade' | 'seed' | 'production';
  period: string; // Comtrade period, or the seed/production vintage
  source: string;
  basis: string;
  rows: Array<{ reporter: string; share: number; value?: number; unit?: string | null }>;
  notes?: string[];
}

export interface MarketsPayload {
  commodity: string;
  family: string;
  prices: {
    source: string;
    unit: string;
    cadence: 'daily' | 'monthly';
    series: number[];
    latest: { period: string; value: number };
  } | null;
  volatility_30d: { pct: number; method: string } | null;
  futures: {
    label: string;
    benchmark_note: string | null;
    unit: string;
    period: string;
    points: Array<{ month: number; price: number }>;
    structure: 'backwardated' | 'contango' | 'flat';
  } | null;
  export_shares: ExportSharesPayload | null;
  sanction_risk: {
    computed: boolean;
    method: string;
    trend_window_days: number;
    trend_clamped_to: string | null;
    rows: Array<{
      country: string;
      fips: string;
      band: 'red' | 'amber' | 'green';
      ofac_active_designations: number | null;
      designation_delta_90d: number | null;
      fatalities_30d: number | null;
      conflict_events_30d: number | null;
      ofac_programs_matched: string[];
    }>;
  } | null;
  ribbon: {
    heuristic: true;
    method: string;
    base: number;
    maritime_degraded: boolean;
    maritime_degraded_reason: string | null;
    inputs: { flags_72h: number; weighted_density: number };
    buckets: Array<{ t_plus_h: number; value: number }>;
  } | null;
  errors: string[];
}

export function isKnownCommodity(slug: string): boolean {
  return Boolean(FAMILY_BY_SLUG[slug]);
}

export async function buildMarketsPayload(commodity: string): Promise<MarketsPayload | null> {
  const family = FAMILY_BY_SLUG[commodity];
  if (!family) return null;

  const supabase = createServerSupabase();
  const errors: string[] = [];
  const exporters = FAMILY_EXPORTERS[family];
  const now = Date.now();
  const since30d = new Date(now - 30 * 24 * 3600_000).toISOString().slice(0, 10);
  const since72h = new Date(now - 72 * 3600_000).toISOString();
  const trendCutoff = new Date(now - TREND_WINDOW_DAYS * 24 * 3600_000).toISOString();
  const seedKey = SEED_KEY_BY_SLUG[commodity];
  const futuresKey = commodity === 'wti' ? 'wti' : commodity === 'ttf' ? 'henry_hub' : null;

  const [
    pricesRes,
    futuresRes,
    flowsRes,
    seedRes,
    prodRes,
    flagsRes,
    fatalRes,
    aisNewestRes,
    ofacOnsetRes,
    ofacCounts,
    ofacThenCounts,
    conflictCounts,
  ] = await Promise.all([
    supabase
      .from('commodity_prices')
      .select('period, price, unit, source')
      .eq('commodity', commodity)
      .order('period', { ascending: false })
      .limit(240),
    futuresKey
      ? supabase
          .from('commodity_prices')
          .select('period, price, unit, source')
          .eq('commodity', futuresKey)
          .in('source', ['eia_fut_m1', 'eia_fut_m2', 'eia_fut_m3', 'eia_fut_m4'])
          .order('period', { ascending: false })
          .limit(40)
      : Promise.resolve({ data: null, error: null } as const),
    supabase
      .from('mineral_trade_flows')
      .select('reporter, partner, period, value_usd')
      .eq('mineral', commodity)
      .eq('flow', 'export')
      .order('period', { ascending: false })
      .limit(1000),
    seedKey
      ? supabase
          .from('commodity_export_shares')
          .select('country, year, value, unit, share_pct, source, as_of, notes')
          .eq('commodity', seedKey)
          .order('year', { ascending: false })
          .order('share_pct', { ascending: false })
          .limit(24)
      : Promise.resolve({ data: null, error: null } as const),
    family === 'mineral'
      ? supabase
          .from('mineral_production')
          .select('country, year, share_pct, source, as_of')
          .eq('mineral', commodity)
          .order('year', { ascending: false })
          .order('share_pct', { ascending: false })
          .limit(24)
      : Promise.resolve({ data: null, error: null } as const),
    supabase
      .from('anomaly_flags')
      .select('severity, created_at')
      .in('domain', ['Maritime', 'Energy'])
      .gte('created_at', since72h)
      .limit(1000),
    supabase
      .from('conflict_events')
      .select('country, fatalities')
      .in('country', exporters.map(e => e.fips))
      .gte('event_date', since30d)
      .gt('fatalities', 0)
      .limit(1000),
    // AIS feed liveness — the ribbon's Maritime component measures the
    // instrument when this is stale, and must say so.
    supabase
      .from('vessel_positions')
      .select('updated_at')
      .order('updated_at', { ascending: false })
      .limit(1),
    // OFAC ingest onset: the 90d trend clamps here (feed-onset rule —
    // a window that predates the feed manufactures a trend).
    supabase
      .from('ofac_designations')
      .select('first_seen_at')
      .order('first_seen_at', { ascending: true })
      .limit(1),
    Promise.all(
      exporters.map(async e => {
        const programs = OFAC_PROGRAMS[e.country] ?? [];
        if (!programs.length) return { country: e.country, count: 0 as number | null };
        const res = await supabase
          .from('ofac_designations')
          .select('ent_num', { count: 'exact', head: true })
          .is('removed_at', null)
          .overlaps('programs', programs);
        if (res.error) {
          errors.push(`ofac_designations (${e.country}): ${res.error.message}`);
          return { country: e.country, count: null };
        }
        return { country: e.country, count: res.count ?? 0 };
      }),
    ),
    // Active designations as of the trend cutoff: first seen before it,
    // and not removed by it. Reconstructed from recorded history —
    // measured, never extrapolated.
    Promise.all(
      exporters.map(async e => {
        const programs = OFAC_PROGRAMS[e.country] ?? [];
        if (!programs.length) return { country: e.country, count: 0 as number | null };
        const res = await supabase
          .from('ofac_designations')
          .select('ent_num', { count: 'exact', head: true })
          .lte('first_seen_at', trendCutoff)
          .or(`removed_at.is.null,removed_at.gt.${trendCutoff}`)
          .overlaps('programs', programs);
        if (res.error) {
          errors.push(`ofac_designations trend (${e.country}): ${res.error.message}`);
          return { country: e.country, count: null };
        }
        return { country: e.country, count: res.count ?? 0 };
      }),
    ),
    Promise.all(
      exporters.map(async e => {
        const res = await supabase
          .from('conflict_events')
          .select('id', { count: 'exact', head: true })
          .eq('country', e.fips)
          .gte('event_date', since30d);
        if (res.error) {
          errors.push(`conflict_events (${e.country}): ${res.error.message}`);
          return { country: e.country, count: null };
        }
        return { country: e.country, count: res.count ?? 0 };
      }),
    ),
  ]);

  // ── prices ────────────────────────────────────────────────────────
  let prices: MarketsPayload['prices'] = null;
  let volatility_30d: MarketsPayload['volatility_30d'] = null;

  if (pricesRes.error) {
    errors.push(`commodity_prices: ${pricesRes.error.message}`);
  } else if (pricesRes.data?.length) {
    const rows = pricesRes.data as PriceRow[];
    // Prefer EIA daily spot when both sources exist for the slug.
    const source = rows.some(r => r.source === 'eia_spot') ? 'eia_spot' : rows.find(r => !r.source.startsWith('eia_fut'))?.source;
    if (source) {
      const chosen = rows.filter(r => r.source === source).slice(0, 60);
      prices = {
        source,
        unit: chosen[0].unit,
        cadence: source === 'eia_spot' ? 'daily' : 'monthly',
        series: chosen.map(r => r.price).reverse(),
        latest: { period: chosen[0].period, value: chosen[0].price },
      };

      // 30d realized volatility — daily series only; annualized stdev
      // of log returns over the last ~21 trading days. Monthly series
      // get no volatility number rather than a misleading one.
      if (source === 'eia_spot' && chosen.length >= 15) {
        const daily = chosen.map(r => r.price).reverse(); // oldest → newest
        const window = daily.slice(-22);
        const rets: number[] = [];
        for (let i = 1; i < window.length; i++) {
          if (window[i - 1] > 0 && window[i] > 0) rets.push(Math.log(window[i] / window[i - 1]));
        }
        if (rets.length >= 10) {
          const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
          const varc = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
          const annualized = Math.sqrt(varc) * Math.sqrt(252);
          volatility_30d = {
            pct: Math.round(annualized * 1000) / 10,
            method: `annualized stdev of daily log returns, last ${rets.length + 1} trading days — realized, not implied`,
          };
        }
      }
    }
  }

  // ── futures (wti: NYMEX WTI; ttf view: Henry Hub, labeled) ────────
  let futures: MarketsPayload['futures'] = null;
  if (futuresKey) {
    if (futuresRes.error) {
      errors.push(`commodity_prices futures: ${futuresRes.error.message}`);
    } else if (futuresRes.data?.length) {
      const rows = futuresRes.data as PriceRow[];
      const latestPer: Map<number, PriceRow> = new Map();
      for (const r of rows) {
        const m = Number(r.source.slice(-1));
        if (!latestPer.has(m)) latestPer.set(m, r); // rows newest-first
      }
      if (latestPer.size >= 2) {
        const points = [...latestPer.entries()]
          .map(([month, r]) => ({ month, price: r.price }))
          .sort((a, b) => a.month - b.month);
        const first = points[0].price;
        const last = points[points.length - 1].price;
        futures = {
          label: futuresKey === 'wti' ? 'NYMEX WTI futures (EIA)' : 'Henry Hub futures (EIA)',
          benchmark_note:
            futuresKey === 'henry_hub'
              ? 'US benchmark — TTF contract data requires a licensed source and is not substituted'
              : null,
          unit: points.length ? (latestPer.get(points[0].month)?.unit ?? '') : '',
          period: latestPer.get(points[0].month)?.period ?? '',
          points,
          structure: first > last * 1.002 ? 'backwardated' : last > first * 1.002 ? 'contango' : 'flat',
        };
      }
    }
    // No rows yet (ingest not run) → futures stays null; the panel
    // renders its honest waiting state. Brent: never populated — EIA
    // carries no Brent futures and we do not substitute.
  }

  // ── export shares — Comtrade, else seed, else production ─────────
  let export_shares: ExportSharesPayload | null = null;

  if (flowsRes.error) {
    errors.push(`mineral_trade_flows: ${flowsRes.error.message}`);
  } else if (flowsRes.data?.length) {
    const rows = flowsRes.data as FlowRow[];
    const latestPeriod = rows[0].period;
    const atLatest = rows.filter(r => r.period === latestPeriod);
    const worldPartner = atLatest.filter(r => WORLD_ALIASES.has((r.partner ?? '').toLowerCase()));
    const basis = worldPartner.length ? worldPartner : atLatest;
    const byReporter = new Map<string, number>();
    let worldReporterTotal = 0;
    for (const r of basis) {
      if (WORLD_ALIASES.has((r.reporter ?? '').toLowerCase())) {
        worldReporterTotal += r.value_usd ?? 0;
      } else {
        byReporter.set(r.reporter, (byReporter.get(r.reporter) ?? 0) + (r.value_usd ?? 0));
      }
    }
    const summed = [...byReporter.values()].reduce((s, v) => s + v, 0);
    const total = worldReporterTotal > 0 ? worldReporterTotal : summed;
    if (total > 0 && byReporter.size) {
      export_shares = {
        layer: 'comtrade',
        period: latestPeriod,
        source: 'UN Comtrade',
        basis: 'export value, latest reported period',
        rows: [...byReporter.entries()]
          .map(([reporter, value_usd]) => ({
            reporter,
            value: value_usd,
            unit: 'USD',
            share: Math.round((value_usd / total) * 1000) / 1000,
          }))
          .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
          .slice(0, 6),
      };
    }
  }

  if (!export_shares && seedKey) {
    if (seedRes.error) {
      errors.push(`commodity_export_shares: ${seedRes.error.message}`);
    } else if (seedRes.data?.length) {
      const rows = seedRes.data as Array<{
        country: string; year: number; value: number | null; unit: string | null;
        share_pct: number; source: string; as_of: string | null; notes: string | null;
      }>;
      const latestYear = rows[0].year;
      const atYear = rows.filter(r => r.year === latestYear);
      const notes = [...new Set(atYear.map(r => r.notes).filter((n): n is string => Boolean(n)))];
      export_shares = {
        layer: 'seed',
        period: String(latestYear),
        source: atYear[0].source,
        basis: `seeded primary source · updates to UN Comtrade when the ingest lands`,
        rows: atYear.slice(0, 7).map(r => ({
          reporter: r.country,
          share: Math.round(r.share_pct * 10) / 1000,
          value: r.value ?? undefined,
          unit: r.unit,
        })),
        ...(notes.length ? { notes } : {}),
      };
    }
  }

  if (!export_shares && family === 'mineral') {
    if (prodRes.error) {
      errors.push(`mineral_production: ${prodRes.error.message}`);
    } else if (prodRes.data?.length) {
      const rows = prodRes.data as Array<{ country: string; year: number; share_pct: number | null; source: string }>;
      const latestYear = rows[0].year;
      const atYear = rows.filter(r => r.year === latestYear && r.share_pct != null);
      if (atYear.length) {
        export_shares = {
          layer: 'production',
          period: String(latestYear),
          source: atYear[0].source,
          basis: 'mine production share (exports unavailable until Comtrade)',
          rows: atYear.slice(0, 7).map(r => ({ reporter: r.country, share: Math.round((r.share_pct as number) * 10) / 1000 })),
        };
      }
    }
  }

  // ── sanction risk (computed) + measured 90d trend ─────────────────
  const fatalitiesByFips = new Map<string, number>();
  if (fatalRes.error) {
    errors.push(`conflict_events fatalities: ${fatalRes.error.message}`);
  } else {
    for (const row of (fatalRes.data ?? []) as Array<{ country: string; fatalities: number }>) {
      fatalitiesByFips.set(row.country, (fatalitiesByFips.get(row.country) ?? 0) + (row.fatalities ?? 0));
    }
  }
  const ofacByCountry = new Map(ofacCounts.map(o => [o.country, o.count]));
  const ofacThenByCountry = new Map(ofacThenCounts.map(o => [o.country, o.count]));
  const eventsByCountry = new Map(conflictCounts.map(c => [c.country, c.count]));

  // Feed-onset clamp: if the OFAC ingest began inside the trend window,
  // the "then" count reflects an empty feed, not an empty list. In that
  // case the trend is not computable and reads null.
  const ofacOnset = !ofacOnsetRes.error && ofacOnsetRes.data?.[0]?.first_seen_at
    ? new Date(ofacOnsetRes.data[0].first_seen_at as string)
    : null;
  const trendComputable = ofacOnset !== null && ofacOnset.getTime() <= new Date(trendCutoff).getTime();

  const riskRows = exporters.map(e => {
    const ofac = ofacByCountry.get(e.country) ?? null;
    const ofacThen = ofacThenByCountry.get(e.country) ?? null;
    const fatalities = fatalRes.error ? null : (fatalitiesByFips.get(e.fips) ?? 0);
    const band: 'red' | 'amber' | 'green' =
      (ofac ?? 0) >= BAND_RED.ofac || (fatalities ?? 0) >= BAND_RED.fatalities
        ? 'red'
        : (ofac ?? 0) >= BAND_AMBER.ofac || (fatalities ?? 0) >= BAND_AMBER.fatalities
          ? 'amber'
          : 'green';
    return {
      country: e.country,
      fips: e.fips,
      band,
      ofac_active_designations: ofac,
      designation_delta_90d:
        trendComputable && ofac !== null && ofacThen !== null ? ofac - ofacThen : null,
      fatalities_30d: fatalities,
      conflict_events_30d: eventsByCountry.get(e.country) ?? null, // context only
      ofac_programs_matched: OFAC_PROGRAMS[e.country] ?? [],
    };
  });
  const allFailed = riskRows.every(r => r.ofac_active_designations === null && r.fatalities_30d === null);
  const sanction_risk = allFailed
    ? null
    : {
        computed: true,
        method:
          'band from active OFAC designations (country-linked programs) + 30d conflict fatalities; red ≥250 OFAC or ≥500 fatalities, amber ≥25 OFAC or ≥100 fatalities. Trend = measured Δ in active designations over the window (first_seen_at/removed_at reconstruction) — computed, never predicted.',
        trend_window_days: TREND_WINDOW_DAYS,
        trend_clamped_to: trendComputable ? null : (ofacOnset?.toISOString() ?? 'feed onset unknown'),
        rows: riskRows,
      };

  // ── 72h ribbon (heuristic) + instrument disclosure ────────────────
  let ribbon: MarketsPayload['ribbon'] = null;

  const aisNewest = !aisNewestRes.error && aisNewestRes.data?.[0]?.updated_at
    ? new Date(aisNewestRes.data[0].updated_at as string)
    : null;
  const aisAgeHours = aisNewest ? (now - aisNewest.getTime()) / 3600_000 : null;
  const maritimeDegraded = aisAgeHours === null || aisAgeHours > 6;

  if (flagsRes.error) {
    errors.push(`anomaly_flags: ${flagsRes.error.message}`);
  } else {
    const flags = (flagsRes.data ?? []) as FlagRow[];
    let density = 0;
    for (const f of flags) {
      const ageHours = Math.max(0, (now - new Date(f.created_at).getTime()) / 3600_000);
      density += (SEV_WEIGHT[f.severity] ?? 1) * Math.exp(-ageHours / 36);
    }
    const base = 1 - Math.exp(-density / RIBBON_NORMALISER);
    ribbon = {
      heuristic: true,
      method:
        'live Maritime+Energy anomaly density, severity- and recency-weighted; b = 1−exp(−D/300); bucket t+12i h = b·exp(−i/4). Not a forecast model.',
      base: Math.round(base * 100) / 100,
      maritime_degraded: maritimeDegraded,
      maritime_degraded_reason: maritimeDegraded
        ? aisAgeHours === null
          ? 'AIS feed liveness unknown'
          : `AIS feed stale ${Math.floor(aisAgeHours)}h — Maritime flags decaying, density understates maritime risk`
        : null,
      inputs: { flags_72h: flags.length, weighted_density: Math.round(density * 10) / 10 },
      buckets: Array.from({ length: 7 }, (_, i) => ({
        t_plus_h: i * 12,
        value: Math.round(base * Math.exp(-i / 4) * 100) / 100,
      })),
    };
  }

  return {
    commodity,
    family,
    prices,
    volatility_30d,
    futures,
    export_shares,
    sanction_risk,
    ribbon,
    errors,
  };
}
