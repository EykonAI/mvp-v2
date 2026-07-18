import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import {
  FIRMS_REGIONS,
  FIRMS_SOURCES,
  fetchFirmsArea,
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
 * Requires: FIRMS_MAP_KEY (free — https://firms.modaps.eosdis.nasa.gov/api/map_key/)
 */

// Trailing window per fetch. 2 days (not 1) because FIRMS NRT lands
// ~3h behind and late-arriving detections backfill the previous day.
const INGEST_DAYS = 2;
const FACILITY_RADIUS_KM = 5;
const MIN_PLANT_MW = 500;

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

  for (const region of FIRMS_REGIONS) {
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
  const derived: Record<string, number> = {};
  let deriveFailed = false;
  for (const day of daysCovered) {
    const { data, error } = await supabase.rpc('firms_derive_facility_observations', {
      p_day: day,
      p_radius_km: FACILITY_RADIUS_KM,
      p_min_mw: MIN_PLANT_MW,
    });
    if (error) {
      deriveFailed = true;
      errors.push(`derive ${day}: ${error.message}`);
    } else {
      derived[day] = typeof data === 'number' ? data : 0;
    }
  }

  const allFailed = attempts > 0 && runs.every((r) => !r.ok);
  const ok = !allFailed && !deriveFailed;

  return NextResponse.json(
    {
      ok,
      fetched: totalFetched,
      upserted: totalUpserted,
      days: Array.from(daysCovered),
      derived,
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
