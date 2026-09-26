import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { fetchCameraImage } from '@/lib/webcams/fetch-image';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One camera's current frame, proxied (Imagery Layer IMG-5).
 *
 * The client knows only an opaque id (wc_ + 16 hex). The upstream URL is
 * resolved server-side by webcam_upstream(), which answers for LIVE cameras
 * under an 'ok' licence only — so nothing about the upstream reaches the
 * browser, and a hidden camera cannot be fetched through eYKON. The frame is
 * served only if it is an image and not stale; it is cached at the edge for
 * 60 s (operators refresh every 1–5 min), never stored.
 *
 * Headers: X-Image-Time = the operator's Last-Modified; X-Attribution = the
 * operator's credit.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!/^wc_[0-9a-f]{16}$/.test(params.id)) return NextResponse.json({ error: 'unknown camera' }, { status: 404 });
  const supabase = createServerSupabase();
  const { data, error } = await supabase.rpc('webcam_upstream', { p_webcam_id: params.id });
  if (error) return NextResponse.json({ error: 'lookup failed' }, { status: 502 });
  const cam = (data as any[])?.[0];
  if (!cam) return NextResponse.json({ error: 'camera not live' }, { status: 404 });

  const f = await fetchCameraImage(cam.upstream_url);
  if (f.outcome !== 'ok' || !f.bytes || !f.contentType) {
    // Not served as current: the next liveness check will hide the camera.
    return NextResponse.json({ error: `camera ${f.outcome}` }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  return new NextResponse(new Uint8Array(f.bytes), {
    status: 200,
    headers: {
      'Content-Type': f.contentType,
      'Cache-Control': 'public, max-age=60, s-maxage=60',
      'X-Content-Type-Options': 'nosniff',
      ...(f.lastModified ? { 'X-Image-Time': f.lastModified } : {}),
      'X-Attribution': encodeURIComponent(String(cam.attribution_text ?? '')),
    },
  });
}
