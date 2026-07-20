import type { SupabaseClient } from '@supabase/supabase-js';
import { FIRMS_REGIONS } from '@/lib/firms/client';

/**
 * FIRMS ingest-shard liveness.
 *
 * Answers one question per region: is this shard still ingesting, and if
 * not, how much longer can the gap still be repaired?
 *
 * ─── Why this exists ───────────────────────────────────────────────
 * On 2026-07-20 `cron-ingest-firms-na` was found to have run exactly
 * ONCE, on 2026-07-18. It had been created without a cron schedule, so
 * Railway showed it as "Completed" — not failed, not red, simply never
 * asked to run again. Meanwhile 1,750 North American facilities,
 * including the US Gulf Coast refining complex, went unwatched for 43
 * hours and nothing anywhere said so. firms_ingest_runs held the proof
 * the entire time; nobody was reading it.
 *
 * That is the platform's recurring failure mode — a surface that reads
 * healthy while producing nothing — and it is exactly what a liveness
 * probe is for.
 *
 * ─── The deadline that sets the thresholds ─────────────────────────
 * FIRMS NRT only serves a recent window, and the ingest route fetches a
 * trailing INGEST_DAYS = 2. So a missed day is repairable by re-running
 * the shard ONLY while that day is still inside the window. The 07-20
 * recovery worked — one manual curl backfilled 07-19 with 9,126 real
 * detections and left day coverage continuous — but it was roughly six
 * hours from being permanent.
 *
 * A gap that becomes permanent is not merely missing data: it puts a
 * hole in the coverage record that `went_dark` depends on, and
 * went_dark is the outage signal the whole thermal layer is for.
 *
 * Hence two tiers, measuring two different things:
 *
 *   warn     — no run in >WARN_HOURS. The shard has stopped. Data is
 *              still fully recoverable; fix the schedule and re-run.
 *   critical — newest OK-covered day is >=CRITICAL_DAY_GAP days behind
 *              today. The oldest missing day is at or past the edge of
 *              the FIRMS window and is about to become unrepairable.
 *
 * A region that has NEVER ingested reports `never_ran`, treated as warn:
 * that is a shard someone added to FIRMS_REGIONS and then either never
 * scheduled or mis-scheduled — the na case exactly, caught one tick in
 * rather than 43 hours in.
 *
 * ─── Deliberately NOT fatal to its caller ──────────────────────────
 * A stale shard does not fail the cron that hosts this probe. The host
 * (significance detection) is doing its own job correctly; conflating
 * "ingest shard X is stale" with "significance detection failed" would
 * make a red run mean two unrelated things and cost the operator the
 * ability to tell them apart. Loudness is delivered by Discord, which
 * is a channel a human actually reads, plus a `liveness` block on the
 * host's JSON response.
 *
 * Known limit, stated rather than hidden: this probe rides inside a
 * cron, so if that cron itself stops firing, the probe stops with it
 * and nothing alerts. It is a guard against one shard dying, not
 * against the scheduler dying. The host cron failing at least shows
 * red in Railway, which the silent-shard case did not.
 */

// An hourly shard that has not run in this long is not "a bit late".
// Three ticks missed is unambiguous, and still leaves >24h of headroom
// before the FIRMS window closes on the oldest missing day.
const WARN_HOURS = Number(process.env.FIRMS_LIVENESS_WARN_HOURS ?? 3);

// Whole days behind on coverage before the gap is treated as urgent.
// 2 = the oldest missing day is leaving the INGEST_DAYS window.
const CRITICAL_DAY_GAP = Number(process.env.FIRMS_LIVENESS_CRITICAL_DAYS ?? 2);

// Re-alert cadence for a shard that stays broken. Escalations bypass it.
const REALERT_HOURS = Number(process.env.FIRMS_LIVENESS_REALERT_HOURS ?? 6);

export type LivenessSeverity = 'ok' | 'warn' | 'critical';

export interface RegionLiveness {
  region: string;
  severity: LivenessSeverity;
  /** Whole days between today (UTC) and the newest ok-covered day. null when never ingested. */
  staleDays: number | null;
  /** Hours since this region's most recent run of any kind. null when never ingested. */
  hoursSinceRun: number | null;
  latestDayCovered: string | null;
  neverRan: boolean;
}

