import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Commodities workspace — per-commodity market inputs (INTEL grounding
 * audit, P2b). Feeds panels 01/02/04/05 with sourced or computed data:
 *
 *  • prices        — commodity_prices (migration 079): EIA daily spot for
 *                    brent/wti ('eia_spot'), World Bank CMO monthly for the
 *                    rest ('wb_cmo_dbnomics'). Last 60 observations of the
 *                    preferred source; null until the ingest crons run.
 *
 *  • export_shares — mineral_trade_flows (migration 079, UN Comtrade):
 *                    top-6 reporters at the latest period, flow='export',
 *                    share = reporter value_usd / world total. Null until
 *                    the Comtrade ingest lands (API key may lag).
 *
 *  • sanction_risk — COMPUTED bands for a fixed exporter list per
 *                    commodity family. Components per country:
 *                      – ofac_active_designations: rows in ofac_designations
 *                        with removed_at IS NULL whose programs[] overlaps a
 *                        curated list of country-linked OFAC program codes
 *                        (verified against the live SDN ingest; some ingested
 *                        elements are unsplit "A] [B" combos, so exact-element
 *                        overlap slightly undercounts — fine for banding).
 *                      – fatalities_30d: sum of conflict_events.fatalities in
 *                        the last 30 days for the country's FIPS code. NOTE:
 *                        the GDELT ingest writes fatalities=0, so this
 *                        component is live but currently always 0; it arms
 *                        automatically if a casualty-bearing ingest lands.
 *                      – conflict_events_30d: 30-day event count, returned
 *                        for context ONLY — GDELT event volume tracks media
 *                        coverage (the US ranks first), not intensity, so it
 *                        does not enter the band.
 *                    Thresholds: RED if ofac ≥ 250 or fatalities ≥ 500;
 *                    AMBER if ofac ≥ 25 or fatalities ≥ 100; else GREEN.
 *
 *  • ribbon        — 72h corridor-risk HEURISTIC (labelled as such in the
 *                    payload) from live anomaly densities. Each Maritime or
 *                    Energy anomaly_flags row in the last 72h contributes
 *                    sevWeight × exp(−ageHours/36), sevWeight = low 1 /
 *                    medium 2 / high 3 / critical 5. Density D is summed,
 *                    base b = 1 − exp(−D/300) ∈ [0,1) (normaliser calibrated
 *                    against Jul-2026 detector volume, ~680 weighted/72h →
 *                    b ≈ 0.6), and bucket i (t+12i h, i = 0..6) decays as
 *                    v_i = b × exp(−i/4). Not a forecast model.
 *
 * Graceful nulls on any query failure; errors[] reports what failed.
 * NEVER fixture numbers (verify-don't-assert).
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

// Band thresholds (documented above): OFAC designation count dominates
// today because GDELT fatalities are always 0.
const BAND_RED = { ofac: 250, fatalities: 500 };
const BAND_AMBER = { ofac: 25, fatalities: 100 };

const SEV_WEIGHT: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 5 };
const RIBBON_NORMALISER = 300; // b = 1 − exp(−D/300); see header comment
const WORLD_ALIASES = new Set(['world', 'wld', 'w00', 'all']);

interface PriceRow { period: string; price: number; unit: string; source: string }
interface FlowRow { reporter: string; partner: string; period: string; value_usd: number }
interface FlagRow { severity: string; created_at: string }

