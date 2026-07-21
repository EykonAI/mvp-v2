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
