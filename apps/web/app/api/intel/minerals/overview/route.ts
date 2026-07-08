import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

/**
 * Minerals overview — grounded on seeded, cited annual datasets (mig 079):
 *
 *   mines              ← mines_curated        (operator reports / USGS)
 *   refining_dominance ← mineral_refining_share (IEA GCMO 2025, 2024 shares)
 *   supply_risk_index  ← COMPUTED from mineral_production (USGS MCS 2026)
 *                        + mineral_refining_share — not asserted.
 *
 * in_transit stays a fixture (marked illustrative) until the AIS-derived
 * shipment inference lands in P2c.
 *
 * Graceful degradation: any table read failing → that section null.
 * Never fake numbers.
 */

/** Workspace selector structure. REE elements share the 'ree' dataset key
 *  because USGS/IEA report rare earths as a group, not per element. */
interface MineralDef {
  slug: string;
  label: string;
  dataKey: string;
}
const GROUPS: Array<{ slug: string; label: string; minerals: MineralDef[] }> = [
  {
    slug: 'battery',
    label: 'BATTERY',
    minerals: [
      { slug: 'cobalt', label: 'Cobalt', dataKey: 'cobalt' },
      { slug: 'lithium', label: 'Lithium', dataKey: 'lithium' },
      { slug: 'nickel', label: 'Nickel', dataKey: 'nickel' },
      { slug: 'graphite', label: 'Graphite', dataKey: 'graphite' },
    ],
  },
  {
    slug: 'rare-earth',
    label: 'RARE EARTH',
    minerals: [
      { slug: 'neodymium', label: 'Neodymium', dataKey: 'ree' },
      { slug: 'dysprosium', label: 'Dysprosium', dataKey: 'ree' },
      { slug: 'terbium', label: 'Terbium', dataKey: 'ree' },
    ],
  },
];

/** Panel-02 bar chart labels per dataset key. */
const REFINING_LABELS: Record<string, string> = {
  cobalt: 'Co',
  lithium: 'Li',
  nickel: 'Ni',
  graphite: 'Gr',
  ree: 'REE',
};

interface ProductionRow {
  mineral: string;
  country: string;
  year: number;
  share_pct: number | null;
}
interface RefiningRow {
  mineral: string;
  country: string;
  year: number;
  share_pct: number;
  source: string;
}

/** Latest-year rows per mineral dataset key. */
function latestByMineral<T extends { mineral: string; year: number }>(rows: T[]): Map<string, T[]> {
  const latestYear = new Map<string, number>();
  for (const r of rows) {
    const y = latestYear.get(r.mineral);
    if (y === undefined || r.year > y) latestYear.set(r.mineral, r.year);
  }
  const out = new Map<string, T[]>();
  for (const r of rows) {
    if (r.year !== latestYear.get(r.mineral)) continue;
    const list = out.get(r.mineral) ?? [];
    list.push(r);
    out.set(r.mineral, list);
  }
  return out;
}

