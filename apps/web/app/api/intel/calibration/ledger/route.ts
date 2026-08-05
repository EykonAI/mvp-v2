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

export async function GET(_req: NextRequest) {
  try {
    const supabase = createServerSupabase();

    const [predsRes, outcomesRes, firmsRes, nlRes] = await Promise.all([
      supabase
        .from('predictions_register')
        .select('id, feature, track, issued_at, resolves_at, commit_hash, revealed_at, source'),
      supabase
        .from('prediction_outcomes')
        .select('prediction_id, observed_value, observed_at, brier, log_loss, calibration_bin, void_reason'),
      supabase.from('firms_significant_events').select('event_type'),
      supabase.from('nightlights_significant_events').select('event_type'),
    ]);

    if (predsRes.error) throw predsRes.error;
    if (outcomesRes.error) throw outcomesRes.error;

    const preds = predsRes.data ?? [];
    const outcomes = outcomesRes.data ?? [];
    const byId = new Map(preds.map(p => [p.id, p]));

    // Family event counts feed the families panel. A failure here must
    // not cost the whole ledger, so they degrade to null rather than throw.
    const familyCounts = new Map<string, number>();
    for (const r of (firmsRes.data ?? []) as Array<{ event_type: string }>) {
      familyCounts.set(r.event_type, (familyCounts.get(r.event_type) ?? 0) + 1);
    }
    for (const r of (nlRes.data ?? []) as Array<{ event_type: string }>) {
      familyCounts.set(r.event_type, (familyCounts.get(r.event_type) ?? 0) + 1);
    }

    const tracks = TRACKS.map(track => {
      const trackPreds = preds.filter(p => (p.track ?? 'house') === track);
      const ids = new Set(trackPreds.map(p => p.id));
      const trackOutcomes = outcomes.filter(o => ids.has(o.prediction_id));
      // Void rows are excluded from EVERY aggregate — they are the
      // absence of a look, not a result.
      const scored = trackOutcomes.filter(o => !o.void_reason && o.brier != null);
      const voids = trackOutcomes.filter(o => !!o.void_reason);

      return {
        key: track,
        ...TRACK_META[track],
        issued: trackPreds.length,
        resolved: scored.length,
        void: voids.length,
        open: trackPreds.length - trackOutcomes.length,
        calibrating: scored.length < MIN_SAMPLE,
        headline: headlineFor(scored),
        integrity: integrityFor(trackPreds, trackOutcomes, scored.length + voids.length),
        reliability: reliabilityFor(scored),
        history: historyFor(scored),
        families: familiesFor(scored, byId),
      };
    });

    return NextResponse.json({
      tracks,
      min_sample: MIN_SAMPLE,
      observable_families: FAMILIES.map(f => ({
        ...f,
        events: familyCounts.get(f.key) ?? null,
        // Measured, or honestly absent. Never a placeholder.
        base_rate: null as number | null,
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

/**
 * Brier, skill, sharpness. Skill is reported against the ACTUAL base
 * rate of the outcomes in the track: a Brier alone is gameable by
 * always predicting the base rate, so the number that matters is how
 * much better than that we did. Sharpness — mean distance from a
 * non-committal 0.5 — is reported alongside, because good calibration
 * with no sharpness is just cowardice with a good score.
 */
function headlineFor(scored: Array<{ brier: number | null; observed_value: number | null; calibration_bin: number | null }>) {
  if (scored.length === 0) return null;
  const briers = scored.map(o => Number(o.brier)).filter(Number.isFinite);
  if (briers.length === 0) return null;
  const brier = briers.reduce((a, b) => a + b, 0) / briers.length;

  const observed = scored.map(o => Number(o.observed_value)).filter(Number.isFinite);
  const baseRate = observed.length ? observed.reduce((a, b) => a + b, 0) / observed.length : null;
  // Brier of the strategy "always predict the base rate" = p(1-p).
  const baselineBrier = baseRate == null ? null : baseRate * (1 - baseRate);
  const skill = baselineBrier && baselineBrier > 0 ? 1 - brier / baselineBrier : null;

  // Predicted probability is recovered from the calibration bin's
  // midpoint — the register stores a distribution, the outcome stores
  // the bin it fell in, and the bin is what the reliability diagram is
  // built on, so the two panels stay consistent by construction.
  const preds = scored
    .map(o => (o.calibration_bin == null ? null : (Number(o.calibration_bin) - 0.5) / 10))
    .filter((v): v is number => v != null && Number.isFinite(v));
  const sharpness = preds.length
    ? preds.reduce((a, p) => a + Math.abs(p - 0.5), 0) / preds.length
    : null;

  return {
    brier: round3(brier),
    skill: skill == null ? null : round3(skill),
    base_rate: baseRate == null ? null : round3(baseRate),
    sharpness: sharpness == null ? null : round3(sharpness),
  };
}

/**
 * The panel a sceptic reads first. Commit-reveal coverage is reported
 * as it IS — if claims were registered without a hash, the ledger says
 * so rather than implying a sealing that never happened.
 */
function integrityFor(
  preds: Array<{ commit_hash: string | null; issued_at: string | null; resolves_at: string | null }>,
  outcomes: Array<unknown>,
  resolvedTotal: number,
) {
  const sealed = preds.filter(p => !!p.commit_hash).length;
  const leads = preds
    .map(p => (p.issued_at && p.resolves_at
      ? (Date.parse(p.resolves_at) - Date.parse(p.issued_at)) / 86_400_000
      : null))
    .filter((v): v is number => v != null && Number.isFinite(v) && v >= 0)
    .sort((a, b) => a - b);
  const medianLead = leads.length ? leads[Math.floor(leads.length / 2)] : null;

  return {
    issued: preds.length,
    sealed,
    sealed_pct: preds.length ? Math.round((sealed / preds.length) * 100) : null,
    resolved_total: resolvedTotal,
    median_lead_days: medianLead == null ? null : Math.round(medianLead * 10) / 10,
  };
}

/**
 * Real reliability bins. Deciles of predicted probability from
 * calibration_bin; observed frequency is the mean outcome in the bin.
 * n is returned per bin so the UI can size the bars and widen the
 * uncertainty whiskers — a bin holding two claims must not be able to
 * masquerade as evidence, which is exactly what the previous
 * hardcoded diagonal did.
 */
function reliabilityFor(scored: Array<{ calibration_bin: number | null; observed_value: number | null }>) {
  const bins: Array<{ bin: number; predicted: number; observed: number | null; n: number }> = [];
  for (let i = 1; i <= 10; i++) {
    const inBin = scored.filter(o => Number(o.calibration_bin) === i);
    const obs = inBin.map(o => Number(o.observed_value)).filter(Number.isFinite);
    bins.push({
      bin: i,
      predicted: (i - 0.5) / 10,
      observed: obs.length ? round3(obs.reduce((a, b) => a + b, 0) / obs.length) : null,
      n: inBin.length,
    });
  }
  return bins;
}

/** Rolling mean Brier by resolution week — is calibration drifting? */
function historyFor(scored: Array<{ observed_at: string | null; brier: number | null }>) {
  const byWeek = new Map<string, number[]>();
  for (const o of scored) {
    if (!o.observed_at || o.brier == null) continue;
    const d = new Date(o.observed_at);
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
    const k = monday.toISOString().slice(0, 10);
    (byWeek.get(k) ?? byWeek.set(k, []).get(k)!).push(Number(o.brier));
  }
  return Array.from(byWeek.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([week, vals]) => ({
      week,
      brier: round3(vals.reduce((a, b) => a + b, 0) / vals.length),
      n: vals.length,
    }));
}

/** Per claim family, within the track. */
function familiesFor(
  scored: Array<{ prediction_id: string; brier: number | null; log_loss: number | null }>,
  byId: Map<string, { feature: string }>,
) {
  const groups = new Map<string, { brier: number[]; ll: number[] }>();
  for (const o of scored) {
    const feature = byId.get(o.prediction_id)?.feature ?? 'unknown';
    const g = groups.get(feature) ?? { brier: [], ll: [] };
    if (o.brier != null) g.brier.push(Number(o.brier));
    if (o.log_loss != null) g.ll.push(Number(o.log_loss));
    groups.set(feature, g);
  }
  return Array.from(groups.entries())
    .map(([feature, g]) => ({
      feature,
      n: g.brier.length,
      brier: g.brier.length ? round3(g.brier.reduce((a, b) => a + b, 0) / g.brier.length) : null,
      log_loss: g.ll.length ? round3(g.ll.reduce((a, b) => a + b, 0) / g.ll.length) : null,
      thin: g.brier.length < MIN_SAMPLE,
    }))
    .sort((a, b) => b.n - a.n);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
