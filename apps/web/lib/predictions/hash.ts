import { createHash } from 'crypto';
import {
  canonicalPredictionString,
  type CanonicalPredictionInput,
} from './canonical';

/**
 * Canonical SHA-256 hash for a prediction's audit fields.
 *
 * Binds the five issuance fields so the prediction cannot be silently
 * edited after publication. Anyone holding the row can recompute the
 * hash and verify it matches the stored value — the in-browser verifier
 * on /briefs/forecasts/[id] does exactly that.
 *
 * The canonical form lives in ./canonical.ts (client-safe, shared with
 * the browser verifier so the two cannot drift). If you change it,
 * change migration 036's SQL backfill too — the hashes on already-
 * resolved predictions are the audit trail and must stay verifiable.
 */
export function computePredictionHash(input: CanonicalPredictionInput): string {
  return createHash('sha256')
    .update(canonicalPredictionString(input), 'utf-8')
    .digest('hex');
}

/**
 * Salted commitment hash for a SEALED prediction (§9 commit-reveal).
 *
 * Same canonical form as computePredictionHash, concatenated with a
 * server-held secret `nonce`, so the commitment is *hiding* as well as
 * *binding*: without the nonce the small (statement, probability) space
 * is brute-forceable, which would unseal a still-committed call. At
 * resolves_at the plaintext + nonce are revealed and re-hashed to verify
 * against this value.
 *
 * This is the CREATOR-track mechanic (COMM sealed calls, /api/comm/predict).
 * House forecasts are published on issue day, so they use the plain
 * binding hash above — hiding does no work for a public forecast, and the
 * two mechanisms must not be conflated in copy: house is "hashed at
 * issue", creator calls are "sealed".
 */
export function computeCommitHash(
  input: CanonicalPredictionInput & { nonce: string },
): string {
  return createHash('sha256')
    .update(canonicalPredictionString(input) + input.nonce, 'utf-8')
    .digest('hex');
}
