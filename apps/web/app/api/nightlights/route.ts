import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Night-lights (VIIRS Black Marble) — globe layer feed.
 *
 * Serves the most recent processed night of per-facility radiance from
 * `blackmarble_facility_radiance` (migration 091), plus the last week of
 * significance events from `nightlights_significant_events` (092), with
 * coordinates joined in from `firms_monitored_facilities` — the radiance
 * table deliberately carries no lat/lon (the facility registry is the
 * single source of coordinates; see 091).
 *
 * ─── HONESTY INVARIANTS (from 091/092 — carried into the payload) ─────
 * • Radiance is NOT power state, and a dot is a MEASUREMENT of emitted
 *   visible light on a confidently-clear night — never a claim about
 *   operations, outages or events. Attribution is inference.
 * • Only `confident_clear` readings are served. Cloud scatters city
 *   light back at the sensor (measured: cloudy readings averaged ~3,010
 *   vs 29.6 nW·cm⁻²·sr⁻¹ clear) — rendering cloudy pixels would fake
 *   surges. A facility that was cloudy simply has no dot tonight;
 *   absence of a dot is absence of a LOOK, never darkness.
 * • Events (went_dark_lights / surge / first_light) are departures from
 *   the facility's OWN clear-night baseline, and remain inferences.
 * • Coverage = FIRMS-watched facilities (the 84-tile ingest footprint),
 *   not the planet. VNP46A2 publishes ~3–4 days behind realtime; the
 *   served `night` states exactly what is on screen.
 */

const DEFAULT_LIMIT = 8000;
const MAX_LIMIT = 12000;
const EVENT_WINDOW_DAYS = 7;

interface CoordRow {
  facility_type: string;
  facility_id: string | number;
  facility_name: string | null;
  facility_country: string | null;
  latitude: number | null;
  longitude: number | null;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const limit = Math.min(
      parseInt(params.get('limit') || String(DEFAULT_LIMIT)) || DEFAULT_LIMIT,
      MAX_LIMIT,
    );
    const supabase = createServerSupabase();

    // 1 · Newest processed night. Rows exist iff a tile was processed
    //     (091's coverage-by-construction), so max(period) is the newest
    //     night with any real data — possibly partial while NASA is still
    //     publishing tiles; `night` in the payload says which it is.
    const { data: latestRow, error: latestErr } = await supabase
      .from('blackmarble_facility_radiance')
      .select('period')
      .order('period', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestErr) {
      return NextResponse.json({ error: `Supabase error: ${latestErr.message}` }, { status: 502 });
    }
    const night: string | null = (latestRow as { period?: string } | null)?.period ?? null;

    // 2 · That night's usable readings: confident-clear only (the gate),
    //     brightest first so a cap keeps the most informative points.
    let radRows: any[] = [];
    if (night) {
      const { data, error } = await supabase
        .from('blackmarble_facility_radiance')
        .select('facility_type,facility_id,facility_name,country,period,radiance,radiance_3x3,px_hq_3x3,cloud_confidence')
        .eq('period', night)
        .eq('cloud_confidence', 'confident_clear')
        .not('radiance', 'is', null)
        .order('radiance', { ascending: false })
        .limit(limit);
      if (error) {
        return NextResponse.json({ error: `Supabase error: ${error.message}` }, { status: 502 });
      }
      radRows = data ?? [];
    }

    // 3 · Recent significance events (they carry their own period, so they
    //     render even when their facility is cloudy tonight).
    const sinceEvents = ymd(new Date(Date.now() - EVENT_WINDOW_DAYS * 86_400_000));
    const { data: eventRows, error: evErr } = await supabase
      .from('nightlights_significant_events')
      .select('facility_type,facility_id,facility_name,country,period,event_type,observed_radiance,baseline_mean,deviation_sigma,dark_nights')
      .gte('period', sinceEvents)
      .order('period', { ascending: false })
      .limit(2000);
    if (evErr) {
      return NextResponse.json({ error: `Supabase error: ${evErr.message}` }, { status: 502 });
    }

