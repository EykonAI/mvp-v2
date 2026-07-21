import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Live-feed freshness monitoring — the non-FIRMS ingest paths.
 *
 * Companion to lib/firms/liveness.ts, deliberately built on a DIFFERENT
 * mechanism, because the two questions are different:
 *
 *   • FIRMS asks "was this facility WATCHED on this day?" — where a missing
 *     detection must be distinguishable from a missing coverage. That needs
 *     an explicit per-run coverage table (firms_ingest_runs), because "no
 *     row" has to mean "we didn't look", not "nothing was there".
 *
 *   • AIS / GDELT / ADS-B ask only "is fresh data still landing?" — and the
 *     honest answer is max(ingested_at) on the table the feed writes. No
 *     proxy, no second table to keep in sync, and nothing to add to the
 *     long-running ingest workers (which stream continuously and have no
 *     discrete "runs" to record anyway).
 *
 * This exists because on 2026-07-21 the AIS worker (services/ais-ingest)
 * silently stopped for ~33h while Railway showed it "Online" and aircraft
 * stayed fresh. The FIRMS health page could not see it — by design, it is
 * FIRMS-only. This closes that gap for the three core live feeds.
 *
 * READ-ONLY: this probe never writes. Thresholds are per-feed because the
 * cadences differ by an order of magnitude, and are env-overridable so they
 * can be tightened once watched against real data for a few days.
 */

export type FeedSeverity = 'ok' | 'warn' | 'critical';

export interface FeedSpec {
  key: string;
  label: string;
  /** The table the feed writes; freshness is max() of tsColumn here. */
  table: string;
  tsColumn: string;
  /** Stale beyond this ⇒ warn. Tuned to each feed's normal cadence. */
  warnHours: number;
  /** Stale beyond this ⇒ critical (unambiguously broken). */
  criticalHours: number;
  /** Remediation hint: which Railway service produces this, so the page can say how to fix it. */
  source: string;
}

// Thresholds reasoned from observed cadence (verified 2026-07-21), NOT guessed:
//   ADS-B  ~375 rows/h (sub-minute gaps)  → warn 1h  / crit 3h
//   AIS    ~27 rows/h  (sparse, bursty)   → warn 3h  / crit 12h  (conservative: avoid false alarms)
//   GDELT  15-min upstream + cron/proc lag → warn 2h / crit 6h
// The 2026-07-21 AIS outage was 33h — caught as critical under any of these.
export const FEEDS: FeedSpec[] = [
  {
    key: 'adsb',
    label: 'ADS-B · aircraft',
    table: 'aircraft_positions',
    tsColumn: 'ingested_at',
    warnHours: Number(process.env.FEED_WARN_ADSB ?? 1),
    criticalHours: Number(process.env.FEED_CRIT_ADSB ?? 3),
    source: 'services/adsb-ingest (Railway worker)',
  },
  {
    key: 'ais',
    label: 'AIS · vessels',
    table: 'vessel_positions',
    tsColumn: 'ingested_at',
    warnHours: Number(process.env.FEED_WARN_AIS ?? 3),
    criticalHours: Number(process.env.FEED_CRIT_AIS ?? 12),
    source: 'services/ais-ingest (Railway worker · AISStream WS)',
  },
  {
    key: 'gdelt',
    label: 'GDELT · conflict',
    table: 'conflict_events',
    tsColumn: 'ingested_at',
    warnHours: Number(process.env.FEED_WARN_GDELT ?? 2),
    criticalHours: Number(process.env.FEED_CRIT_GDELT ?? 6),
    source: 'cron-ingest-gdelt (Railway cron)',
  },
];

export interface FeedHealth {
  key: string;
  label: string;
  source: string;
  severity: FeedSeverity;
  latest: string | null;
  hoursStale: number | null;
  warnHours: number;
  criticalHours: number;
}

export const SEVERITY_RANK: Record<FeedSeverity, number> = { critical: 0, warn: 1, ok: 2 };

/**
 * Probe every feed's freshness. Fail-soft per feed: a query error marks
 * THAT feed critical (a feed we cannot even read is not healthy) and is
 * collected into errors, rather than throwing and taking the page down.
 */
export async function probeFeedHealth(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<{ feeds: FeedHealth[]; errors: string[] }> {
  const errors: string[] = [];

  const feeds = await Promise.all(
    FEEDS.map(async (f): Promise<FeedHealth> => {
      const base = {
        key: f.key,
        label: f.label,
        source: f.source,
        warnHours: f.warnHours,
        criticalHours: f.criticalHours,
      };

      // ORDER BY tsColumn DESC LIMIT 1 — index-backed on aircraft/vessels;
      // a single seq scan on conflict_events (no index, ~370k rows, sub-100ms).
      const { data, error } = await supabase
        .from(f.table)
        .select(f.tsColumn)
        .order(f.tsColumn, { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        errors.push(`${f.key}: ${error.message}`);
        return { ...base, severity: 'critical', latest: null, hoursStale: null };
      }

      const raw = data ? (data as unknown as Record<string, unknown>)[f.tsColumn] : null;
      const latest = typeof raw === 'string' ? raw : null;
      if (!latest) {
        // An empty feed table is not "fresh" — treat as broken, loudly.
        return { ...base, severity: 'critical', latest: null, hoursStale: null };
      }

      const hoursStale = (now.getTime() - Date.parse(latest)) / 3_600_000;
      let severity: FeedSeverity = 'ok';
      if (hoursStale >= f.criticalHours) severity = 'critical';
      else if (hoursStale >= f.warnHours) severity = 'warn';

      return { ...base, severity, latest, hoursStale: Math.round(hoursStale * 10) / 10 };
    }),
  );

  return { feeds, errors };
}

// ─── Alerting (the push half) ──────────────────────────────────────
// probeFeedHealth above is READ-ONLY and drives the /admin/ingest-health
// page. checkFeedHealth below is its side-effecting sibling — the exact
// counterpart of checkShardLiveness in lib/firms/liveness.ts, sharing the
// same dedup discipline and the same Discord webhook — so the two liveness
// mechanisms behave identically and a reader learns one pattern, not two.
//
// Rendering the page must NEVER call this: displaying health must not post
// an alert or advance the re-alert clock, or opening the page would suppress
// the next real alert and refreshing it would spam the channel.

// Re-alert cadence for a feed that stays broken. Escalations bypass it.
const FEED_REALERT_HOURS = Number(process.env.FEED_REALERT_HOURS ?? 6);

export interface FeedHealthReport {
  checkedAt: string;
  feeds: FeedHealth[];
  unhealthy: FeedHealth[];
  alerted: string[];
  recovered: string[];
  errors: string[];
}

async function post(text: string): Promise<void> {
  const url = process.env.NEWSJACK_ALERT_WEBHOOK;
  if (!url) return;
  try {
    // Both keys, matching lib/firms/liveness.ts and lib/newsjack/notify.ts —
    // Slack reads `text`, Discord reads `content`.
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, content: text }),
    });
  } catch {
    /* fail-soft: an unreachable webhook must never break the host cron */
  }
}

