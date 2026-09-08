import type { Resolver } from './types';
import { INSTRUMENT_STALE_DAYS } from './data-clock';

/**
 * AIS chokepoint resolver.
 *
 * target_observable convention (set by issue-chokepoint-weekly.ts):
 *   `ais:chokepoint:<slug>:<resolves_at YYYY-MM-DD>`
 *
 * Reads the 7-day window of ais_chokepoint_observations ending at
 * resolves_at. If fewer than 5 days have landed in that window —
 * patchy AIS reception or snapshot-cron miss — returns null to defer
 * scoring; the hourly score-predictions cron retries on the next
 * tick once the daily snapshot catches up.
 *
 * Resolution semantics (binary, mirrors the EIA resolver):
 *   • observed = 1 when the observed_mean over the week aligns with
 *     context.predicted_direction.
 *   • observed = 0 otherwise.
 *
 * source_url points at the public Calibration Ledger page — a future
 * PR can deep-link to /intel/calibration/predictions/<public_id>
 * once that route exists.
 */
const RESOLVE_WINDOW_DAYS = 7;
const MIN_RESOLUTION_OBSERVATIONS = 5;

export const resolveAisChokepoint: Resolver = async (row, supabase) => {
  const parsed = parseTargetObservable(row.target_observable);
  if (!parsed) return null;

  const ctx = readContext(row.context);
  if (!ctx) return null;

  const resolvesAtMs = Date.parse(row.resolves_at);
  if (!Number.isFinite(resolvesAtMs)) return null;
  const windowStart = new Date(resolvesAtMs - RESOLVE_WINDOW_DAYS * 24 * 3600 * 1000);
  const windowEnd = new Date(resolvesAtMs);

  const { data: obs, error } = await supabase
    .from('ais_chokepoint_observations')
    .select('period, vessel_count')
    .eq('chokepoint', parsed.slug)
    .gte('period', ymd(windowStart))
    .lte('period', ymd(windowEnd))
    .order('period', { ascending: true });

  if (error) return null;
  const rows = obs ?? [];
  if (rows.length < MIN_RESOLUTION_OBSERVATIONS) {
    // The #482 rule for a real-time instrument. The chokepoint snapshot cron
    // publishes one row per strait per day and NEVER backfills: once it has
    // moved past the window, a thin window stays thin forever, and deferring
    // is a promise that cannot be kept. Six house claims sat "due" from
    // 2026-08-16 for this reason — the AIS-dead fortnight left the 08-10 week
    // with 0 rows and the 08-17 week with 3–4, under a resolver that only
    // ever answered "not yet". VOID names what was not seen; it is excluded
    // from every aggregate (types.ts), never a zero.
    const { data: newest } = await supabase
      .from('ais_chokepoint_observations')
      .select('period')
      .eq('chokepoint', parsed.slug)
      .order('period', { ascending: false })
      .limit(1)
      .maybeSingle();
    const clock = (newest as { period?: string } | null)?.period ?? null;
    if (clock !== null && clock > ymd(windowEnd)) {
      return {
        observed: 0,
        source_url: 'https://eykon.ai/intel/calibration',
        void_reason: `coverage_gap: ${rows.length}/${MIN_RESOLUTION_OBSERVATIONS} daily chokepoint observations for ${parsed.slug} in ${ymd(windowStart)}..${ymd(windowEnd)}; snapshots are not backfilled (newest ${clock}) — window cannot be judged`,
      };
    }
    // Instrument has not moved past the window: the missing days may still
    // land (today's snapshot). Backstop against a dead instrument, as for
    // the satellite families.
    const staleDays = (Date.now() - resolvesAtMs) / 86_400_000;
    if (staleDays > INSTRUMENT_STALE_DAYS) {
      return {
        observed: 0,
        source_url: 'https://eykon.ai/intel/calibration',
        void_reason: `chokepoint snapshots for ${parsed.slug} published only to ${clock ?? 'nothing'}, ${staleDays.toFixed(0)} d after the window — instrument did not publish the window, not looked`,
      };
    }
    return null;
  }

  const counts = rows
    .map((r) => Number(r.vessel_count))
    .filter((n) => Number.isFinite(n));
  if (counts.length === 0) return null;

  const observedMean = counts.reduce((a, b) => a + b, 0) / counts.length;
  const aboveBaseline = observedMean > ctx.baselineMeanVessels;
  const correct =
    ctx.predictedDirection === 'above' ? aboveBaseline : !aboveBaseline;

  return {
    observed: correct ? 1 : 0,
    source_url: 'https://eykon.ai/calibration',
  };
};

function parseTargetObservable(t: string): { slug: string } | null {
  // ais:chokepoint:<slug>:<YYYY-MM-DD>
  if (!t.startsWith('ais:chokepoint:')) return null;
  const rest = t.slice('ais:chokepoint:'.length);
  const colon = rest.lastIndexOf(':');
  if (colon <= 0) return null;
  const slug = rest.slice(0, colon);
  if (!slug) return null;
  return { slug };
}

interface ChokepointContext {
  baselineMeanVessels: number;
  predictedDirection: 'above' | 'below';
}

function readContext(context: Record<string, unknown> | null): ChokepointContext | null {
  if (!context) return null;
  const baseline = Number((context as Record<string, unknown>).baseline_mean_vessels);
  if (!Number.isFinite(baseline)) return null;
  const direction = (context as Record<string, unknown>).predicted_direction;
  if (direction !== 'above' && direction !== 'below') return null;
  return { baselineMeanVessels: baseline, predictedDirection: direction };
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
