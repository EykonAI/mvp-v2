import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * Satellite imagery — globe layer feed (Imagery Layer IMG-2, mig 184).
 *
 * One point per watched AOI in the viewport that Sentinel-2 has looked at,
 * from imagery_latest():
 *   · the LATEST look, in whatever state it was — a cloudy week reads
 *     "cloudy on <date>", never an older clear chip passed off as current;
 *   · separately, the latest CLEAR look with its true-colour chip, its median
 *     NDVI and the AOI's own baseline (median of previous clear looks, only
 *     with n ≥ 3).
 *
 * ─── HONESTY INVARIANTS (carried into the payload) ───────────────────────
 * • A chip is what Sentinel-2 recorded on its acquisition day — never "now".
 * • The metric is a spectral proxy (median NDVI over clear pixels), never a
 *   tonnage, a volume or an activity claim.
 * • Only AOIs with a sensor switched on are imaged (today: curated mines).
 *   An AOI with no dot was not looked at — absence of a dot is absence of a
 *   look.
 * • Every item carries its credit: "Contains modified Copernicus Sentinel
 *   data <year>".
 */

const BUCKET = 'sentinel';

function num(v: string | null, fallback: number): number {
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const latMin = Math.max(-90, num(p.get('lat_min'), -90));
  const latMax = Math.min(90, num(p.get('lat_max'), 90));
  const lonMin = Math.max(-180, num(p.get('lon_min'), -180));
  const lonMax = Math.min(180, num(p.get('lon_max'), 180));

  try {
    const supabase = createServerSupabase();
    const { data, error } = await supabase.rpc('imagery_latest', {
      p_lon_min: lonMin,
      p_lat_min: latMin,
      p_lon_max: lonMax,
      p_lat_max: latMax,
      p_limit: 2000,
    });
    if (error) {
      return NextResponse.json({ error: `imagery_latest: ${error.message}` }, { status: 502 });
    }
    const items = ((data ?? []) as Array<Record<string, any>>).map(r => ({
      aoi_id: r.aoi_id,
      kind: r.kind,
      name: r.name,
      country: r.country_iso,
      latitude: r.latitude,
      longitude: r.longitude,
      latest_acquired_at: r.latest_acquired_at,
      latest_state: r.latest_state,
      latest_cloud_fraction: r.latest_cloud_fraction === null ? null : Number(r.latest_cloud_fraction),
      clear_acquired_at: r.clear_acquired_at,
      chip_url: r.clear_chip_path
        ? supabase.storage.from(BUCKET).getPublicUrl(r.clear_chip_path).data.publicUrl
        : null,
      metric_name: r.clear_metric_name,
      metric_value: r.clear_metric_value,
      baseline_median: r.clear_baseline_median,
      baseline_n: r.clear_baseline_n,
      attribution: r.attribution_text,
    }));
    return NextResponse.json({
      data: items,
      sensor: 'sentinel-2-l2a',
      bbox: { lat_min: latMin, lat_max: latMax, lon_min: lonMin, lon_max: lonMax },
      note:
        'Latest Sentinel-2 look per watched site, in its real state (clear / partly cloudy / cloudy / partial swath). ' +
        'Chips are from the latest CLEAR look and show that day, not now. The metric is median NDVI over clear pixels — ' +
        'a spectral change proxy, not a volume. Sites without a sensor switched on are not looked at.',
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'unknown' }, { status: 500 });
  }
}