export async function GET(req: NextRequest) {
  const commodity = req.nextUrl.searchParams.get('commodity') ?? '';
  const family = FAMILY_BY_SLUG[commodity];
  if (!family) {
    return NextResponse.json(
      { error: `unknown commodity '${commodity}' — expected one of ${Object.keys(FAMILY_BY_SLUG).join(', ')}` },
      { status: 400 },
    );
  }

  const supabase = createServerSupabase();
  const errors: string[] = [];
  const exporters = FAMILY_EXPORTERS[family];
  const since30d = new Date(Date.now() - 30 * 24 * 3600_000).toISOString().slice(0, 10);
  const since72h = new Date(Date.now() - 72 * 3600_000).toISOString();

  const [pricesRes, flowsRes, flagsRes, fatalRes, ofacCounts, conflictCounts] = await Promise.all([
    supabase
      .from('commodity_prices')
      .select('period, price, unit, source')
      .eq('commodity', commodity)
      .order('period', { ascending: false })
      .limit(240),
    supabase
      .from('mineral_trade_flows')
      .select('reporter, partner, period, value_usd')
      .eq('mineral', commodity)
      .eq('flow', 'export')
      .order('period', { ascending: false })
      .limit(1000),
    supabase
      .from('anomaly_flags')
      .select('severity, created_at')
      .in('domain', ['Maritime', 'Energy'])
      .gte('created_at', since72h)
      .limit(1000),
    // Fatality-bearing rows only (rare — GDELT writes 0), so one query
    // covers the whole family without hitting the row cap.
    supabase
      .from('conflict_events')
      .select('country, fatalities')
      .in('country', exporters.map(e => e.fips))
      .gte('event_date', since30d)
      .gt('fatalities', 0)
      .limit(1000),
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
  let prices: {
    source: string;
    unit: string;
    cadence: 'daily' | 'monthly';
    series: number[];
    latest: { period: string; value: number };
  } | null = null;

  if (pricesRes.error) {
    errors.push(`commodity_prices: ${pricesRes.error.message}`);
  } else if (pricesRes.data?.length) {
    const rows = pricesRes.data as PriceRow[];
    // Prefer EIA daily spot when both sources exist for the slug.
    const source = rows.some(r => r.source === 'eia_spot') ? 'eia_spot' : rows[0].source;
    const chosen = rows.filter(r => r.source === source).slice(0, 60);
    prices = {
      source,
      unit: chosen[0].unit,
      cadence: source === 'eia_spot' ? 'daily' : 'monthly',
      series: chosen.map(r => r.price).reverse(),
      latest: { period: chosen[0].period, value: chosen[0].price },
    };
  }

  // ── export shares ─────────────────────────────────────────────────
  let export_shares: {
    period: string;
    source: string;
    rows: Array<{ reporter: string; value_usd: number; share: number }>;
  } | null = null;

  if (flowsRes.error) {
    errors.push(`mineral_trade_flows: ${flowsRes.error.message}`);
  } else if (flowsRes.data?.length) {
    const rows = flowsRes.data as FlowRow[];
    const latestPeriod = rows[0].period;
    const atLatest = rows.filter(r => r.period === latestPeriod);
    // Prefer reporter→World rows when Comtrade provides the aggregate.
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
        period: latestPeriod,
        source: 'UN Comtrade',
        rows: [...byReporter.entries()]
          .map(([reporter, value_usd]) => ({
            reporter,
            value_usd,
            share: Math.round((value_usd / total) * 1000) / 1000,
          }))
          .sort((a, b) => b.value_usd - a.value_usd)
          .slice(0, 6),
      };
    }
  }

  // ── sanction risk (computed) ──────────────────────────────────────
  const fatalitiesByFips = new Map<string, number>();
  if (fatalRes.error) {
    errors.push(`conflict_events fatalities: ${fatalRes.error.message}`);
  } else {
    for (const row of (fatalRes.data ?? []) as Array<{ country: string; fatalities: number }>) {
      fatalitiesByFips.set(row.country, (fatalitiesByFips.get(row.country) ?? 0) + (row.fatalities ?? 0));
    }
  }
  const ofacByCountry = new Map(ofacCounts.map(o => [o.country, o.count]));
  const eventsByCountry = new Map(conflictCounts.map(c => [c.country, c.count]));

  const riskRows = exporters.map(e => {
    const ofac = ofacByCountry.get(e.country) ?? null;
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
      fatalities_30d: fatalities,
      conflict_events_30d: eventsByCountry.get(e.country) ?? null, // context only
      ofac_programs_matched: OFAC_PROGRAMS[e.country] ?? [],
    };
  });
  // Null only if every component failed — otherwise return what computed.
  const allFailed = riskRows.every(r => r.ofac_active_designations === null && r.fatalities_30d === null);
  const sanction_risk = allFailed
    ? null
    : {
        computed: true,
        method: 'band from active OFAC designations (country-linked programs) + 30d conflict fatalities; red ≥250 OFAC or ≥500 fatalities, amber ≥25 OFAC or ≥100 fatalities',
        rows: riskRows,
      };

  // ── 72h ribbon (heuristic) ────────────────────────────────────────
  let ribbon: {
    heuristic: true;
    method: string;
    base: number;
    inputs: { flags_72h: number; weighted_density: number };
    buckets: Array<{ t_plus_h: number; value: number }>;
  } | null = null;

  if (flagsRes.error) {
    errors.push(`anomaly_flags: ${flagsRes.error.message}`);
  } else {
    const flags = (flagsRes.data ?? []) as FlagRow[];
    const now = Date.now();
    let density = 0;
    for (const f of flags) {
      const ageHours = Math.max(0, (now - new Date(f.created_at).getTime()) / 3600_000);
      density += (SEV_WEIGHT[f.severity] ?? 1) * Math.exp(-ageHours / 36);
    }
    const base = 1 - Math.exp(-density / RIBBON_NORMALISER);
    ribbon = {
      heuristic: true,
      method: 'live Maritime+Energy anomaly density, severity- and recency-weighted; b = 1−exp(−D/300); bucket t+12i h = b·exp(−i/4). Not a forecast model.',
      base: Math.round(base * 100) / 100,
      inputs: { flags_72h: flags.length, weighted_density: Math.round(density * 10) / 10 },
      buckets: Array.from({ length: 7 }, (_, i) => ({
        t_plus_h: i * 12,
        value: Math.round(base * Math.exp(-i / 4) * 100) / 100,
      })),
    };
  }

  return NextResponse.json(
    { commodity, family, prices, export_shares, sanction_risk, ribbon, errors },
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
  );
}
