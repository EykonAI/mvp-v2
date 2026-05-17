import { createHash } from 'crypto';

/**
 * Canonical SHA-256 hash for a prediction's audit fields.
 *
 * Binds the five issuance fields so the prediction cannot be silently
 * edited after publication. Anyone holding the row can recompute the
 * hash and verify it matches the stored value.
 *
 * Canonical form (concatenated, no separator — must match the SQL
 * backfill in supabase/migrations/036_predictions_register_marketing.sql,
 * step 5):
 *
 *   statement
 *   || target_observable
 *   || resolves_at as ISO-8601 UTC with milliseconds
 *   || issued_at  as ISO-8601 UTC with milliseconds
 *   || predicted_distribution.mean (empty string if absent)
 *
 * Timestamps are normalised to UTC ISO-8601 (e.g. "2026-05-17T08:30:00.123Z")
 * so the hash is reproducible regardless of session timezone. The SQL
 * equivalent is `to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`.
 *
 * If you change the formula here, change the migration too — the hashes
 * on already-resolved predictions are the audit trail and must stay
 * verifiable.
 */
export function computePredictionHash(input: {
  statement: string;
  targetObservable: string;
  resolvesAt: Date | string;
  issuedAt: Date | string;
  predictedMean: number | string | null | undefined;
}): string {
  const toIsoUtc = (value: Date | string): string =>
    (value instanceof Date ? value : new Date(value)).toISOString();

  const meanText =
    input.predictedMean === null || input.predictedMean === undefined
      ? ''
      : String(input.predictedMean);

  const canonical =
    input.statement +
    input.targetObservable +
    toIsoUtc(input.resolvesAt) +
    toIsoUtc(input.issuedAt) +
    meanText;

  return createHash('sha256').update(canonical, 'utf-8').digest('hex');
}