export async function GET() {
  const supabase = createServerSupabase();

  // ─── Table reads (independent; a failure nulls its section only) ──
  const [minesRes, refiningRes, productionRes] = await Promise.all([
    supabase
      .from('mines_curated')
      .select('mineral, name, country, owner, tonnage_pct, status, source_url, as_of, notes')
      .order('tonnage_pct', { ascending: false, nullsFirst: false }),
    supabase
      .from('mineral_refining_share')
      .select('mineral, country, year, share_pct, source')
      .order('year', { ascending: false }),
    supabase
      .from('mineral_production')
      .select('mineral, country, year, share_pct')
      .order('year', { ascending: false }),
  ]);

  // ─── Mines (panel 01) ─────────────────────────────────────────
  const mines = minesRes.error
    ? null
    : (minesRes.data ?? []).map(m => ({
        mineral: m.mineral,
        name: m.name,
        country: m.country,
        owner: m.owner,
        // DB stores percent of world output (17 = 17%); UI multiplies by 100.
        tonnage_pct: m.tonnage_pct === null ? null : Number(m.tonnage_pct) / 100,
        status: m.status,
        source_url: m.source_url,
        as_of: m.as_of,
        notes: m.notes,
      }));

  // ─── Refining shares (panel 02 + risk inputs) ─────────────────
  const refiningRows: RefiningRow[] | null = refiningRes.error ? null : (refiningRes.data as RefiningRow[]);
  const refiningLatest = refiningRows ? latestByMineral(refiningRows) : null;

  const refining_dominance = refiningLatest
    ? Object.entries(REFINING_LABELS)
        .map(([key, label]) => {
          const cn = (refiningLatest.get(key) ?? []).find(r => r.country === 'China');
          return cn ? { mineral: label, share: Number(cn.share_pct) / 100, year: cn.year } : null;
        })
        .filter((r): r is { mineral: string; share: number; year: number } => r !== null)
        .sort((a, b) => b.share - a.share)
    : null;

  // ─── Supply risk index (panel 03) — COMPUTED, not asserted ────
  //
  // Per mineral dataset (latest year):
  //   HHI  = Σ (country production share)²   — Herfindahl-Hirschman index
  //          of mine production, from mineral_production (USGS MCS).
  //          Seeded top producers only, so the HHI is a slight UNDER-estimate
  //          (long-tail countries omitted) — conservative for red-flagging.
  //   top refining share = max country share in mineral_refining_share (IEA).
  //
  // Band:
  //   red   — HHI > 0.25 AND top refining share ≥ 0.7
  //   amber — either condition alone
  //   green — neither
  //
  // (0.25 is the standard "highly concentrated" HHI threshold.)
  const productionRows: ProductionRow[] | null = productionRes.error
    ? null
    : (productionRes.data as ProductionRow[]);
  const productionLatest = productionRows ? latestByMineral(productionRows) : null;

  let supply_risk_index = null;
  if (productionLatest && refiningLatest) {
    supply_risk_index = GROUPS.flatMap(g => g.minerals).map(m => {
      const prod = productionLatest.get(m.dataKey) ?? [];
      const hhi = prod.reduce((s, r) => s + Math.pow((Number(r.share_pct) || 0) / 100, 2), 0);
      const refiners = refiningLatest.get(m.dataKey) ?? [];
      const top = refiners.reduce<RefiningRow | null>(
        (best, r) => (best === null || Number(r.share_pct) > Number(best.share_pct) ? r : best),
        null,
      );
      const topShare = top ? Number(top.share_pct) / 100 : 0;
      const concentratedMining = hhi > 0.25;
      const concentratedRefining = topShare >= 0.7;
      const band =
        concentratedMining && concentratedRefining ? 'red' : concentratedMining || concentratedRefining ? 'amber' : 'green';
      return {
        mineral: m.label,
        slug: m.slug,
        band,
        // components, so the UI can show its work
        hhi: Math.round(hhi * 100) / 100,
        top_refiner: top?.country ?? null,
        top_refining_share: topShare,
      };
    });
  }

  // ─── Selector groups (china refining share + computed band) ──
  const bandBySlug = new Map((supply_risk_index ?? []).map(r => [r.slug, r.band]));
  const groups = GROUPS.map(g => ({
    slug: g.slug,
    label: g.label,
    minerals: g.minerals.map(m => {
      const cn = refiningLatest ? (refiningLatest.get(m.dataKey) ?? []).find(r => r.country === 'China') : null;
      return {
        slug: m.slug,
        label: m.label,
        china_refining_share: cn ? Number(cn.share_pct) / 100 : null,
        risk_band: bandBySlug.get(m.slug) ?? null,
      };
    }),
  }));

  // ─── In-transit shipments — FIXTURE until AIS derivation (P2c) ─
  const in_transit = [
    { vessel: 'DON GIOVANNI',  flag: 'PAN', route: 'DRC → Shanghai',      mineral: 'cobalt',    tonnage_t: 18_400, eta_hours: 310 },
    { vessel: 'BERLIN TIGRIS', flag: 'BHS', route: 'Australia → Ulsan',   mineral: 'lithium',   tonnage_t: 23_000, eta_hours: 192 },
    { vessel: 'GRAN CANARIA',  flag: 'MLT', route: 'Indonesia → Shekou',  mineral: 'nickel',    tonnage_t: 32_200, eta_hours: 72  },
    { vessel: 'EVERGLOW SAIL', flag: 'HKG', route: 'Bayan Obo → Tianjin', mineral: 'neodymium', tonnage_t: 4_100,  eta_hours: 24  },
  ];

  return NextResponse.json({
    groups,
    refining_dominance,
    mines,
    supply_risk_index,
    in_transit,
    illustrative: { in_transit: true },
    sources: {
      production: 'USGS Mineral Commodity Summaries 2026 · 2025 mine production',
      refining: 'IEA Global Critical Minerals Outlook 2025 · 2024 refined-output shares',
      mines: 'Curated · operator reports / USGS MCS 2026',
    },
  });
}