function describe(f: FeedHealth): string {
  const stale = f.hoursStale === null ? 'unreadable' : `${f.hoursStale}h stale`;
  const latest = f.latest ?? 'no rows';
  return `${f.label} — ${stale} (newest ${latest}) · threshold warn ${f.warnHours}h / crit ${f.criticalHours}h`;
}

/**
 * Probe every live feed, alert on the ones that need it, clear state for the
 * ones that have recovered. Fail-soft throughout: every failure is collected
 * into `errors` and returned, never thrown — the host cron has real work of
 * its own that a monitoring bug must not cost.
 *
 * Known limit, stated rather than hidden (identical to firms liveness): this
 * rides inside a host cron, so if that cron stops firing the probe stops with
 * it. It guards against one feed dying, not against the scheduler dying — but
 * a dead host cron at least shows red in Railway, which the silent-feed case
 * did not.
 */
export async function checkFeedHealth(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<FeedHealthReport> {
  const errors: string[] = [];
  const alerted: string[] = [];
  const recovered: string[] = [];

  const probe = await probeFeedHealth(supabase, now);
  // A probe error means a specific feed was marked critical (see above), which
  // is itself alertable — so we do NOT bail here the way firms liveness does on
  // a whole-query failure; we carry the errors through and still alert.
  errors.push(...probe.errors);

  const feeds = probe.feeds;
  const unhealthy = feeds.filter((f) => f.severity !== 'ok');
  const healthy = feeds.filter((f) => f.severity === 'ok');

  const { data: stateRows, error: stateErr } = await supabase
    .from('live_feed_alerts')
    .select('feed, severity, last_alerted_at');
  if (stateErr) errors.push(`feed-alert state: ${stateErr.message}`);

  const state = new Map(
    ((stateRows ?? []) as Array<{ feed: string; severity: string; last_alerted_at: string }>).map(
      (r) => [r.feed, r],
    ),
  );

  for (const f of unhealthy) {
    const prior = state.get(f.key);
    const escalated = prior !== undefined && prior.severity !== f.severity;
    const dueAgain =
      prior !== undefined &&
      now.getTime() - Date.parse(prior.last_alerted_at) >= FEED_REALERT_HOURS * 3_600_000;

    if (prior !== undefined && !escalated && !dueAgain) continue;

    const tag = f.severity === 'critical' ? 'CRITICAL' : 'WARN';
    const headline =
      f.severity === 'critical'
        ? 'Live feed down — fresh data has stopped landing'
        : 'Live feed going stale';
    const remedy =
      `Fix here: ${f.source}\n` +
      `A Railway worker showing "Online" or a cron showing "Completed" is NOT proof ` +
      `it is producing rows — check max(${'ingested_at'}) on the feed's table.`;

    await post(`[${tag}] ${headline}\n${describe(f)}\n${remedy}`);
    alerted.push(f.key);

    const { error: upErr } = await supabase.from('live_feed_alerts').upsert(
      {
        feed: f.key,
        severity: f.severity,
        hours_stale: f.hoursStale,
        last_alerted_at: now.toISOString(),
      },
      { onConflict: 'feed' },
    );
    if (upErr) errors.push(`feed-alert upsert ${f.key}: ${upErr.message}`);
  }

  // Recovery: clear state and say so once, so the channel closes the loop
  // rather than leaving the last word as an alarm.
  const toClear = healthy.map((f) => f.key).filter((key) => state.has(key));
  if (toClear.length > 0) {
    const { error: delErr } = await supabase
      .from('live_feed_alerts')
      .delete()
      .in('feed', toClear);
    if (delErr) errors.push(`feed-alert clear: ${delErr.message}`);
    else {
      recovered.push(...toClear);
      const labels = toClear
        .map((key) => feeds.find((f) => f.key === key)?.label ?? key)
        .join(', ');
      await post(`[RECOVERED] Live feed(s) landing again: ${labels}`);
    }
  }

  // Sweep rows for feed keys no longer in FEEDS, so a retired feed cannot
  // leave state that suppresses a future alert if it returns.
  const known = new Set(FEEDS.map((f) => f.key));
  const orphans = Array.from(state.keys()).filter((key) => !known.has(key));
  if (orphans.length > 0) {
    await supabase.from('live_feed_alerts').delete().in('feed', orphans);
  }

  return {
    checkedAt: now.toISOString(),
    feeds,
    unhealthy,
    alerted,
    recovered,
    errors,
  };
}
