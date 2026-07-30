import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Night-lights significance detection · daily, after the Black Marble
 * ingest worker.
 *
 * The sibling of detect-firms-significance, and deliberately the same
 * shape: judge departures from a facility's OWN baseline, emit one
 * geolocated anomaly_flag per event, and report the numbers that keep
 * a zero honest.
 *
 *   went_dark_lights — a habitually-lit facility dark across several
 *                      consecutive CLEAR nights. The outage signal,
 *                      and the one that corroborates a FIRMS
 *                      went_dark from independent physics: heat and
 *                      light are different sensors seeing the same
 *                      plant stop.
 *   surge            — materially brighter than its own clear-night norm.
 *   first_light      — a reliably-dark facility lights up.
 *
 * ─── HONESTY INVARIANTS (do not soften) ────────────────────────────
 * • Radiance is not power state. A dark pixel is not a confirmed
 *   outage — cloud, snow, moon geometry and the ~500 m footprint all
 *   hide light. went_dark_lights requires SUSTAINED absence across
 *   multiple CLEAR nights and stays an inference, never a verdict.
 * • CLEAR NIGHTS ONLY, measured not assumed: on the first production
 *   night, readings surviving on confident_cloudy pixels averaged
 *   3,010 nW·cm⁻²·sr⁻¹ vs 29.6 on confident_clear, because cloud
 *   scatters city light back at the sensor. Cloudy rows would fake
 *   both surges and collapses, so migration 092 gates every baseline
 *   and judgement on confident_clear.
 * • A facility without enough clear history is NOT judged. The
 *   response reports eligible_facilities alongside the counts, so
 *   `events: 0` can be read correctly as "cannot yet judge" rather
 *   than "nothing happened".
 */

// Re-scan a trailing window: Black Marble granules publish in stages,
// so a night's readings can still arrive days later and change a
// verdict. Safe — the RPC upserts on (facility, period, event_type).
const DETECT_DAYS = 3;

const BASELINE_NIGHTS = 30;
const MIN_CLEAR = 7;        // refuse to judge on thinner clear history
const SURGE_SIGMA = 3.0;
const DARK_FRAC = 0.25;     // ≤25% of its own clear-night mean = dark
const DARK_NIGHTS = 3;      // consecutive clear dark nights
const LIT_FLOOR = 1.0;      // nW·cm⁻²·sr⁻¹ below this is noise, not light

// Thermal uses a matching map; keep the two in step so a reader learns
// one severity model. went_dark is the outage signal and rates highest.
const NL_SEVERITY: Record<string, 'low' | 'medium' | 'high'> = {
  went_dark_lights: 'high',
  first_light: 'medium',
  surge: 'low',
};

const NL_FLAG_SOURCE = 'nightlights_significance_detector_v1';

