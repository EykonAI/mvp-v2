import { resolveManual } from './manual';
import { resolvePolymarket } from './polymarket';
import { resolveEia } from './eia';
import { resolveOfac } from './ofac';
import { resolveAisChokepoint } from './ais-chokepoint';
import { resolveFirms } from './firms';
import { resolveAisDarkgap } from './ais-darkgap';
import { resolveFirmsRecovery } from './firms-recovery';
import { resolveBlackmarble } from './blackmarble';
import { resolveRefineryRc } from './refinery-rc';
import type { PredictionRow, Resolution, SupabaseAny } from './types';

export type { PredictionRow, Resolution } from './types';

/**
 * Dispatch a prediction row to its source-specific resolver.
 *
 * NO RESOLVER, NO SCORE (Reality Check PR-5). The default used to fall
 * through to resolveManual, which writes a flat 0.5 and a Brier for a claim
 * nobody looked at — the flat-0.5 defect. A source with no case below now
 * resolves VOID ("no resolver"), on every track. Read 2026-09-19: no stored
 * claim relied on the default (ais, ais-darkgap, blackmarble, eia,
 * firms-recovery and polymarket all have cases); 'kalshi' and 'ai' are
 * admitted by predictions_register_source_check with no resolver and no rows.
 *
 * 'manual' keeps its operator placeholder for house and creator rows (none
 * stored today), but a MACHINE-track 'manual' row — an issuer that forgot to
 * set its source, the column's default — is VOID too: the machine track has
 * no operator to correct a placeholder.
 */
export async function resolveBySource(
  row: PredictionRow,
  supabase: SupabaseAny,
): Promise<Resolution | null> {
  switch (row.source) {
    case 'polymarket':
      return resolvePolymarket(row, supabase);
    case 'eia':
      return resolveEia(row, supabase);
    case 'ofac':
      return resolveOfac(row, supabase);
    case 'ais':
      return resolveAisChokepoint(row, supabase);
    case 'firms':
      return resolveFirms(row, supabase);
    case 'ais-darkgap':
      return resolveAisDarkgap(row, supabase);
    case 'firms-recovery':
      return resolveFirmsRecovery(row, supabase);
    case 'blackmarble':
      return resolveBlackmarble(row, supabase);
    case 'refinery-rc':
      return resolveRefineryRc(row, supabase);
    case 'manual': {
      const track = await trackOf(row, supabase);
      if (track === null) return null;                     // lookup failed — retry, never assume
      return track === 'machine' ? noResolver(row, 'machine-track claim with source manual') : resolveManual(row, supabase);
    }
    default:
      return noResolver(row, `source '${row.source}' has no resolver case`);
  }
}

/** VOID — never a score — for a claim no resolver can judge. */
export function noResolver(row: PredictionRow, why: string): Resolution {
  return {
    observed: 0,
    source_url: null,
    void_reason: `no resolver: ${why} (feature ${row.feature}) — nothing was observed, so nothing is scored`,
  };
}

/** The row's track: carried on the row when the caller has it, else one keyed read. */
async function trackOf(row: PredictionRow, supabase: SupabaseAny): Promise<string | null> {
  if (typeof row.track === 'string' && row.track) return row.track;
  const { data, error } = await supabase.from('predictions_register').select('track').eq('id', row.id).maybeSingle();
  if (error) return null;
  return (data as { track?: string } | null)?.track ?? 'house';
}
