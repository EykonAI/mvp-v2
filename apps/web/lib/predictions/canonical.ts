/**
 * Canonical form for a prediction's audit hash — the SINGLE definition,
 * shared by the server-side hasher (lib/predictions/hash.ts) and the
 * in-browser verifier (components/briefs/HashVerifier.tsx).
 *
 * This module must stay client-safe: no node imports, no crypto. It builds
 * the string; the two consumers hash it with their own primitive (node
 * `createHash` on the server, Web Crypto `subtle.digest` in the browser).
 * Splitting the string from the hash is what makes it impossible for the
 * published verifier and the issuing code to drift — they concatenate the
 * same bytes by construction.
 *
 * Canonical form (concatenated, no separator — matches the SQL backfill in
 * supabase/migrations/036_predictions_register_marketing.sql, step 5):
 *
 *   statement
 *   || target_observable
 *   || resolves_at as ISO-8601 UTC with milliseconds
 *   || issued_at  as ISO-8601 UTC with milliseconds
 *   || predicted_distribution.mean (empty string if absent)
 *
 * Verified against production 2026-08-15: recomputed the two newest rows'
 * stored hashes from these fields exactly, and confirmed a one-word tamper
 * flips the digest.
 *
 * If you change the formula here, change the migration too — the hashes on
 * already-resolved predictions are the audit trail and must stay verifiable.
 */
export interface CanonicalPredictionInput {
  statement: string;
  targetObservable: string;
  resolvesAt: Date | string;
  issuedAt: Date | string;
  predictedMean: number | string | null | undefined;
}

export function canonicalPredictionString(input: CanonicalPredictionInput): string {
  // Fail loud at issue: a hash over an empty statement or observable would
  // "verify" a claim that says nothing. Refuse rather than warn.
  if (!input.statement || !input.targetObservable) {
    throw new Error(
      'canonicalPredictionString: statement and targetObservable are required — refusing to hash an empty claim',
    );
  }

  const toIsoUtc = (value: Date | string): string =>
    (value instanceof Date ? value : new Date(value)).toISOString();

  const meanText =
    input.predictedMean === null || input.predictedMean === undefined
      ? ''
      : String(input.predictedMean);

  return (
    input.statement +
    input.targetObservable +
    toIsoUtc(input.resolvesAt) +
    toIsoUtc(input.issuedAt) +
    meanText
  );
}
