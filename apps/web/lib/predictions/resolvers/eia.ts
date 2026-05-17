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

  const observedValue = Number(obs.value);
  if (!Number.isFinite(observedValue)) return null;

  const draw = observedValue < baseline;
  return {
    observed: draw ? 1 : 0,
    source_url: 'https://www.eia.gov/petroleum/supply/weekly/',
  };
};

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