export interface LivenessReport {
  checkedAt: string;
  regions: RegionLiveness[];
  unhealthy: RegionLiveness[];
  alerted: string[];
  recovered: string[];
  errors: string[];
}

function ymdUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Whole days between two YYYY-MM-DD strings, interpreted as UTC dates. */
function dayGap(fromYmd: string, toYmd: string): number {
  const a = Date.parse(`${fromYmd}T00:00:00Z`);
  const b = Date.parse(`${toYmd}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

interface RunRow {
  region: string;
  day_covered: string;
  ok: boolean;
  ran_at: string;
}

/**
 * Reduce firms_ingest_runs to one verdict per configured region.
 *
 * Note the asymmetry between the two signals, which is intentional:
 *
 *  • hoursSinceRun uses runs of ANY outcome. A shard failing loudly
 *    every hour is a different problem from a shard that has stopped
 *    firing, and this probe is for the second one — the first already
 *    shows red in Railway.
 *  • staleDays uses only ok=true rows. A failed run covers nothing, so
 *    counting it as coverage would be the same lie migration 085 exists
 *    to prevent.
 */
export function summarise(rows: RunRow[], now: Date): RegionLiveness[] {
  const today = ymdUTC(now);

  return FIRMS_REGIONS.map((r) => {
    const mine = rows.filter((row) => row.region === r.slug);

    if (mine.length === 0) {
      return {
        region: r.slug,
        severity: 'warn' as LivenessSeverity,
        staleDays: null,
        hoursSinceRun: null,
        latestDayCovered: null,
        neverRan: true,
      };
    }

    const lastRunMs = Math.max(...mine.map((row) => Date.parse(row.ran_at)));
    const hoursSinceRun = (now.getTime() - lastRunMs) / 3_600_000;

    const covered = mine.filter((row) => row.ok).map((row) => row.day_covered);
    const latestDayCovered = covered.length > 0 ? covered.sort().at(-1)! : null;
    const staleDays = latestDayCovered ? dayGap(latestDayCovered, today) : null;

    // Critical is judged on coverage, not on run recency: the thing that
    // cannot be undone is a day falling out of the FIRMS window.
    let severity: LivenessSeverity = 'ok';
    if (staleDays === null || staleDays >= CRITICAL_DAY_GAP) severity = 'critical';
    else if (hoursSinceRun > WARN_HOURS) severity = 'warn';

    return {
      region: r.slug,
      severity,
      staleDays,
      hoursSinceRun: Math.round(hoursSinceRun * 10) / 10,
      latestDayCovered,
      neverRan: false,
    };
  });
}

function describe(r: RegionLiveness): string {
  if (r.neverRan) return `${r.region} — NEVER INGESTED (no run recorded)`;
  const cov = r.latestDayCovered ?? 'none';
  const since = r.hoursSinceRun === null ? '?' : `${r.hoursSinceRun}h`;
  return `${r.region} — last run ${since} ago · newest covered day ${cov} (${r.staleDays}d behind)`;
}

async function post(text: string): Promise<void> {
  const url = process.env.NEWSJACK_ALERT_WEBHOOK;
  if (!url) return;
  try {
    // Both keys, matching lib/newsjack/notify.ts — Slack reads `text`,
    // Discord reads `content`.
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, content: text }),
    });
  } catch {
    /* fail-soft: an unreachable webhook must never break the host cron */
  }
}

/**
 * READ-ONLY probe: what is each shard's current state?
 *
 * Deliberately separate from checkShardLiveness because there are two
 * kinds of caller and only one of them should have side effects:
 *
 *   • the hourly cron ALERTS (posts to Discord, writes dedupe state)
 *   • the operator console DISPLAYS
 *
 * Rendering /admin/ingest-health must never post an alert or advance the
 * re-alert clock — otherwise opening the page would suppress the next
 * real alert by 6 hours, and refreshing it would spam the channel. A
 * dashboard that changes what it measures is not a dashboard.
 */
export async function probeShardLiveness(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<{ regions: RegionLiveness[]; errors: string[] }> {
  // Bounded window: enough to establish recency without scanning the
  // full history. A region silent for longer than this reads as
  // never_ran, which is the correct alert either way.
  const since = ymdUTC(new Date(now.getTime() - 30 * 86_400_000));

  const { data, error } = await supabase
    .from('firms_ingest_runs')
    .select('region, day_covered, ok, ran_at')
    .gte('day_covered', since);

  if (error) return { regions: [], errors: [`liveness query: ${error.message}`] };
  return { regions: summarise((data ?? []) as RunRow[], now), errors: [] };
}

/**
 * Probe every configured region, alert on the ones that need it, and
 * clear state for the ones that have recovered.
 *
 * Fail-soft throughout: every failure is collected into `errors` and
 * returned rather than thrown, because the host cron has real work of
 * its own that must not be lost to a monitoring bug.
 */
export async function checkShardLiveness(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<LivenessReport> {
  const errors: string[] = [];
  const alerted: string[] = [];
  const recovered: string[] = [];

  const probe = await probeShardLiveness(supabase, now);
  if (probe.errors.length > 0) {
    return {
      checkedAt: now.toISOString(),
      regions: [],
      unhealthy: [],
      alerted,
      recovered,
      errors: probe.errors,
    };
  }

  const regions = probe.regions;
  const unhealthy = regions.filter((r) => r.severity !== 'ok');
  const healthy = regions.filter((r) => r.severity === 'ok');

  const { data: stateRows, error: stateErr } = await supabase
    .from('firms_liveness_alerts')
    .select('region, severity, last_alerted_at');
  if (stateErr) errors.push(`liveness state: ${stateErr.message}`);

  const state = new Map(
    ((stateRows ?? []) as Array<{ region: string; severity: string; last_alerted_at: string }>).map(
      (r) => [r.region, r],
    ),
  );

  for (const r of unhealthy) {
    const prior = state.get(r.region);
    const escalated = prior !== undefined && prior.severity !== r.severity;
    const dueAgain =
      prior !== undefined &&
      now.getTime() - Date.parse(prior.last_alerted_at) >= REALERT_HOURS * 3_600_000;

    if (prior !== undefined && !escalated && !dueAgain) continue;

    const tag = r.severity === 'critical' ? 'CRITICAL' : 'WARN';
    const headline =
      r.severity === 'critical'
        ? 'FIRMS shard stale — recovery window closing'
        : 'FIRMS shard has stopped ingesting';
    const remedy =
      `Re-run: POST /api/cron/ingest-firms?region=${r.region} (Bearer CRON_SECRET)\n` +
      `Then check the Railway service has a Cron Schedule set — a service with none ` +
      `shows "Completed" and never fires again.`;
    const urgency =
      r.severity === 'critical'
        ? `\nA day this far behind is at the edge of the FIRMS NRT window. Once it falls ` +
          `out, the gap is PERMANENT and went_dark loses its coverage guarantee for that date.`
        : '';

    await post(`[${tag}] ${headline}\n${describe(r)}${urgency}\n${remedy}`);
    alerted.push(r.region);

    const { error: upErr } = await supabase.from('firms_liveness_alerts').upsert(
      {
        region: r.region,
        severity: r.severity,
        stale_days: r.staleDays ?? 999,
        hours_since_run: r.hoursSinceRun,
        last_alerted_at: now.toISOString(),
      },
      { onConflict: 'region' },
    );
    if (upErr) errors.push(`liveness upsert ${r.region}: ${upErr.message}`);
  }

  // Recovery: clear state and say so once, so the channel closes the
  // loop rather than leaving the last word as an alarm.
  const toClear = healthy.map((r) => r.region).filter((slug) => state.has(slug));
  if (toClear.length > 0) {
    const { error: delErr } = await supabase
      .from('firms_liveness_alerts')
      .delete()
      .in('region', toClear);
    if (delErr) errors.push(`liveness clear: ${delErr.message}`);
    else {
      recovered.push(...toClear);
      await post(`[RECOVERED] FIRMS shard(s) ingesting again: ${toClear.join(', ')}`);
    }
  }

  // Sweep rows for slugs no longer in FIRMS_REGIONS, so a retired region
  // cannot leave state that suppresses a future alert if it returns.
  const known = new Set(FIRMS_REGIONS.map((r) => r.slug));
  const orphans = Array.from(state.keys()).filter((slug) => !known.has(slug));
  if (orphans.length > 0) {
    await supabase.from('firms_liveness_alerts').delete().in('region', orphans);
  }

  return {
    checkedAt: now.toISOString(),
    regions,
    unhealthy,
    alerted,
    recovered,
    errors,
  };
}
