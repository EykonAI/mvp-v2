import type { Resolver } from './types';

/**
 * EIA inventory resolver.
 *
 * target_observable convention (set by issue-eia-weekly.ts):
 *   `eia:<series_id>:<resolves_at YYYY-MM-DD>`
 *
 * The issuer creates "draw vs prior week" predictions: observed = 1.0
 * if the new print is lower than the baseline (a draw happened), 0.0
 * otherwise. Baseline is stored in context.baseline_kbbl.
 *
 * The EIA report week-ending date (Friday) precedes its Wednesday
 * publication by 5 days, so the resolver searches for the most recent
 * observation with period < resolves_at and period >= resolves_at - 14
 * days. The 14-day window absorbs ingest lag, daylight-savings shifts,
 * and holiday-week publication delays. If no observation falls in that
 * window the resolver returns null — the data isn't out yet — and the
 * next cron tick retries.
 */
export const resolveEia: Resolver = async (row, supabase) => {
  const parsed = parseTargetObservable(row.target_observable);
  if (!parsed) return null;

  const baseline = readBaseline(row.context);
  if (baseline == null) return null;

  const resolvesAtMs = Date.parse(row.resolves_at);
  if (!Number.isFinite(resolvesAtMs)) return null;
  const windowStart = new Date(resolvesAtMs - 14 * 24 * 3600 * 1000);
  const windowEnd = new Date(resolvesAtMs);

  const { data: obs, error } = await supabase
    .from('eia_inventory_observations')
    .select('period, value')
    .eq('series_id', parsed.series_id)
    .gte('period', ymd(windowStart))
    .lte('period', ymd(windowEnd))
    .order('period', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !obs) return null;

  // THE PRINT MUST BE NEWER THAN THE BASELINE.
  //
  // Without this check the resolver silently scored "no draw" every
  // single week. EIA publishes Wednesday morning and our ingest lands
  // later, so at scoring time the newest row in the table was still
  // the BASELINE row itself — and `observedValue < baseline` on two
  // identical numbers is false. Eleven of eleven claims resolved 0
  // while the real data shows nine genuine draws; the register
  // recorded a 0.000 base rate for an event that happens ~82% of the
  // time, and the house track's skill went negative on the strength
  // of it.
  //
  // This is the calibration form of the invariant the platform applies
  // everywhere else: ABSENCE OF AN OBSERVATION IS NOT A RESULT. A
  // missing print means "not published yet" — defer, and void once the
  // wait becomes unreasonable — never "the thing did not happen".
  const baselinePeriod = readBaselinePeriod(row.context);
  if (baselinePeriod && String(obs.period) <= baselinePeriod) {
    const overdueDays = (Date.now() - resolvesAtMs) / 86_400_000;
    if (overdueDays > VOID_AFTER_DAYS) {
      return {
        observed: 0,
        source_url: 'https://www.eia.gov/petroleum/supply/weekly/',
        void_reason: `no print newer than baseline ${baselinePeriod} within ${VOID_AFTER_DAYS} days of resolution`,
      };
    }
    return null; // not published/ingested yet — retry on the next tick
  }

  const observedValue = Number(obs.value);
  if (!Number.isFinite(observedValue)) return null;

  const draw = observedValue < baseline;
  return {
    observed: draw ? 1 : 0,
    source_url: 'https://www.eia.gov/petroleum/supply/weekly/',
  };
};

/**
 * How long to keep waiting for a print before the claim voids. EIA's
 * weekly report is published the Wednesday after the report week; 10
 * days absorbs holiday-week delays and an ingest outage without
 * leaving claims unresolved forever.
 */
const VOID_AFTER_DAYS = 10;

function readBaselinePeriod(context: Record<string, unknown> | null): string | null {
  const raw = context?.baseline_period;
  return typeof raw === 'string' && raw.length >= 10 ? raw.slice(0, 10) : null;
}

function parseTargetObservable(t: string): { series_id: string } | null {
  if (!t.startsWith('eia:')) return null;
  const rest = t.slice('eia:'.length);
  const colon = rest.indexOf(':');
  if (colon <= 0) return null;
  return { series_id: rest.slice(0, colon) };
}

function readBaseline(context: Record<string, unknown> | null): number | null {
  if (!context) return null;
  const raw = (context as Record<string, unknown>).baseline_kbbl;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
