import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import {
  FIRMS_REGIONS,
  FIRMS_SOURCES,
  fetchFirmsArea,
  firmsRegionsAsJsonb,
  resolveFirmsRegions,
  type FirmsDetection,
} from '@/lib/firms/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * NASA FIRMS active-fire ingest · hourly.
 *
 * For each region × NRT product, pulls the trailing INGEST_DAYS window
 * and upserts detections into firms_thermal_anomalies, then derives the
 * per-facility daily rollup (firms_facility_observations) via the
 * firms_derive_facility_observations RPC.
 *
 * Two design points that matter for correctness downstream:
 *
 *  1. Every attempt writes a firms_ingest_runs row — success OR failure.
 *     The resolver requires a successful run covering a day before it
 *     will score that day, which is what keeps "no thermal anomaly was
 *     detected" distinguishable from "the ingest never ran". Without
 *     this the platform would confidently score wrong answers whenever
 *     a cron tick was missed.
 *
 *  2. Per region×source isolation: one failing combination is recorded
 *     in errors[] and does not block the rest; ok=false only when every
 *     combination failed.
 *
 * ─── Sharding ────────────────────────────────────────────────────
 * `?region=<slug>` or `?region=<slug>,<slug>` restricts the fetch to
 * those regions. Omitted = all of them, so the existing Railway
 * command keeps working verbatim. Unknown slugs 400 rather than
 * silently ingesting nothing.
 *
 * Shard when a region gets heavy enough to threaten the client's
 * `curl --max-time 110` — that timeout, not maxDuration, is what
 * actually bounds this route. One Railway cron service per shard means
 * a slow or failing region cannot starve the others.
 *
 *   cron-ingest-firms-ruua    ...?region=ru-ua
 *   cron-ingest-firms-rest    ...?region=gulf,europe
 *
 * `?derive=0` additionally skips the rollup for a shard that cannot
 * afford it inside the budget.
 *
 * ─── Volume control ──────────────────────────────────────────────
 * Every detection is written, then tagged facility_proximate (within
 * PROXIMITY_RADIUS_KM of a monitored facility), then pruned on two
 * tiers: raw rows briefly, facility-proximate rows for a year. The
 * globe layer draws raw detections and so must keep a short raw
 * window; the analytical pipeline only ever cares about the proximate
 * subset, which on production measurement is ~9% of the total. See
 * migration 086.
 *
 * Requires: FIRMS_MAP_KEY (free — https://firms.modaps.eosdis.nasa.gov/api/map_key/)
 * Optional: FIRMS_PROXIMITY_KM, FIRMS_RAW_RETENTION_DAYS,
 *           FIRMS_PROXIMATE_RETENTION_DAYS
 */

// Trailing window per fetch. 2 days (not 1) because FIRMS NRT lands
// ~3h behind and late-arriving detections backfill the previous day.
const INGEST_DAYS = 2;
const FACILITY_RADIUS_KM = 5;
const MIN_PLANT_MW = 500;

// Ingest-side proximity radius. DELIBERATELY WIDER than the 5 km
// rollup radius above, because tagging is destructive and the rollup
// is not: a detection dropped here can never be recovered, whereas
// the rollup re-derives from whatever is still in the table. The gap
// buys back four sources of error that would otherwise silently eat
// real signal at the rollup boundary:
//
//   1. Pixel geolocation. We store the pixel CENTRE. VIIRS is 375 m
//      at nadir but grows past 800 m at scan edge; MODIS is 1 km at
//      nadir and up to ~4.8 km across-track at the swath edge. A
//      pixel whose footprint covers a facility can have its centre
//      kilometres away.
//   2. Facility geometry. refineries/power_plants carry a single
//      point (OSM node, GEM centroid). Real refineries are 2–5 km
//      across, so the fence line is well outside the recorded point.
//   3. FACILITY_RADIUS_KM is a tunable parameter. Raising it later
//      must not require a re-ingest of data we already threw away.
//   4. New facilities. A refinery added to the table next month
//      should have usable history around it.
//
// 8 km = the 5 km rollup radius plus ~3 km of slack, and costs little:
// measured on production 2026-07-18, widening 5 km → 8 km retains
// 1,038 rather than 770 of 11,746 detections (8.8% vs 6.6%).
const PROXIMITY_RADIUS_KM = Number(process.env.FIRMS_PROXIMITY_KM ?? 8);

// Two-tier retention. See migration 086 §5 for what is deleted and
// what is kept forever.
//
// Raw (non-proximate) rows exist only to draw the globe layer, whose
// default window is 48 h — 3 days clears it with a margin for NRT
// lag. Set FIRMS_RAW_RETENTION_DAYS=0 to get hard discard-at-ingest:
// the prune then runs in the same request that wrote the rows, so
// non-proximate detections never outlive the tick. That is the knob
// to turn once the globe has another source. It is NOT the default,
// because turning it on today empties the globe.
const RAW_RETENTION_DAYS = Number(process.env.FIRMS_RAW_RETENTION_DAYS ?? 3);
const PROXIMATE_RETENTION_DAYS = Number(process.env.FIRMS_PROXIMATE_RETENTION_DAYS ?? 365);

interface RunRecord {
  region: string;
  satellite: string;
  day_covered: string;
  rows_fetched: number;
  rows_upserted: number;
  ok: boolean;
  error: string | null;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function handle(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const mapKey = process.env.FIRMS_MAP_KEY;
  if (!mapKey) {
    return NextResponse.json(
      { ok: false, error: 'FIRMS_MAP_KEY not configured on the server' },
      { status: 500 },
    );
  }

  // ─── Sharding ────────────────────────────────────────────────
  // `?region=ru-ua` or `?region=ru-ua,gulf`. Absent = every region,
  // so the existing Railway command is untouched. The point of the
  // shard is blast radius: one heavy or failing region must not take
  // the others down with it, and the binding constraint is the
  // client's `curl --max-time 110`, not maxDuration — Railway kills
  // the connection at 110s regardless of what Next.js is willing to
  // wait for.
  const { regions, unknown } = resolveFirmsRegions(req.nextUrl.searchParams.get('region'));
  if (unknown.length > 0) {
    // Fail loudly. A typo'd slug that silently ingested nothing would
    // still write run records elsewhere and read as healthy.
    return NextResponse.json(
      {
        ok: false,
        error: `Unknown FIRMS region slug(s): ${unknown.join(', ')}`,
        known_regions: FIRMS_REGIONS.map((r) => r.slug),
      },
      { status: 400 },
    );
  }

  // Escape valve for a shard that cannot afford the rollup inside the
  // 110s budget. `?derive=0` ingests and tags only; the next tick of
  // any shard re-derives, because the rollup is a full recompute per
  // day rather than an increment.
  const runDerive = req.nextUrl.searchParams.get('derive') !== '0';

  const supabase = createServerSupabase();
  const errors: string[] = [];
  const runs: RunRecord[] = [];
  let totalFetched = 0;
  let totalUpserted = 0;
  let attempts = 0;

  const today = new Date();
  const daysCovered = new Set<string>();
  for (let i = 0; i < INGEST_DAYS; i++) {
    daysCovered.add(ymd(new Date(today.getTime() - i * 86_400_000)));
  }

  for (const region of regions) {
    for (const source of FIRMS_SOURCES) {
      attempts++;
      let detections: FirmsDetection[] = [];
      try {
        detections = await fetchFirmsArea(mapKey, source, region, INGEST_DAYS);
        totalFetched += detections.length;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(msg);
        for (const day of daysCovered) {
          runs.push({
            region: region.slug,
            satellite: source,
            day_covered: day,
            rows_fetched: 0,
            rows_upserted: 0,
            ok: false,
            error: msg.slice(0, 500),
          });
        }
        continue;
      }

      let upserted = 0;
      if (detections.length > 0) {
        // Chunked so a large fire day cannot blow the request size.
        const CHUNK = 500;
        for (let i = 0; i < detections.length; i += CHUNK) {
          const slice = detections.slice(i, i + CHUNK);
          const { error } = await supabase
            .from('firms_thermal_anomalies')
            .upsert(slice, {
              onConflict: 'satellite,acq_date,acq_time,latitude,longitude',
              ignoreDuplicates: false,
            });
          if (error) {
            errors.push(`upsert ${region.slug}/${source}: ${error.message}`);
          } else {
            upserted += slice.length;
          }
        }
        totalUpserted += upserted;
      }

      // Only the days this fetch actually spanned are marked covered.
      const fetchedDays = new Set(detections.map((d) => d.acq_date));
      const marked = fetchedDays.size > 0 ? fetchedDays : daysCovered;
      for (const day of marked) {
        runs.push({
          region: region.slug,
          satellite: source,
          day_covered: day,
          rows_fetched: detections.filter((d) => d.acq_date === day).length,
          rows_upserted: upserted,
          ok: true,
          error: null,
        });
      }
    }
  }

  if (runs.length > 0) {
    const { error } = await supabase
      .from('firms_ingest_runs')
      .upsert(runs, { onConflict: 'region,satellite,day_covered' });
    if (error) errors.push(`ingest_runs: ${error.message}`);
  }

  // Derive the facility rollup for every day this run touched.
  //
  // A derive failure is NOT cosmetic: without it the observable
  // family has no rows and nothing downstream can resolve, even
  // though detections landed fine. It must therefore fail the whole
  // run — an earlier version returned ok:true here, so Railway
  // reported "Last run succeeded" for hours while the rollup was
  // silently timing out and firms_facility_observations stayed empty.
  // ─── Proximity tagging ───────────────────────────────────────
  // Runs BEFORE the derive and before the prune. Tags only rows still
  // NULL, so it is cheap and idempotent. A tagging failure is fatal to
  // the run: leaving rows untagged would make the prune's tier
  // assignment meaningless, and a green cron over an untagged table is
  // exactly the "looks alive but isn't" failure we keep paying for.
  const oldestDay = Array.from(daysCovered).sort()[0];
  let tagged = 0;
  let tagFailed = false;
  {
    const { data, error } = await supabase.rpc('firms_tag_facility_proximity', {
      p_since: oldestDay,
      p_radius_km: PROXIMITY_RADIUS_KM,
      p_min_mw: MIN_PLANT_MW,
      // NO p_regions here, deliberately. Tagging asks one question —
      // "is this detection near a monitored facility?" — and that is
      // a property of the detection, not of our coverage. Coverage
      // restriction belongs in the ROLLUP (085), which is where it
      // lives; duplicating it here would be a second place to keep in
      // sync for no benefit.
      //
      // Region-agnostic tagging is also strictly better for retention:
      // if FIRMS_REGIONS widens later, detections already ingested
      // near a newly-covered facility are already tagged, so they
      // survive the raw-tier prune instead of being discarded as
      // noise and lost before the region goes live.
      //
      // (An earlier revision passed p_regions here against a 3-arg
      // function, which 500'd every run: "Could not find the function
      // ...(p_min_mw, p_radius_km, p_regions, p_since)".)
    });
    if (error) {
      tagFailed = true;
      errors.push(`tag: ${error.message}`);
    } else {
      tagged = typeof data === 'number' ? data : 0;
    }
  }

  // ─── Facility rollup ─────────────────────────────────────────
  // p_regions gets the FULL FIRMS_REGIONS set, NOT this shard's subset.
  // That is deliberate, and it is the subtle part of sharding:
  //
  //  • A row in firms_facility_observations asserts "this facility was
  //    WATCHED on this day". Watched-ness is a property of the union of
  //    every shard that ran, not of whichever shard happens to be
  //    calling. Passing only this shard's bboxes would make the
  //    assertion depend on invocation order.
  //  • The rollup counts detections near a facility regardless of which
  //    region's fetch delivered them, and bboxes abut (ru-ua and europe
  //    share the 22E meridian). A facility on a seam is legitimately hit
  //    by detections a neighbouring shard ingested; scoping the derive
  //    to one shard would leave those uncounted until that shard's own
  //    next tick.
  //  • It is an upsert and a full recompute per day, so recomputing
  //    every facility from every shard is idempotent and self-healing
  //    rather than wasteful duplication.
  //
  // With 085 applied, omitting p_regions writes ZERO rows — the RPC
  // fails closed. This call is the only thing standing between the
  // rollup and silently producing nothing.
  const regionsJson = firmsRegionsAsJsonb(FIRMS_REGIONS);

  const derived: Record<string, number> = {};
  let deriveFailed = false;
  if (runDerive) {
    for (const day of daysCovered) {
      const { data, error } = await supabase.rpc('firms_derive_facility_observations', {
        p_day: day,
        p_radius_km: FACILITY_RADIUS_KM,
        p_min_mw: MIN_PLANT_MW,
        p_regions: regionsJson,
      });
      if (error) {
        deriveFailed = true;
        errors.push(`derive ${day}: ${error.message}`);
        continue;
      }
      derived[day] = typeof data === 'number' ? data : 0;

      // Significance detection deliberately does NOT run here.
      //
      // It was called inline while nothing else owned it, but #290
      // added /api/cron/detect-firms-significance as its own cron.
      // Keeping the inline call would run it once per SHARD per hour
      // against the same 110s curl budget this route is being split
      // up to protect — redundant work on an idempotent upsert.
      //
      // Scheduling requirement: run the significance cron AFTER the
      // ingest cron. It is idempotent and hourly, so a tick that
      // lands early recomputes correctly on the next pass.
    }
  }

  // ─── Retention ───────────────────────────────────────────────
  // Last, so a prune failure can never cost us an ingest. Non-fatal
  // for the same reason: unbounded growth is a slow problem, a failed
  // ingest is an immediate one.
  let pruned: unknown = null;
  {
    const { data, error } = await supabase.rpc('firms_prune_thermal_anomalies', {
      p_raw_days: RAW_RETENTION_DAYS,
      p_proximate_days: PROXIMATE_RETENTION_DAYS,
      p_radius_km: PROXIMITY_RADIUS_KM,
      p_min_mw: MIN_PLANT_MW,
    });
    if (error) errors.push(`prune: ${error.message}`);
    else pruned = data ?? null;
  }

  const allFailed = attempts > 0 && runs.every((r) => !r.ok);
  const ok = !allFailed && !deriveFailed && !tagFailed;

  return NextResponse.json(
    {
      ok,
      regions: regions.map((r) => r.slug),
      sharded: regions.length !== FIRMS_REGIONS.length,
      fetched: totalFetched,
      upserted: totalUpserted,
      tagged,
      days: Array.from(daysCovered),
      derived,
      pruned,
      errors: errors.slice(0, 10),
    },
    // Non-2xx so `curl -fsS` exits non-zero and Railway marks the run
    // failed, rather than reporting green on a broken pipeline.
    { status: ok ? 200 : 500 },
  );
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
