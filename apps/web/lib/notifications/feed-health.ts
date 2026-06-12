import type { SupabaseClient } from '@supabase/supabase-js';
import { BUCKET_TABLES, type DataBucket } from './tools';

// Feed-health probe for the self-healing suggestion library
// (honesty-pass v2). The /notif page calls getFeedHealth() server-
// side, derives the set of suggestion ids whose required buckets are
// empty/stale, and passes that set down to NotifShell which skips
// them when rendering. The moment a feed comes back online the
// matching suggestions reappear automatically — no library edit.
//
// Probe shape per bucket: one `count exact head:true` + one
// `max(recencyColumn)` per table. Twelve cheap queries total, cached
// per process for 5 minutes so a steady stream of /notif loads
// doesn't hammer Postgres.

export interface FeedStatus {
  bucket: DataBucket;
  table: string | null;
  hasData: boolean;
  lastIngest: string | null;
  ageHours: number | null;
  /** 'live' = ingest within 24h, 'stale' = older, 'empty' = 0 rows. */
  freshness: 'live' | 'stale' | 'empty';
}

export type FeedHealth = Record<DataBucket, FeedStatus>;

const LIVE_THRESHOLD_HOURS = 24;
const CACHE_TTL_MS = 5 * 60_000;

interface CacheEntry {
  fetchedAt: number;
  value: FeedHealth;
}

let cache: CacheEntry | null = null;

function classify(lastIngest: string | null, count: number): FeedStatus['freshness'] {
  if (count === 0) return 'empty';
  if (!lastIngest) return 'stale';
  const age = (Date.now() - new Date(lastIngest).getTime()) / 3_600_000;
  return age <= LIVE_THRESHOLD_HOURS ? 'live' : 'stale';
}

async function probeBucket(
  supabase: SupabaseClient,
  bucket: DataBucket,
): Promise<FeedStatus> {
  // Weather has no table; it's an on-demand Open-Meteo fetch, always
  // available as long as the rule has a region filter. Treat as live.
  if (bucket === 'Weather') {
    return {
      bucket,
      table: null,
      hasData: true,
      lastIngest: null,
      ageHours: null,
      freshness: 'live',
    };
  }
  const meta = BUCKET_TABLES.find(b => b.bucket === bucket);
  if (!meta) {
    return { bucket, table: null, hasData: false, lastIngest: null, ageHours: null, freshness: 'empty' };
  }
  // Two cheap queries in parallel: row count and most-recent timestamp.
  const [{ count }, recencyRes] = await Promise.all([
    supabase.from(meta.table).select('*', { count: 'exact', head: true }),
    supabase
      .from(meta.table)
      .select(meta.recencyColumn)
      .order(meta.recencyColumn, { ascending: false })
      .limit(1),
  ]);
  // Supabase JS infers the select-result type from the column-string
  // literal; with a runtime-string col the inference returns an opaque
  // shape, so cast through unknown to get a plain record.
  const recencyRows = ((recencyRes.data ?? []) as unknown) as Array<Record<string, unknown>>;
  const recencyRow = recencyRows[0];
  const lastIngestRaw = recencyRow ? recencyRow[meta.recencyColumn] : null;
  const lastIngest = typeof lastIngestRaw === 'string' ? lastIngestRaw : null;
  const ageHours = lastIngest
    ? (Date.now() - new Date(lastIngest).getTime()) / 3_600_000
    : null;
  return {
    bucket,
    table: meta.table,
    hasData: (count ?? 0) > 0,
    lastIngest,
    ageHours,
    freshness: classify(lastIngest, count ?? 0),
  };
}

/**
 * Probe every bucket's underlying table. Memoised in-process for
 * CACHE_TTL_MS to keep /notif page loads cheap; the cache is per
 * Next.js serverless instance, so cold starts pay the probe cost.
 *
 * Fail-open on any error: we'd rather show a dead card occasionally
 * than hide a live one during a transient DB blip.
 */
export async function getFeedHealth(supabase: SupabaseClient): Promise<FeedHealth> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache.value;

  try {
    const buckets = BUCKET_TABLES.map(b => b.bucket).concat('Weather' as DataBucket);
    const uniq = Array.from(new Set(buckets));
    const entries = await Promise.all(uniq.map(b => probeBucket(supabase, b)));
    const value = Object.fromEntries(entries.map(s => [s.bucket, s])) as FeedHealth;
    cache = { fetchedAt: now, value };
    return value;
  } catch {
    // Fail-open: treat every bucket as live so we don't hide anything
    // on a transient probe failure. Caller still gets a valid object.
    const allBuckets: DataBucket[] = BUCKET_TABLES.map(b => b.bucket as DataBucket).concat(['Weather']);
    const fallback: Partial<Record<DataBucket, FeedStatus>> = {};
    for (const b of allBuckets) {
      const meta = BUCKET_TABLES.find(t => t.bucket === b);
      fallback[b] = {
        bucket: b,
        table: meta?.table ?? null,
        hasData: true,
        lastIngest: null,
        ageHours: null,
        freshness: 'live',
      };
    }
    return fallback as FeedHealth;
  }
}

