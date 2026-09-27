import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * Webcams — globe layer feed (Imagery Layer IMG-5, mig 187).
 *
 * LIVE cameras in the viewport, from webcams_in_bbox(), which never returns
 * an upstream URL: the image is fetched through /api/webcams/<id>/image.
 *
 * ─── HONESTY INVARIANTS (carried into the payload) ───────────────────────
 * • A frame is a picture from a third party's camera at the time the
 *   operator stamped — eYKON asserts nothing about it beyond place, time and
 *   source. No recognition of any kind is run on it, and nothing is recorded.
 * • Only cameras whose latest check returned a fresh, changing image are
 *   shown; a frozen or failing camera is hidden, never shown as current.
 * • Every item carries its operator's credit.
 */
function num(v: string | null, d: number) { const n = v === null ? NaN : Number(v); return Number.isFinite(n) ? n : d; }

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  try {
    const supabase = createServerSupabase();
    const { data, error } = await supabase.rpc('webcams_in_bbox', {
      p_lon_min: Math.max(-180, num(p.get('lon_min'), -180)), p_lat_min: Math.max(-90, num(p.get('lat_min'), -90)),
      p_lon_max: Math.min(180, num(p.get('lon_max'), 180)), p_lat_max: Math.min(90, num(p.get('lat_max'), 90)),
      p_limit: 3000,
    });
    if (error) return NextResponse.json({ error: `webcams_in_bbox: ${error.message}` }, { status: 502 });
    return NextResponse.json({
      data: (data ?? []).map((r: any) => ({ ...r, image_url: `/api/webcams/${r.webcam_id}/image` })),
      note: 'Live public cameras (government operators). A frame shows the time its operator stamped, not now. No recognition, no recording.',
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'unknown' }, { status: 500 });
  }
}
