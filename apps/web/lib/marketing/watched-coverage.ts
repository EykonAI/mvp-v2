import { createServerSupabase } from '@/lib/supabase-server';
import { FIRMS_REGIONS, firmsRegionsAsJsonb } from '@/lib/firms/client';

/**
 * WATCHED COVERAGE — the one named query behind every "watched" count a
 * public surface quotes (Reality Check programme rev H, PR-10).
 *
 * Server-only (it uses the service-role client). The homepage is a static
 * client component, so it reads this through GET /api/coverage/watched;
 * /start, /mcp and /llms.txt call it directly. Every surface therefore
 * quotes the same figure from the same query, and none of them carries a
 * literal that can outlive the thing it counts.
 *
 * What each field reproduces (measured read-only on production 2026-09-18):
 *
 *   refineriesWatched / refineriesRegistry
 *     refinery_type_coverage(<FIRMS_REGIONS boxes>)            (migration 168)
 *       -> watched_refineries / registry_refineries
 *     firms_rule_coverage('refinery', NULL, NULL, <boxes>)'s own definition
 *     of monitored / matching, restricted to refineries.site_type =
 *     'refinery' (founder decision 2026-09-19): the crude-oil refineries
 *     inside the FIRMS region boxes, over all crude-oil refineries. The 96
 *     sites 168 re-typed (terminals, petrochemical works, gas plants, mills)
 *     are still observed by FIRMS but are not counted here.
 *                          353 / 554 once 168 is applied and ru-ua reaches 74 E
 *     (Before 168 this read firms_rule_coverage over every refinery-tagged
 *     row: 431 / 634 on 2026-09-18.) firms_rule_coverage itself is unchanged
 *     — alert-rule creation still needs every row FIRMS observes — so there
 *     is no fallback to it: if the RPC fails the figure is null ("—").
 *     The registry figure is NOT the watched figure — "634 refineries
 *     watched" was the PR-10 defect.
 *
 *   thermalDay, thermalRefineryRows, thermalPowerUnitRows
 *     the newest period in firms_facility_observations and the rows the
 *     derivation wrote for it, by facility_type.     2026-09-19 · 353 · 10,143
 *     Refinery rows go through refinery_roster_rows(<day>) (migration 181):
 *     the same site_type = 'refinery' population as refineriesWatched, so
 *     /start's roster and the homepage's "watched" agree (353 = 353 on
 *     2026-09-19). Counting every refinery-tagged row read 449 — it included
 *     the 96 sites 168 re-typed, which FIRMS still observes. It stays a count
 *     of rows the derivation WROTE, so a stalled day still reads stale.
 *     Power rows are GENERATING-UNIT rows (>= 500 MW), not sites: 10,125
 *     unit rows sat on 5,808 GEM locations on 2026-09-18.
 *
 *   nightlightsNight, nightlightsRows, nightlightsClearReadings
 *     the newest period in blackmarble_facility_radiance, its row count, and
 *     the rows that are cloud_confidence = 'confident_clear' AND carry a
 *     radiance retrieval — the same filter the globe's night-lights layer
 *     (/api/nightlights) plots.                  2026-09-09 · 10,412 · 5,193
 *     A row is a look at a registry row, not a site; confident-clear is not
 *     the same as observed until a retrieval exists (rev H §2.3).
 *
 * Every figure fails soft to null, rendered as "—" — never to a fallback
 * number. A missing env (CI builds with a placeholder project and no
 * service-role key) is a null, not a crash.
 */
export interface WatchedCoverage {
  refineriesWatched: number | null;
  refineriesRegistry: number | null;
  /** FIRMS region boxes in force — derived from FIRMS_REGIONS, never typed. */
  thermalRegionCount: number;
  thermalRegionLabels: string[];
  thermalDay: string | null;
  thermalRefineryRows: number | null;
  thermalPowerUnitRows: number | null;
  nightlightsNight: string | null;
  nightlightsRows: number | null;
  nightlightsClearReadings: number | null;
}

type SB = ReturnType<typeof createServerSupabase>;

const EMPTY: Omit<WatchedCoverage, 'thermalRegionCount' | 'thermalRegionLabels'> = {
  refineriesWatched: null,
  refineriesRegistry: null,
  thermalDay: null,
  thermalRefineryRows: null,
  thermalPowerUnitRows: null,
  nightlightsNight: null,
  nightlightsRows: null,
  nightlightsClearReadings: null,
};

