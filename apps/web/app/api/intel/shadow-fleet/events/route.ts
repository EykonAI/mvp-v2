import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { boxState, BOX_DEAD_AFTER_H, type BoxLiveness, type BoxState } from '@/lib/intel/aisCoverage';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * Dark-contact events (mig 112) — the resolvable observable behind the
 * Shadow Fleet workspace. Read-only; the lifecycle is owned entirely by the
 * hourly compute-shadow-fleet-scores cron.
 *
 * Resolution vocabulary, stated here because every consumer must repeat it:
 *   reappeared — the vessel was re-observed (a positive, feed-wide fact).
 *   still_dark — NOT RE-OBSERVED BY OUR COVERAGE within 72 h. A statement
 *                about the instrument's view, never "the transponder was off".
 *   void       — the origin box died while the event was open; the silence
 *                became unmeasurable and the event is neither a hit nor a miss.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const status = url.searchParams.get('status'); // open | resolved | void
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));

  try {
    const supabase = createServerSupabase();

    let q = supabase
      .from('dark_contact_events')
      .select('*')
      .order('opened_at', { ascending: false })
      .limit(limit);
    if (status) q = q.eq('status', status);

    const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
    const [events, openCount, reappeared24h, stillDark24h, void24h, liveness, clock] = await Promise.all([
      q,
      supabase.from('dark_contact_events').select('*', { count: 'exact', head: true }).eq('status', 'open'),
      supabase.from('dark_contact_events').select('*', { count: 'exact', head: true })
        .eq('resolution', 'reappeared').gte('closed_at', dayAgo),
      supabase.from('dark_contact_events').select('*', { count: 'exact', head: true })
        .eq('resolution', 'still_dark').gte('closed_at', dayAgo),
      supabase.from('dark_contact_events').select('*', { count: 'exact', head: true })
        .eq('status', 'void').gte('closed_at', dayAgo),
      supabase.from('ais_box_liveness').select('*'),
      supabase.from('vessel_positions').select('updated_at')
        .order('updated_at', { ascending: false }).limit(1).maybeSingle(),
    ]);

    // Per-box coverage, same shape as the leads route. Fails soft to null.
    let coverage: {
      boxes: Array<{ slug: string; label: string; kind: string; state: BoxState; newest_fix: string | null; fixes_last_hour: number; silent_hours: number | null }>;
      dead_boxes: number;
      box_dead_after_h: number;
    } | null = null;
    if (!liveness.error && liveness.data?.length) {
      const boxes = (liveness.data as BoxLiveness[]).map(r => ({
        slug: r.slug,
        label: r.label,
        kind: r.kind,
        state: boxState(r),
        newest_fix: r.newest_fix,
        fixes_last_hour: r.fixes_last_hour,
        silent_hours: r.newest_fix
          ? Math.round(((Date.now() - new Date(r.newest_fix).getTime()) / 3600_000) * 10) / 10
          : null,
      }));
      coverage = { boxes, dead_boxes: boxes.filter(b => b.state === 'dead').length, box_dead_after_h: BOX_DEAD_AFTER_H };
    }
    const dataClock = clock.data?.updated_at ?? null;

    if (events.error) {
      return NextResponse.json({ events: [], error: events.error.message }, { status: 200 });
    }

    return NextResponse.json({
      events: events.data ?? [],
      summary: {
        open: openCount.count ?? null,
        reappeared_24h: reappeared24h.count ?? null,
        still_dark_24h: stillDark24h.count ?? null,
        void_24h: void24h.count ?? null,
      },
      coverage,
      data_clock: dataClock,
      feed_lag_minutes: dataClock
        ? Math.max(0, Math.round((Date.now() - new Date(dataClock).getTime()) / 60_000))
        : null,
      deadline_hours: 72,
      note: 'still_dark means "not re-observed by eYKON AIS coverage within the deadline" — a statement about the instrument, not the transponder.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ events: [], error: message }, { status: 200 });
  }
}