    // 4 · Coordinates, PAGED. The registry view is ~13k rows and PostgREST
    //     caps an unpaged response at ~1,000 — an unpaged read silently
    //     returns a fraction, the join then misses, and the layer renders a
    //     healthy-looking 18% of the data (measured: 756 of 4,234 points,
    //     with the rest counted as skipped_no_geo). Page explicitly, and
    //     surface any shortfall in the payload rather than hiding it.
    const PAGE = 1000;
    const coords = new Map<string, CoordRow>();
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await supabase
        .from('firms_monitored_facilities')
        .select('facility_type,facility_id,facility_name,facility_country,latitude,longitude')
        .range(offset, offset + PAGE - 1);
      if (error) {
        return NextResponse.json({ error: `Supabase error: ${error.message}` }, { status: 502 });
      }
      const page = (data ?? []) as CoordRow[];
      for (const c of page) coords.set(`${c.facility_type}|${c.facility_id}`, c);
      if (page.length < PAGE) break;
      // Hard stop: the registry is ~13k rows; 40k means something is wrong
      // upstream and we should not spin forever.
      if (offset > 40_000) break;
    }

    // Optional viewport bbox (same snake_case contract as /api/firms).
    const latMin = parseFloat(params.get('lat_min') ?? '-90');
    const latMax = parseFloat(params.get('lat_max') ?? '90');
    const lonMin = parseFloat(params.get('lon_min') ?? '-180');
    const lonMax = parseFloat(params.get('lon_max') ?? '180');
    const inBbox = (lat: number, lon: number) =>
      lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax;

    let skippedNoGeo = 0;

    const eventKeys = new Set(
      (eventRows ?? []).map((e: any) => `${e.facility_type}|${e.facility_id}`),
    );

    // Radiance points (facilities with a recent event are emitted from the
    // event list instead, so a facility never renders twice).
    const points: any[] = [];
    for (const r of radRows) {
      const key = `${r.facility_type}|${r.facility_id}`;
      if (eventKeys.has(key)) continue;
      const c = coords.get(key);
      if (!c || !Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) {
        skippedNoGeo++;
        continue;
      }
      if (!inBbox(c.latitude as number, c.longitude as number)) continue;
      points.push({
        id: key,
        latitude: c.latitude,
        longitude: c.longitude,
        facility_name: r.facility_name ?? c.facility_name,
        country: r.country ?? c.facility_country,
        period: r.period,
        radiance: r.radiance != null ? Number(r.radiance) : null,
        radiance_3x3: r.radiance_3x3 != null ? Number(r.radiance_3x3) : null,
        px_hq_3x3: r.px_hq_3x3 ?? null,
        cloud_confidence: r.cloud_confidence,
        event_type: null,
      });
    }

    for (const e of (eventRows ?? []) as any[]) {
      const key = `${e.facility_type}|${e.facility_id}`;
      const c = coords.get(key);
      if (!c || !Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) {
        skippedNoGeo++;
        continue;
      }
      if (!inBbox(c.latitude as number, c.longitude as number)) continue;
      points.push({
        id: `${key}|${e.period}|${e.event_type}`,
        latitude: c.latitude,
        longitude: c.longitude,
        facility_name: e.facility_name ?? c.facility_name,
        country: e.country ?? c.facility_country,
        period: e.period,
        radiance: e.observed_radiance != null ? Number(e.observed_radiance) : null,
        radiance_3x3: null,
        px_hq_3x3: null,
        cloud_confidence: 'confident_clear', // 092 judges on clear nights only
        event_type: e.event_type,
        baseline_mean: e.baseline_mean != null ? Number(e.baseline_mean) : null,
        deviation_sigma: e.deviation_sigma != null ? Number(e.deviation_sigma) : null,
        dark_nights: e.dark_nights ?? null,
      });
    }

    return NextResponse.json({
      count: points.length,
      timestamp: new Date().toISOString(),
      provider: 'supabase',
      source: 'NASA VIIRS Black Marble (VNP46A2 v2, nightly, moonlight/atmosphere-corrected)',
      // The night on screen. VNP46A2 lags ~3–4 days; this is the newest
      // processed night, which can still be partially published by NASA.
      night,
      event_window_days: EVENT_WINDOW_DAYS,
      truncated: radRows.length >= limit,
      // Facilities whose coordinates were not found in the registry view.
      // Should be ~0; a large number means the coordinate read is
      // under-serving (the PostgREST 1,000-row cap) and the layer is
      // rendering a fraction of the data while looking healthy.
      skipped_no_geo: skippedNoGeo,
      facilities_indexed: coords.size,
      // Shipped with the payload so no consumer can render this feed
      // without the caveat being available to it (same contract as /api/firms).
      caveat:
        'Emitted visible light measured from orbit on confidently-clear nights, ' +
        'at FIRMS-watched facilities only — not power state, not an outage claim. ' +
        'Cloudy facilities have no reading (absence of a dot is absence of a look, ' +
        'never darkness). Events are departures from a facility\'s own clear-night ' +
        'baseline and remain inferences.',
      data: points,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