function regionMeta() {
  return {
    thermalRegionCount: FIRMS_REGIONS.length,
    thermalRegionLabels: FIRMS_REGIONS.map((r) => r.label),
  };
}

/**
 * Crude-oil refineries only (refineries.site_type = 'refinery', migration
 * 168). Fails soft to null on any error — never to firms_rule_coverage, whose
 * count includes the re-typed non-refineries.
 */
async function refineryCoverage(admin: SB): Promise<{ watched: number | null; registry: number | null }> {
  try {
    const { data, error } = await admin.rpc('refinery_type_coverage', {
      p_regions: firmsRegionsAsJsonb(),
    });
    if (error) return { watched: null, registry: null };
    const row = (Array.isArray(data) ? data[0] : data) as
      | { watched_refineries?: number | string | null; registry_refineries?: number | string | null }
      | null
      | undefined;
    // Number(null) is 0, so a missing field must stay null, not read as zero.
    const toCount = (v: number | string | null | undefined): number | null => {
      if (v == null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    return {
      watched: toCount(row?.watched_refineries),
      registry: toCount(row?.registry_refineries),
    };
  } catch {
    return { watched: null, registry: null };
  }
}

/**
 * The thermal roster's refinery rows for one derived day, crude-oil
 * refineries only (refinery_roster_rows, migration 181). Fails soft to null —
 * never to the unfiltered refinery-tagged count, which is the figure this
 * replaced.
 */
async function refineryRosterRows(admin: SB, day: string): Promise<number | null> {
  try {
    const { data, error } = await admin.rpc('refinery_roster_rows', { p_period: day });
    if (error || data == null) return null;
    const n = Number(data);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

async function newestPeriod(admin: SB, table: string): Promise<string | null> {
  try {
    const { data, error } = await admin
      .from(table)
      .select('period')
      .order('period', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return null;
    return (data as { period?: string } | null)?.period ?? null;
  } catch {
    return null;
  }
}

async function headCount(
  admin: SB,
  table: string,
  filter: (q: any) => any,
): Promise<number | null> {
  try {
    const { count, error } = await filter(admin.from(table).select('*', { count: 'exact', head: true }));
    return error ? null : (count ?? null);
  } catch {
    return null;
  }
}

export async function loadWatchedCoverage(): Promise<WatchedCoverage> {
  let admin: SB;
  try {
    admin = createServerSupabase();
  } catch {
    return { ...EMPTY, ...regionMeta() };
  }

  const [ref, thermalDay, night] = await Promise.all([
    refineryCoverage(admin),
    newestPeriod(admin, 'firms_facility_observations'),
    newestPeriod(admin, 'blackmarble_facility_radiance'),
  ]);

  const [thermalRefineryRows, thermalPowerUnitRows, nightlightsRows, nightlightsClearReadings] =
    await Promise.all([
      thermalDay ? refineryRosterRows(admin, thermalDay) : Promise.resolve(null),
      thermalDay
        ? headCount(admin, 'firms_facility_observations', (q) =>
            q.eq('period', thermalDay).eq('facility_type', 'power_plant'))
        : Promise.resolve(null),
      night
        ? headCount(admin, 'blackmarble_facility_radiance', (q) => q.eq('period', night))
        : Promise.resolve(null),
      night
        ? headCount(admin, 'blackmarble_facility_radiance', (q) =>
            q.eq('period', night).eq('cloud_confidence', 'confident_clear').not('radiance', 'is', null))
        : Promise.resolve(null),
    ]);

  return {
    ...regionMeta(),
    refineriesWatched: ref.watched,
    refineriesRegistry: ref.registry,
    thermalDay,
    thermalRefineryRows,
    thermalPowerUnitRows,
    nightlightsNight: night,
    nightlightsRows,
    nightlightsClearReadings,
  };
}

const fmt = (n: number) => n.toLocaleString('en-US');

/**
 * The thermal coverage limit, as one sentence, for the agent-readable
 * surfaces (/llms.txt, /mcp). Figures come from the loader above; when a
 * figure is unavailable the sentence drops it rather than inventing one.
 *
 * This replaces "Coverage is 10,556 of 13,262 watched facilities — South
 * America, Africa and Oceania ... NO DATA": the pair counted generating-unit
 * ROWS as "facilities", and North Africa sits inside the Europe box.
 */
export function thermalCoverageSentence(c: WatchedCoverage): string {
  const boxes = `${c.thermalRegionCount} regional boxes (${c.thermalRegionLabels.join(', ')})`;
  const parts: string[] = [];
  if (c.refineriesWatched != null && c.refineriesRegistry != null) {
    parts.push(`${fmt(c.refineriesWatched)} of ${fmt(c.refineriesRegistry)} refineries`);
  }
  if (c.thermalPowerUnitRows != null) {
    parts.push(`${fmt(c.thermalPowerUnitRows)} power-plant unit rows of 500 MW and up (unit rows, not sites)`);
  }
  const watched = parts.length ? `Thermal watches ${parts.join(' and ')}, inside ${boxes}` : `Thermal ingest covers ${boxes}`;
  return (
    `${watched} — not global. A facility outside the boxes (most of Latin America, Africa and Oceania) ` +
    'has NO DATA, not zero.'
  );
}

// ─── AIS boxes ──────────────────────────────────────────────────────

/**
 * AIS coverage by box, from ais_box_liveness (migration 110): the configured
 * boxes by kind, the box carrying the most vessels, and every box with no fix
 * for more than 24 h. Measured 2026-09-18: 4 broad (Europe + Med, Asia-Pacific,
 * Americas Atlantic, Africa + Indian Ocean) + 6 chokepoints; Bab-el-Mandeb's
 * newest fix 2026-07-18, Hormuz's 2026-09-13.
 *
 * The copy this feeds said "chokepoint-only" — false since the 2026-08-24
 * step (~120x, to ~430k positions a day). Reading it from the liveness table
 * means the next recovery, or the next outage, changes the sentence without a
 * deploy.
 */
export interface AisBoxes {
  broad: number;
  chokepoint: number;
  densest: string | null;
  dead: Array<{ label: string; daysSince: number }>;
}

interface AisBoxRow {
  label: string;
  kind: string | null;
  newest_fix: string | null;
  vessels: number | string | null;
}

export function summariseAisBoxes(rows: AisBoxRow[], now = Date.now()): AisBoxes {
  return {
    broad: rows.filter((r) => r.kind === 'broad').length,
    chokepoint: rows.filter((r) => r.kind === 'chokepoint').length,
    densest:
      [...rows]
        .filter((r) => Number.isFinite(Number(r.vessels)) && Number(r.vessels) > 0)
        .sort((a, b) => Number(b.vessels) - Number(a.vessels))[0]?.label ?? null,
    dead: rows
      .filter((r) => r.newest_fix && now - new Date(r.newest_fix).getTime() > 24 * 3600_000)
      .map((r) => ({
        label: r.label,
        daysSince: Math.floor((now - new Date(r.newest_fix as string).getTime()) / 86_400_000),
      }))
      .sort((a, b) => b.daysSince - a.daysSince),
  };
}

export async function loadAisBoxes(): Promise<AisBoxes | null> {
  try {
    const admin = createServerSupabase();
    const { data, error } = await admin
      .from('ais_box_liveness')
      .select('label, kind, newest_fix, vessels')
      .order('label', { ascending: true });
    if (error || !data?.length) return null;
    return summariseAisBoxes(data as AisBoxRow[]);
  } catch {
    return null;
  }
}

/** The AIS limit as one sentence for /llms.txt and /mcp. */
export function aisCoverageSentence(b: AisBoxes | null): string {
  if (!b) {
    return 'regional boxes only, not global — per-box liveness could not be read just now, so treat an area with no vessels as unobserved, not empty.';
  }
  const dark = b.dead.length
    ? ` Dark right now: ${b.dead.map((d) => `${d.label} (${d.daysSince} days)`).join(', ')}.`
    : '';
  return (
    `${b.broad} broad regional boxes and ${b.chokepoint} chokepoints — not global, and density is uneven` +
    `${b.densest ? ` (densest: ${b.densest})` : ''}.${dark} ` +
    'An area with no vessels may be unobserved rather than empty.'
  );
}
