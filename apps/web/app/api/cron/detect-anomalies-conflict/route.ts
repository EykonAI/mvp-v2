import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import seed from '@/lib/fixtures/posture_seed.json';

// detect-anomalies-conflict · hourly cron.
//
// First writer to anomaly_flags in the codebase. For each theatre in
// posture_seed, counts conflict_events in the last hour against the
// per-theatre baseline (entity_class='theatre',
// metric='acled_events') that compute-baselines learns nightly. When
// the current count exceeds mean + 2·std AND clears a small absolute
// floor (to suppress near-zero-baseline noise), inserts one
// anomaly_flags row tagged source='conflict_spike_detector_v1'.
//
// Once this writes, compute-convergences (nightly) starts clustering
// real anomalies into convergence_events, and the honesty-v2 filter
// in suggestion-library.ts auto-restores the 8 AnomalyFlags
// suggestions + the 2 ConvergenceEvents suggestions on the next
// /notif render.
//
// Auth: Bearer <CRON_SECRET>  OR  ?secret=<CRON_SECRET> — same
// pattern as the other crons.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const WINDOW_HOURS = 1;
const SIGMA_K = 2;          // fire when current > mean + 2·std
const ABSOLUTE_FLOOR = 3;   // and current is at least this many events
const HIGH_SIGMA_K = 4;     // severity='high' beyond 4·std

interface Bbox {
  lat_min: number;
  lat_max: number;
  lon_min: number;
  lon_max: number;
}

interface BaselineDistribution {
  mean?: number;
  std?: number;
}

type DetectionState =
  | { state: 'fired'; slug: string; current: number; mean: number; std: number; severity: string }
  | { state: 'below_threshold'; slug: string; current: number; mean: number; std: number }
  | { state: 'below_floor'; slug: string; current: number }
  | { state: 'no_baseline'; slug: string; current: number }
  | { state: 'no_bbox'; slug: string }
  | { state: 'error'; slug: string; error: string };

export async function POST(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const supabase = createServerSupabase();
  const now = new Date();
  const sinceIso = new Date(now.getTime() - WINDOW_HOURS * 3600_000).toISOString();
  const results: DetectionState[] = [];

  for (const t of seed.theatres) {
    const slug = t.slug as string;
    const bbox = t.bbox as Bbox | undefined;
    if (!bbox) {
      results.push({ state: 'no_bbox', slug });
      continue;
    }

    try {
      // Current-window count for this theatre's bbox.
      const { count: rawCount } = await supabase
        .from('conflict_events')
        .select('id', { count: 'exact', head: true })
        .gte('ingested_at', sinceIso)
        .gte('latitude', bbox.lat_min)
        .lte('latitude', bbox.lat_max)
        .gte('longitude', bbox.lon_min)
        .lte('longitude', bbox.lon_max);
      const current = rawCount ?? 0;

      // Baseline for this theatre.
      const { data: blRow } = await supabase
        .from('baseline_distributions')
        .select('distribution')
        .eq('entity_class', 'theatre')
        .eq('entity_key', slug)
        .eq('metric', 'acled_events')
        .maybeSingle();
      const dist = (blRow?.distribution as BaselineDistribution | null | undefined) ?? null;
      if (!dist || typeof dist.mean !== 'number' || typeof dist.std !== 'number') {
        results.push({ state: 'no_baseline', slug, current });
        continue;
      }
      const mean = dist.mean;
      const std = dist.std;
      const threshold = mean + SIGMA_K * std;

      if (current < ABSOLUTE_FLOOR) {
        results.push({ state: 'below_floor', slug, current });
        continue;
      }
      if (current <= threshold) {
        results.push({ state: 'below_threshold', slug, current, mean, std });
        continue;
      }

      const severity = current >= mean + HIGH_SIGMA_K * std ? 'high' : 'medium';
      const { error: insertErr } = await supabase.from('anomaly_flags').insert({
        source: 'conflict_spike_detector_v1',
        domain: 'Conflict',
        flag_type: 'count_spike_2sigma',
        severity,
        payload: {
          theatre: slug,
          theatre_label: (t as { label?: string }).label ?? slug,
          window_hours: WINDOW_HOURS,
          current_count: current,
          baseline_mean: mean,
          baseline_std: std,
          threshold,
          sigma: std > 0 ? (current - mean) / std : null,
          bbox,
          detected_at: now.toISOString(),
        },
      });
      if (insertErr) {
        results.push({ state: 'error', slug, error: insertErr.message });
        continue;
      }
      results.push({ state: 'fired', slug, current, mean, std, severity });
    } catch (err) {
      results.push({
        state: 'error',
        slug,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  return NextResponse.json({
    tickStartedAt: now.toISOString(),
    window_hours: WINDOW_HOURS,
    theatres_checked: results.length,
    fired: results.filter(r => r.state === 'fired').length,
    no_baseline: results.filter(r => r.state === 'no_baseline').length,
    below_threshold: results.filter(r => r.state === 'below_threshold').length,
    below_floor: results.filter(r => r.state === 'below_floor').length,
    no_bbox: results.filter(r => r.state === 'no_bbox').length,
    errors: results.filter(r => r.state === 'error').length,
    results,
  });
}