// ─── Region-aware vessel health (honesty-pass v3) ────────────────
//
// The bucket probe above is FEED-granular: vessel_positions as a whole
// is hot (Europe/Med + Asia-Pacific coverage), so every Maritime
// suggestion passed the gate even when the specific strait it names
// has zero AIS coverage (e.g. Hormuz: 0 fresh vessels, while Malacca
// sees hundreds/day). Result: region-scoped AIS suggestions that could
// NEVER fire stayed visible — worse than no suggestion.
//
// This probe is REGION-granular: per geo_regions slug, count how many
// of the most recent in-region vessel rows are <24h old, via the
// recent_vessels_in_region RPC (migration 042, polygon ST_Intersects).
// 'cold' regions get their AIS-dependent suggestions hidden by
// computeHiddenSuggestionIds — and self-heal the moment a data source
// covering that region comes online, same philosophy as the bucket
// gate. Same 5-min cache, same fail-open posture.

export interface RegionVesselStatus {
  slug: string;
  /** Fresh (<24h) rows among the latest REGION_PROBE_LIMIT in-region
   *  rows; -1 = probe failed (treated as live, fail-open). */
  freshRows24h: number;
  freshness: 'live' | 'cold';
}

export type RegionVesselHealth = Record<string, RegionVesselStatus>;

// 10 fresh rows/24h cleanly separates zero-coverage regions (Hormuz,
// Red Sea: 0/day on the current AIS feed) from thinly-but-genuinely
// covered ones (Panama ~20/day, Bosphorus ~40/day, Malacca ~280/day).
const REGION_LIVE_MIN_ROWS_24H = 10;
const REGION_PROBE_LIMIT = 25;

let regionCache: { fetchedAt: number; key: string; value: RegionVesselHealth } | null = null;

async function probeRegion(
  supabase: SupabaseClient,
  slug: string,
): Promise<RegionVesselStatus> {
  try {
    const { data, error } = await supabase.rpc('recent_vessels_in_region', {
      p_region_slug: slug,
      p_limit: REGION_PROBE_LIMIT,
    });
    if (error) throw new Error(error.message);
    const rows = ((data ?? []) as unknown) as Array<Record<string, unknown>>;
    const cutoff = Date.now() - LIVE_THRESHOLD_HOURS * 3_600_000;
    const fresh = rows.filter(r => {
      const ts = typeof r.ingested_at === 'string' ? Date.parse(r.ingested_at) : NaN;
      return Number.isFinite(ts) && ts >= cutoff;
    }).length;
    return {
      slug,
      freshRows24h: fresh,
      freshness: fresh >= REGION_LIVE_MIN_ROWS_24H ? 'live' : 'cold',
    };
  } catch {
    // Fail-open: a transient RPC error must not hide live suggestions.
    return { slug, freshRows24h: -1, freshness: 'live' };
  }
}

/**
 * Probe AIS freshness for the given geo_regions slugs. Memoised
 * in-process for CACHE_TTL_MS (keyed on the slug set) — the slug list
 * comes from the suggestion library and only changes on deploy.
 */
export async function getRegionVesselHealth(
  supabase: SupabaseClient,
  slugs: string[],
): Promise<RegionVesselHealth> {
  const uniq = Array.from(new Set(slugs)).sort();
  if (uniq.length === 0) return {};
  const key = uniq.join(',');
  const now = Date.now();
  if (regionCache && regionCache.key === key && now - regionCache.fetchedAt < CACHE_TTL_MS) {
    return regionCache.value;
  }
  const entries = await Promise.all(uniq.map(s => probeRegion(supabase, s)));
  const value = Object.fromEntries(entries.map(e => [e.slug, e])) as RegionVesselHealth;
  regionCache = { fetchedAt: now, key, value };
  return value;
}

/** Test hook — clears the in-process cache. Not exported for runtime. */
export function _resetFeedHealthCacheForTests(): void {
  cache = null;
  regionCache = null;
}
