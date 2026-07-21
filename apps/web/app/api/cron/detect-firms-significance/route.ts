import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { checkShardLiveness } from '@/lib/firms/liveness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * FIRMS significance detection · daily, after ingest.
 *
 * Turns raw facility-days into the only thing worth a reader's
 * attention: DEPARTURE FROM A FACILITY'S OWN BASELINE.
 *
 * A refinery that flares every day is baseline, not news — Tasnee
 * logged 101 detections and Bandar Abbas 23 in two days, and that is
 * simply what a working refinery looks like from orbit. Alerting on
 * those would train every reader to ignore the product. So this cron
 * writes only three kinds of event, via firms_detect_significant_events
 * (migration 085):
 *
 *   ignition   — a normally-dark facility lights up
 *   elevated   — a burning facility burns materially harder than its
 *                own lit-day norm
 *   went_dark  — an habitually-burning facility stops (the OUTAGE
 *                signal: refinery down, grid hit)
 *
 * ─── HONESTY INVARIANTS (do not soften) ────────────────────────────
 * • A detection is a hot pixel from a radiometer. Not a confirmed
 *   fire, not an explosion, not a strike. Attribution is the reader's
 *   inference, never this system's claim.
 * • Absence of detection is NOT absence of fire — cloud cover,
 *   overpass timing and the ~375 m pixel floor all hide real fires.
 *   went_dark therefore requires SUSTAINED absence across multiple
 *   COVERED days and is still an inference, never a confirmed outage.
 * • Never assert coverage we do not have. Post-085 a row in
 *   firms_facility_observations exists only for facilities inside an
 *   ingest bbox, so "no row" reads as no data, not as zero.
 *
 * ─── WHY skipped-for-thin-history IS REPORTED, NOT HIDDEN ──────────
 * The RPC refuses to judge a facility with fewer than p_min_baseline
 * covered days: no baseline, no claim. As of 2026-07-18 production
 * holds TWO days of observations, so EVERY facility is below the
 * floor and this cron will correctly return events: 0 for about a
 * week. That is the system working, not failing — but "0 events"
 * and "0 facilities were eligible to be judged" mean completely
 * different things, so the response reports `eligible_facilities`
 * alongside the counts. Do not read a zero here as "nothing
 * happened" until eligible_facilities is non-zero.
 */

// Re-scan a trailing window, not just yesterday: FIRMS NRT lands ~3h
// behind and late detections backfill earlier days, which can change
// a facility's observed_count after the fact. Re-running is safe —
// the RPC upserts on (facility_type, facility_id, period, event_type).
const DETECT_DAYS = 3;

// Baseline window and floors. 30 days of a facility's own history;
// refuse to judge on fewer than 7 covered days.
const BASELINE_DAYS = 30;
const MIN_BASELINE = 7;
// FRP multiple over the facility's own LIT-DAY mean.
const ELEVATED_MULT = 3.0;
// "Habitually burning" floor for went_dark, and the number of
// consecutive covered zero-days before we will call it.
const DARK_RATE = 0.6;
const DARK_DAYS = 3;

// ─── Thermal → cross-layer engine (anomaly_flags domain='Thermal') ──
// Significance is the ONLY thermal signal fit for convergence: a raw
// hot pixel beside a flaring refinery is baseline, not news. Each
// significant event becomes one geolocated anomaly_flag so
// compute-convergences can corroborate it against Conflict/Maritime/
// Energy. went_dark is the outage signal and rates highest.
//
// This is emitted HERE, not in a new Railway cron, because this route
// already owns significance detection and already re-reads the events
// for its breakdown — a separate cron would duplicate that read and
// add another unscheduled-cron failure mode (the exact fault §5.1 of
// the 07-21 brief exists to catch).
const THERMAL_FLAG_SOURCE = 'thermal_significance_detector_v1';
const THERMAL_SEVERITY: Record<string, 'low' | 'medium' | 'high'> = {
  went_dark: 'high',   // habitual burner stops — refinery down / grid hit
  ignition: 'medium',  // a normally-dark facility lights up
  elevated: 'low',     // a burning facility burns harder than its norm
};

