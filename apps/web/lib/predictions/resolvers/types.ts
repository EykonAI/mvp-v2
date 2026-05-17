import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Shape returned by each per-source resolver.
 *
 *   observed:   normalised outcome in [0, 1] — same axis as
 *               predicted_distribution.mean, so Brier and log-loss are
 *               directly meaningful.
 *   source_url: where the public page should link readers to verify
 *               the resolution. Null when no canonical URL is known.
 *
 * Resolvers return null to mean "data not yet available, retry on the
 * next cron tick". This is critical for ingest lag — e.g. a Polymarket
 * market that hasn't closed yet, or an EIA report not yet published.
 */
export interface Resolution {
  observed: number;
  source_url: string | null;
}

export interface PredictionRow {
  id: string;
  feature: string;
  source: string;
  target_observable: string;
  resolves_at: string;
  issued_at: string;
  context: Record<string, unknown> | null;
  predicted_distribution: Record<string, unknown> | null;
}

export type SupabaseAny = SupabaseClient;

export type Resolver = (
  row: PredictionRow,
  supabase: SupabaseAny,
) => Promise<Resolution | null>;
