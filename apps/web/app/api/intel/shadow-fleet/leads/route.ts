import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { scoreVessel, computeRealFeatures } from '@/lib/intel/shadowFleet';
import { boxForPosition, boxState, BOX_DEAD_AFTER_H, type BoxLiveness, type BoxState } from '@/lib/intel/aisCoverage';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

interface Lead {
  mmsi: string;
  name: string;
  imo: string | null;
  flag: string;
  dwt: number | null;
  composite_score: number;
  indicators: Record<string, number>;
  last_ais_at: string | null;
  /** Hours since this vessel's last AIS fix, measured against the data clock. */
  silence_hours: number;
}

/**
 * Ranked shadow-fleet leads.
 *
 * SILENCE IS MEASURED ON `vessel_positions.updated_at` (trigger-maintained on
 * every fix), NEVER on `ingested_at` (a column default written once when the row
 * is created). Until 2026-08-24 this route reported `ingested_at` age as the
 * dark gap, so vessels transmitting at that moment appeared at the top of the
 * list with a 52-hour gap. The field is `silence_hours`; the old `last_dark_hours`
 * is gone deliberately, so a stale deploy is visible from outside.
 *
 * Gaps are measured against the DATA CLOCK — the fleet-wide freshest fix — not
 * the wall clock, so a feed-wide ingestion stall does not mark every vessel dark.
 *
 * COVERAGE (migration 110): the response carries a per-box coverage summary
 * from ais_box_liveness, and the on-the-fly fallback applies the same dead-box
 * gate as the scoring cron — a vessel last seen in a box that has been silent
 * for more than BOX_DEAD_AFTER_H is held VOID, never ranked. The profiles
 * branch inherits the gate from the cron, which voids those profiles at write
 * time. If the liveness table is missing (migration not yet applied) the
 * response says coverage: null rather than inventing a healthy state.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const commodity = url.searchParams.get('commodity') ?? 'oil';
  const min = Number(url.searchParams.get('min_score') ?? 0.4);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));

  try {
    const supabase = createServerSupabase();

    // Data clock, shared by both branches below.
    const clock = await supabase
      .from('vessel_positions')
      .select('updated_at')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const dataClockMs = clock.data?.updated_at
      ? new Date(clock.data.updated_at).getTime()
      : Date.now();
    const feedLagMinutes = Math.max(0, Math.round((Date.now() - dataClockMs) / 60_000));

    // Per-box coverage summary. Fails soft to null — an absent table must not
    // fabricate a healthy board.
    let coverage: {
      boxes: Array<{ slug: string; label: string; kind: string; state: BoxState; newest_fix: string | null; fixes_last_hour: number; silent_hours: number | null }>;
      dead_boxes: number;
      box_dead_after_h: number;
    } | null = null;
    let livenessMap = new Map<string, BoxLiveness>();
    try {
      const lv = await supabase.from('ais_box_liveness').select('*');
      if (!lv.error && lv.data?.length) {
        livenessMap = new Map((lv.data as BoxLiveness[]).map(r => [r.slug, r]));
        const boxes = (lv.data as BoxLiveness[]).map(r => ({
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
        coverage = {
          boxes,
          dead_boxes: boxes.filter(b => b.state === 'dead').length,
          box_dead_after_h: BOX_DEAD_AFTER_H,
        };
      }
    } catch { /* coverage stays null */ }

    const silenceHours = (iso: string | null): number =>
      iso ? Math.round(Math.max(0, (dataClockMs - new Date(iso).getTime()) / 3600_000) * 10) / 10 : 0;

    // Prefer materialised profiles if present. last_ais_at is written by the
    // scoring cron from updated_at, so it is a true last-contact time.
    const profiles = await supabase
      .from('vessel_profiles')
      .select('*')
      .gte('composite_score', min)
      .order('composite_score', { ascending: false })
      .limit(limit);

    if (!profiles.error && profiles.data && profiles.data.length > 0) {
      const leads: Lead[] = profiles.data.map((p: any) => ({
        ...p,
        silence_hours: silenceHours(p.last_ais_at),
      }));
      return NextResponse.json({
        leads,
        commodity,
        min_score: min,
        live: true,
        gap_source: 'updated_at',
        data_clock: new Date(dataClockMs).toISOString(),
        feed_lag_minutes: feedLagMinutes,
        coverage,
      });
    }

    // Fallback — score the recently-active fleet on the fly with the SAME
    // real-signal model. Windowed on updated_at so the maximum achievable gap is
    // bounded by the window, and ordered oldest-fix-first so the silent vessels
    // (the ones worth ranking) are the ones that survive the row cap.
    const sinceIso = new Date(dataClockMs - 72 * 3600_000).toISOString();
    const positions = await supabase
      .from('vessel_positions')
      .select('mmsi, name, flag, latitude, longitude, updated_at')
      .gte('updated_at', sinceIso)
      .order('updated_at', { ascending: true })
      .limit(1000);

    const rows = (positions.data ?? []).filter(Boolean);

    let voidedDeadBox = 0;
    const leads: Lead[] = rows
      .filter((v: any) => {
        const box = boxForPosition(v.latitude, v.longitude);
        if (!box) return true; // outside every box: observed, liveness untracked
        if (boxState(livenessMap.get(box.slug)) === 'dead') { voidedDeadBox++; return false; }
        return true;
      })
      .map((v: any) => {
        const gapHours = silenceHours(v.updated_at);
        const features = computeRealFeatures({ flag: v.flag, gapHours });
        const score = scoreVessel(features);
        return {
          mmsi: String(v.mmsi ?? 'unknown'),
          name: v.name ?? 'Unknown vessel',
          imo: null,
          flag: v.flag ?? 'UNK',
          dwt: null,
          composite_score: score.composite,
          indicators: features as unknown as Record<string, number>,
          last_ais_at: v.updated_at ?? null,
          silence_hours: gapHours,
        };
      })
      .filter(l => l.composite_score >= min)
      .sort((a, b) => b.composite_score - a.composite_score)
      .slice(0, limit);

    return NextResponse.json({
      leads,
      commodity,
      min_score: min,
      live: false,
      gap_source: 'updated_at',
      data_clock: new Date(dataClockMs).toISOString(),
      feed_lag_minutes: feedLagMinutes,
      coverage,
      voided_dead_box: voidedDeadBox,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ leads: [], error: message }, { status: 200 });
  }
}