interface LocatedEvent {
  facility_type: string;
  facility_id: string;
  facility_name: string | null;
  country: string | null;
  period: string;
  event_type: string;
  observed_radiance: number | null;
  baseline_nights: number | null;
  baseline_mean: number | null;
  deviation_sigma: number | null;
  dark_nights: number | null;
  latitude: number | null;
  longitude: number | null;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function handle(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const supabase = createServerSupabase();
  const errors: string[] = [];
  const results: Array<{ day: string; events: number }> = [];

  const today = new Date();
  const days: string[] = [];
  for (let i = 1; i <= DETECT_DAYS; i++) {
    days.push(ymd(new Date(today.getTime() - i * 86_400_000)));
  }

  let totalEvents = 0;
  for (const day of days) {
    const { data, error } = await supabase.rpc('nightlights_detect_significant_events', {
      p_day: day,
      p_baseline_nights: BASELINE_NIGHTS,
      p_min_clear: MIN_CLEAR,
      p_surge_sigma: SURGE_SIGMA,
      p_dark_frac: DARK_FRAC,
      p_dark_nights: DARK_NIGHTS,
      p_lit_floor: LIT_FLOOR,
    });
    if (error) {
      errors.push(`detect ${day}: ${error.message}`);
    } else {
      const n = typeof data === 'number' ? data : 0;
      results.push({ day, events: n });
      totalEvents += n;
    }
  }

  // How many facilities had enough CLEAR history to be judged at all.
  // Zero here means "no baseline yet", which is a completely different
  // statement from "nothing was significant".
  let eligibleFacilities: number | null = null;
  const newestDay = days[0];
  if (newestDay) {
    const { data, error } = await supabase.rpc('nightlights_eligible_facilities', {
      p_day: newestDay,
      p_baseline_nights: BASELINE_NIGHTS,
      p_min_clear: MIN_CLEAR,
    });
    if (error) errors.push(`eligibility probe: ${error.message}`);
    else eligibleFacilities = typeof data === 'number' ? data : null;
  }

  const byType: Record<string, number> = {};
  if (totalEvents > 0) {
    const { data, error } = await supabase
      .from('nightlights_significant_events')
      .select('event_type')
      .in('period', days);
    if (error) errors.push(`breakdown: ${error.message}`);
    else if (data) {
      for (const row of data as Array<{ event_type: string }>) {
        byType[row.event_type] = (byType[row.event_type] ?? 0) + 1;
      }
    }
  }

  // ─── Emit Nightlights anomaly_flags for the convergence engine ───
  // Idempotent, same contract as the thermal emitter: this route
  // re-scans a trailing window, so we fetch the flags already written
  // for these periods and insert only what is new. created_at is left
  // alone on existing flags so the 72h convergence window does not
  // re-fire on the same event.
  let flagsInserted = 0;
  let flagsSkippedNoGeo = 0;
  try {
    const { data: located, error: locErr } = await supabase.rpc(
      'nightlights_significant_events_located',
      { p_periods: days },
    );
    if (locErr) {
      errors.push(`nl-flags locate: ${locErr.message}`);
    } else {
      const events = (located ?? []) as LocatedEvent[];

      const seen = new Set<string>();
      const sinceFlags = ymd(new Date(today.getTime() - 10 * 86_400_000));
      const { data: existing, error: exErr } = await supabase
        .from('anomaly_flags')
        .select('payload')
        .eq('source', NL_FLAG_SOURCE)
        .gte('created_at', sinceFlags);
      if (exErr) {
        errors.push(`nl-flags existing: ${exErr.message}`);
      } else {
        for (const row of (existing ?? []) as Array<{ payload: LocatedEvent | null }>) {
          const p = row.payload;
          if (p) seen.add(`${p.facility_type}|${p.facility_id}|${p.period}|${p.event_type}`);
        }
      }

      const toInsert = [];
      for (const e of events) {
        // No coordinates → cannot be placed in a convergence cell.
        // Skip rather than emit a flag the engine would silently drop.
        if (!Number.isFinite(e.latitude) || !Number.isFinite(e.longitude)) {
          flagsSkippedNoGeo++;
          continue;
        }
        const key = `${e.facility_type}|${e.facility_id}|${e.period}|${e.event_type}`;
        if (seen.has(key)) continue;
        seen.add(key);
        toInsert.push({
          source: NL_FLAG_SOURCE,
          domain: 'Nightlights',
          flag_type: `nightlights_${e.event_type}`,
          severity: NL_SEVERITY[e.event_type] ?? 'low',
          payload: {
            facility_type: e.facility_type,
            facility_id: e.facility_id,
            facility_name: e.facility_name,
            country: e.country,
            period: e.period,
            event_type: e.event_type,
            observed_radiance: e.observed_radiance,
            baseline_nights: e.baseline_nights,
            baseline_mean: e.baseline_mean,
            deviation_sigma: e.deviation_sigma,
            dark_nights: e.dark_nights,
            latitude: e.latitude,
            longitude: e.longitude,
            // The invariant travels with the flag, so anything reading
            // it downstream inherits the caveat rather than the label.
            note:
              'VIIRS night-lights departure from the facility\'s own clear-night ' +
              'baseline — inference from radiance, not a confirmed outage.',
            detected_at: today.toISOString(),
          },
        });
      }

      if (toInsert.length > 0) {
        const { error: insErr } = await supabase.from('anomaly_flags').insert(toInsert);
        if (insErr) errors.push(`nl-flags insert: ${insErr.message}`);
        else flagsInserted = toInsert.length;
      }
    }
  } catch (e) {
    errors.push(`nl-flags: ${e instanceof Error ? e.message : String(e)}`);
  }

  // A detect failure is not cosmetic: the table silently stops growing
  // while ingest keeps reporting green, and every downstream surface
  // degrades to "nothing is happening anywhere". Fail the run so
  // Railway shows it red.
  const ok = errors.length === 0;

  return NextResponse.json(
    {
      ok,
      days,
      events: totalEvents,
      by_day: results,
      by_type: byType,
      // inserted counts only NEW flags (idempotent re-runs → 0);
      // skipped_no_geo = events whose facility lacked coordinates.
      nightlights_flags: {
        inserted: flagsInserted,
        skipped_no_geo: flagsSkippedNoGeo,
      },
      // Null = the probe failed. Zero = no facility has enough CLEAR
      // history yet, so `events: 0` means "cannot yet judge", NOT
      // "nothing significant happened".
      eligible_facilities: eligibleFacilities,
      baseline_nights: BASELINE_NIGHTS,
      min_clear: MIN_CLEAR,
      note:
        eligibleFacilities === 0
          ? 'No facility has reached the minimum clear-night baseline yet; ' +
            'events=0 means insufficient clear history to judge, not an absence of activity.'
          : undefined,
      errors: errors.slice(0, 10),
    },
    { status: ok ? 200 : 500 },
  );
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
