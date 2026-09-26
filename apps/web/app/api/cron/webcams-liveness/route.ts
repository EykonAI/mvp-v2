import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { fetchCameraImage, STALE_HOURS } from '@/lib/webcams/fetch-image';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 300;

/**
 * Webcam liveness · hourly (Imagery Layer IMG-5, mig 187).
 *
 * Fetches the real image of the least-recently-checked cameras (default
 * 600 per run, 8 at a time) and records each fetch through
 * webcam_record_liveness(): a camera is live only when its newest fetch is an
 * image whose bytes differ from the previous good fetch and whose
 * Last-Modified is within 24 h. Frozen, failed and timed-out cameras are
 * hidden. At ~5,700 wave-1 cameras, 600 an hour re-checks each about every
 * 10 hours; nothing is stored but a hash and a size.
 *
 * Fails loud: a database error → 502. Upstream failures are data (they hide
 * a camera), not a failed run — unless EVERY fetch failed, which means the
 * checker, not the cameras, is broken → 502.
 */
const VERSION = 'webcams-liveness-v1';
const CONCURRENCY = 8;

async function handle(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;
  const limit = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get('limit') || '600') || 600, 1), 2000);
  const supabase = createServerSupabase();
  const startedAt = Date.now();

  const { data: due, error: dueErr } = await supabase.rpc('webcam_liveness_due', { p_limit: limit });
  if (dueErr) return NextResponse.json({ ok: false, version: VERSION, error: `webcam_liveness_due: ${dueErr.message}` }, { status: 502 });
  const cams = (due ?? []) as Array<{ webcam_id: string; provider_id: string; upstream_url: string }>;

  const rows: Array<Record<string, unknown>> = [];
  let next = 0;
  async function worker() {
    while (next < cams.length) {
      const cam = cams[next++];
      const f = await fetchCameraImage(cam.upstream_url);
      rows.push({
        webcam_id: cam.webcam_id,
        checked_at: new Date().toISOString(),
        outcome: f.outcome,
        http_status: f.httpStatus,
        bytes_len: f.bytes?.length ?? null,
        bytes_sha256: f.sha256,
      });
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, cams.length) }, worker));

  const summary = { recorded: 0, live: 0, frozen: 0, failed: 0 };
  for (let i = 0; i < rows.length; i += 200) {
    const { data, error } = await supabase.rpc('webcam_record_liveness', { p_rows: rows.slice(i, i + 200) });
    if (error) return NextResponse.json({ ok: false, version: VERSION, error: `webcam_record_liveness: ${error.message}`, summary }, { status: 502 });
    const s = (data as any[])?.[0] ?? {};
    summary.recorded += s.recorded ?? 0; summary.live += s.live ?? 0; summary.frozen += s.frozen ?? 0; summary.failed += s.failed ?? 0;
  }

  const byOutcome = rows.reduce<Record<string, number>>((a, r) => ((a[String(r.outcome)] = (a[String(r.outcome)] ?? 0) + 1), a), {});
  const allFailed = rows.length > 0 && summary.live === 0 && summary.frozen === 0;
  return NextResponse.json(
    { ok: !allFailed, version: VERSION, stale_hours: STALE_HOURS, checked: rows.length, summary, by_outcome: byOutcome,
      elapsed_ms: Date.now() - startedAt, ...(allFailed ? { error: 'every fetch failed — the checker, not the cameras, is broken' } : {}) },
    { status: allFailed ? 502 : 200 },
  );
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
