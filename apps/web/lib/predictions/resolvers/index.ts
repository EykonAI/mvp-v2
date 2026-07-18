import { resolveManual } from './manual';
import { resolvePolymarket } from './polymarket';
import { resolveEia } from './eia';
import { resolveOfac } from './ofac';
import { resolveAisChokepoint } from './ais-chokepoint';
import { resolveFirms } from './firms';
import type { PredictionRow, Resolution, SupabaseAny } from './types';

export type { PredictionRow, Resolution } from './types';

/**
 * Dispatch a prediction row to its source-specific resolver.
 *
 * Unknown sources fall through to the manual resolver so seeded rows
 * predating the source column always resolve.
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
    case 'manual':
    default:
      return resolveManual(row, supabase);
  }
}
