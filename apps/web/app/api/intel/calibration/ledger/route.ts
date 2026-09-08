import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
// force-dynamic alone does NOT stop Next 14 caching the supabase GET in
// the Data Cache — the regime-shift reader served a frozen payload for
// hours that way (PR #339). This route reports a track record; a stale
// one is worse than none.
export const fetchCache = 'force-no-store';

/**
 * Calibration ledger — everything the one-screen workspace renders,
 * per TRACK.
 *
 * The three tracks (migration 098) are computed independently and never
 * blended: machine claims would drown house and creator by volume, and
 * a blended number would look excellent and mean nothing.
 *
 * Every figure carries its own n. Below MIN_SAMPLE resolved the track
 * reports "calibrating" and NO number — the same rule the Reputation
 * Note already applies to creators, applied to the house too.
 */

const MIN_SAMPLE = 10;
const TRACKS = ['house', 'machine', 'creator'] as const;
type Track = (typeof TRACKS)[number];

const TRACK_META: Record<Track, { label: string; sublabel: string }> = {
  house: { label: 'House', sublabel: "eYKON's own forecasts · benchmark" },
  machine: { label: 'Machine', sublabel: 'sensor observables · instrument health' },
  creator: { label: 'Creators', sublabel: 'Reputation Note · gates paid Spaces' },
};

/**
 * Sensor families and their admission verdict (brief §2.2). Excluded
 * families are shown WITH their reason rather than hidden — a reader
 * should be able to see what we decided not to score and why.
 *
 * base_rate stays null until it is MEASURED. A family scores only once
 * its historical base rate is known and away from certainty: a claim
 * that is 95% true is a formality with a good Brier, not a test.
 */
const FAMILIES = [
  { key: 'went_dark', source: 'firms', verdict: 'admit' as const, reason: 'facility stopped emitting — a real state change' },
  { key: 'went_dark_lights', source: 'nightlights', verdict: 'admit' as const, reason: 'the Kuwait outage came from this family' },
  { key: 'first_light', source: 'nightlights', verdict: 'admit' as const, reason: 'rare, high information' },
  { key: 'elevated', source: 'firms', verdict: 'exclude' as const, reason: 'routine flaring is not an alarm' },
  { key: 'surge', source: 'nightlights', verdict: 'exclude' as const, reason: 'radiance variance, not a state change' },
];

type TrackAgg = {
  issued: number;
  resolved: number;
  void: number;
  open: number;
  headline: unknown | null;
  integrity: unknown;
  reliability: unknown[];
  history: unknown[];
  families: unknown[];
};

/**
 * Every figure is aggregated in SQL (migration 124), not by fetching rows and
 * counting them here.
 *
 * The previous version read prediction_outcomes with `.limit(5000)` and no
 * ORDER BY, then split by track in JS. Measured on production 2026-09-07 that
 * returned 41 house + 4,959 machine — exactly 5,000 — against a true 34,802
 * machine outcomes, and the page rendered the slice as "all resolved · n=4959".
 * It reported machine skill -0.40 where the truth is -0.246.
 *
 * The worse failure was structural rather than numeric: with no ORDER BY, the
 * 41 house rows sat inside that window only by luck of scan order. The house
 * track is the public benchmark, and it was one physical-order change away from
 * silently reporting a smaller n, or none.
 *
 * A bigger limit would only move the cliff. Aggregating server-side removes it:
 * there is no row cap to outgrow and the numbers cannot depend on fetch order.
 */
export async function GET(_req: NextRequest) {
  try {
    const supabase = createServerSupabase();

    const { data, error } = await supabase.rpc('calibration_ledger_tracks');
    if (error) throw error;

    const payload = (data ?? {}) as {
      tracks?: Record<string, TrackAgg>;
      family_counts?: Record<string, number>;
    };
    const agg = payload.tracks ?? {};
    const familyCounts = payload.family_counts ?? {};

    // Still driven by TRACKS, so a track with no rows renders as an honest
    // empty panel rather than disappearing from the page.
    const tracks = TRACKS.map(track => {
      const t = agg[track];
      const resolved = t?.resolved ?? 0;
      return {
        key: track,
        ...TRACK_META[track],
        issued: t?.issued ?? 0,
        resolved,
        void: t?.void ?? 0,
        open: t?.open ?? 0,
        calibrating: resolved < MIN_SAMPLE,
        headline: t?.headline ?? null,
        integrity: t?.integrity ?? {
          issued: 0, sealed: 0, sealed_pct: null, resolved_total: 0, median_lead_days: null,
        },
        reliability: t?.reliability ?? [],
        history: t?.history ?? [],
        families: t?.families ?? [],
      };
    });

    // The measured base rates come from the same plan RPCs the issuers use
    // (migs 127 and 128), so this panel and the claims it explains cannot
    // disagree. A family with no plan, or a plan that is not eligible, stays
    // honestly "base —". Additive: a failed plan probe leaves the dash rather
    // than failing the page.
    const plans: Record<string, { base_rate: number | null; eligible: boolean; n: number | null }> = {};
    try {
      const [{ data: fp }, { data: bp }] = await Promise.all([
        supabase.rpc('firms_recovery_plan'),
        supabase.rpc('blackmarble_claim_plan'),
      ]);
      const ffam = (fp as { family?: { base_rate?: number; eligible?: boolean; n?: number } } | null)?.family;
      if (ffam) plans.went_dark = { base_rate: ffam.base_rate ?? null, eligible: !!ffam.eligible, n: ffam.n ?? null };
      const bfams = (bp as { families?: Record<string, { base_rate?: number; eligible?: boolean; n?: number }> } | null)?.families ?? {};
      for (const key of ['first_light', 'went_dark_lights'] as const) {
        const fam = bfams[key];
        if (fam) plans[key] = { base_rate: fam.base_rate ?? null, eligible: !!fam.eligible, n: fam.n ?? null };
      }
    } catch {
      /* additive — the panel falls back to "base —" */
    }

    // Skill by ISSUANCE cohort (mig 137): the only view in which a change of
    // forecaster is visible. Additive — if the probe fails, the panel says so
    // and the rest of the page renders.
    let cohorts: Record<string, unknown[]> = {};
    let changes: unknown[] = [];
    let cohortsError: string | null = null;
    try {
      const { data: co, error: coErr } = await supabase.rpc('calibration_cohorts', { p_days: 120 });
      if (coErr) cohortsError = coErr.message;
      else {
        const c = (co ?? {}) as { tracks?: Record<string, unknown[]>; changes?: unknown[] };
        cohorts = c.tracks ?? {};
        changes = c.changes ?? [];
      }
    } catch (e) {
      cohortsError = e instanceof Error ? e.message : String(e);
    }

    return NextResponse.json({
      tracks: tracks.map(tr => ({ ...tr, cohorts: cohorts[tr.key] ?? [] })),
      cohorts_error: cohortsError,
      changes,
      min_sample: MIN_SAMPLE,
      observable_families: FAMILIES.map(f => ({
        ...f,
        events: familyCounts[f.key] ?? null,
        // Measured (from the family's own issuance plan), or honestly absent.
        base_rate: plans[f.key]?.eligible ? plans[f.key].base_rate : (null as number | null),
        measured_n: plans[f.key]?.n ?? null,
        issuing: plans[f.key]?.eligible ?? false,
      })),
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { tracks: [], error: err instanceof Error ? err.message : 'ledger unavailable' },
      { status: 200 },
    );
  }
}