interface LocatedEvent {
  facility_type: string;
  facility_id: string;
  facility_name: string | null;
  country: string | null;
  period: string;
  event_type: string;
  observed_count: number | null;
  observed_max_frp: number | null;
  baseline_days: number | null;
  baseline_rate: number | null;
  deviation: number | null;
  dark_days: number | null;
  latitude: number | null;
  longitude: number | null;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface DayResult {
  day: string;
  events: number;
}

async function handle(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const supabase = createServerSupabase();
  const errors: string[] = [];
  const results: DayResult[] = [];

  const today = new Date();
  const days: string[] = [];
  for (let i = 1; i <= DETECT_DAYS; i++) {
    days.push(ymd(new Date(today.getTime() - i * 86_400_000)));
  }

  let totalEvents = 0;
  for (const day of days) {
    const { data, error } = await supabase.rpc('firms_detect_significant_events', {
      p_day: day,
      p_baseline_days: BASELINE_DAYS,
      p_min_baseline: MIN_BASELINE,
      p_elevated_mult: ELEVATED_MULT,
      p_dark_rate: DARK_RATE,
      p_dark_days: DARK_DAYS,
    });
    if (error) {
      errors.push(`detect ${day}: ${error.message}`);
    } else {
      const n = typeof data === 'number' ? data : 0;
      results.push({ day, events: n });
      totalEvents += n;
    }
  }

  // How many facilities had enough covered history to be judged at
  // all. This is what separates "we looked and nothing was
  // significant" from "we could not yet form a baseline" — the
  // distinction that keeps a zero honest.
  let eligibleFacilities: number | null = null;
  const newestDay = days[0];
  if (newestDay) {
    const { data, error } = await supabase
      .from('firms_facility_observations')
      .select('facility_type, facility_id', { count: 'exact', head: false })
      .lt('period', newestDay)
      .gte(
        'period',
        ymd(new Date(new Date(newestDay).getTime() - BASELINE_DAYS * 86_400_000)),
      );
    if (error) {
      errors.push(`eligibility probe: ${error.message}`);
    } else if (data) {
      const perFacility = new Map<string, number>();
      for (const row of data as Array<{ facility_type: string; facility_id: string }>) {
        const key = `${row.facility_type}:${row.facility_id}`;
        perFacility.set(key, (perFacility.get(key) ?? 0) + 1);
      }
      eligibleFacilities = Array.from(perFacility.values()).filter(
        (n) => n >= MIN_BASELINE,
      ).length;
    }
  }

  // A breakdown of what was actually written, so the run is legible
  // in Railway logs without a database round-trip by hand.
  const byType: Record<string, number> = {};
  if (totalEvents > 0) {
    const { data, error } = await supabase
      .from('firms_significant_events')
      .select('event_type')
      .in('period', days);
    if (error) {
      errors.push(`breakdown: ${error.message}`);
    } else if (data) {
      for (const row of data as Array<{ event_type: string }>) {
        byType[row.event_type] = (byType[row.event_type] ?? 0) + 1;
      }
    }
  }

  // ─── Emit Thermal anomaly_flags for the convergence engine ───────
  // Idempotent: this route re-scans a trailing window every run, so a
  // significant event would otherwise be re-flagged each tick. We fetch
  // the thermal flags already written for these periods and insert only
  // the ones not seen, keying on facility+period+event_type. created_at
  // is left untouched on existing flags so the 72h convergence window
  // doesn't keep re-firing on the same event.
  let thermalFlagsInserted = 0;
  let thermalFlagsSkippedNoGeo = 0;
  try {
    const { data: located, error: locErr } = await supabase.rpc(
      'firms_significant_events_located',
      { p_periods: days },
    );
    if (locErr) {
      errors.push(`thermal-flags locate: ${locErr.message}`);
    } else {
      const events = (located ?? []) as LocatedEvent[];

      // Existing thermal flags in a bounded recent window → seen-set.
      const seen = new Set<string>();
      const sinceThermal = ymd(new Date(today.getTime() - 10 * 86_400_000));
      const { data: existing, error: exErr } = await supabase
        .from('anomaly_flags')
        .select('payload')
        .eq('source', THERMAL_FLAG_SOURCE)
        .gte('created_at', sinceThermal);
      if (exErr) {
        errors.push(`thermal-flags existing: ${exErr.message}`);
      } else {
        for (const row of (existing ?? []) as Array<{ payload: LocatedEvent | null }>) {
          const p = row.payload;
          if (p) seen.add(`${p.facility_type}|${p.facility_id}|${p.period}|${p.event_type}`);
        }
      }

      const toInsert = [];
      for (const e of events) {
        // No coordinates → cannot place it in a convergence cell. Skip
        // rather than emit a flag the engine would silently drop.
        if (!Number.isFinite(e.latitude) || !Number.isFinite(e.longitude)) {
          thermalFlagsSkippedNoGeo++;
          continue;
        }
        const dedupKey = `${e.facility_type}|${e.facility_id}|${e.period}|${e.event_type}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        toInsert.push({
          source: THERMAL_FLAG_SOURCE,
          domain: 'Thermal',
          flag_type: `firms_${e.event_type}`,
          severity: THERMAL_SEVERITY[e.event_type] ?? 'low',
          payload: {
            facility_type: e.facility_type,
            facility_id: e.facility_id,
            facility_name: e.facility_name,
            country: e.country,
            period: e.period,
            event_type: e.event_type,
            observed_count: e.observed_count,
            observed_max_frp: e.observed_max_frp,
            baseline_days: e.baseline_days,
            baseline_rate: e.baseline_rate,
            deviation: e.deviation,
            dark_days: e.dark_days,
            latitude: e.latitude,
            longitude: e.longitude,
            // Honesty invariant carried onto the flag: a detection is a
            // hot pixel, not a confirmed fire or strike; absence over
            // covered days is inference, not a confirmed outage.
            note: 'FIRMS thermal significance — inference from radiometry, not a confirmed event.',
            detected_at: today.toISOString(),
          },
        });
      }

      if (toInsert.length > 0) {
        const { error: insErr } = await supabase.from('anomaly_flags').insert(toInsert);
        if (insErr) errors.push(`thermal-flags insert: ${insErr.message}`);
        else thermalFlagsInserted = toInsert.length;
      }
    }
  } catch (e) {
    errors.push(`thermal-flags: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ─── Ingest-shard liveness ───────────────────────────────────────
  // Piggybacked here rather than given its own Railway service: this
  // cron is hourly, and it is the natural owner because it is the
  // CONSUMER of coverage — significance is computed from exactly the
  // facility-days the shards produce, so a silent shard degrades this
  // route's output before anyone else's.
  //
  // It deliberately does NOT affect `ok` below. See lib/firms/liveness.ts:
  // a stale shard and a failed detection are different faults and must
  // stay separately diagnosable. The alert goes to Discord, which a
  // human reads; the block below keeps it visible in the Railway log.
  let liveness = null;
  try {
    liveness = await checkShardLiveness(supabase);
    for (const e of liveness.errors) errors.push(`liveness: ${e}`);
  } catch (e) {
    // Never let a monitoring bug cost a real significance run.
    errors.push(`liveness: ${e instanceof Error ? e.message : String(e)}`);
  }

  // A detect failure is not cosmetic. If it fails silently the
  // significance table simply stops growing while ingest keeps
  // reporting green, and every downstream surface degrades to
  // "nothing is happening anywhere" — indistinguishable from a quiet
  // week. Fail the run so Railway shows it red.
  const ok = errors.length === 0;

  return NextResponse.json(
    {
      ok,
      days,
      events: totalEvents,
      by_day: results,
      by_type: byType,
      // Thermal flags emitted into anomaly_flags for the convergence
      // engine. inserted counts only NEW flags (idempotent re-runs → 0);
      // skipped_no_geo = significant events whose facility lacked
      // coordinates and so cannot enter a convergence cell.
      thermal_flags: {
        inserted: thermalFlagsInserted,
        skipped_no_geo: thermalFlagsSkippedNoGeo,
      },
      // Null = the probe itself failed. Zero = no facility has enough
      // covered history yet, so `events: 0` means "cannot yet judge",
      // NOT "nothing significant happened".
      eligible_facilities: eligibleFacilities,
      baseline_days: BASELINE_DAYS,
      min_baseline: MIN_BASELINE,
      // Ingest-shard health. `unhealthy: []` is the good case; anything
      // listed here means a region's facilities are going unwatched.
      liveness: liveness
        ? {
            unhealthy: liveness.unhealthy.map((r) => ({
              region: r.region,
              severity: r.severity,
              stale_days: r.staleDays,
              hours_since_run: r.hoursSinceRun,
              latest_day_covered: r.latestDayCovered,
              never_ran: r.neverRan,
            })),
            alerted: liveness.alerted,
            recovered: liveness.recovered,
          }
        : null,
      note:
        eligibleFacilities === 0
          ? 'No facility has reached the minimum covered-day baseline yet; ' +
            'events=0 means insufficient history to judge, not an absence of activity.'
          : undefined,
      errors: errors.slice(0, 10),
    },
    // Non-2xx so `curl -fsS` exits non-zero and Railway marks the run
    // failed rather than reporting green on a broken pipeline.
    { status: ok ? 200 : 500 },
  );
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
