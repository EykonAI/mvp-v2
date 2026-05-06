/**
 * Component A — server-side attribution capture. Called from
 * /api/attribution/capture (and from PRs 4–5 public artifact pages).
 * Writes one row to attribution_events for every valid capture, and
 * sets referred_by_pending on free-tier authenticated recipients per
 * spec §1.3 step 5.
 *
 * Attribution is silent: failures are logged server-side but never
 * surface to the caller. The route handler returns 204 unconditionally.
 */

import { createHash } from 'crypto';
import { createServerSupabase } from '@/lib/supabase-server';
import { isValidPublicId, isValidArtifactType, type ArtifactType } from './attribution';

export type CaptureInput = {
  ref: string | null;
  artifactType: string | null;
  artifactId: string | null;
  recipientUserId: string | null; // auth.uid() if authenticated
  recipientSessionId: string | null;
  rawIp: string | null;
};

export type CaptureResult =
  | { ok: true }
  | { ok: false; reason: CaptureSkipReason };

export type CaptureSkipReason =
  | 'invalid_ref_format'
  | 'invalid_artifact'
  | 'unknown_referrer'
  | 'self_ref'
  | 'recipient_paid'
  | 'recipient_already_attributed';

/**
 * Hashes an IP with SHA-256. The raw IP is never persisted — spec §4.5
 * stores ip_hash so analytics can dedupe a single visitor's events
 * without holding PII.
 */
export function hashIpAddress(ip: string): string {
  return createHash('sha256').update(ip).digest('hex');
}

export async function captureAttribution(input: CaptureInput): Promise<CaptureResult> {
  if (!isValidPublicId(input.ref)) {
    return { ok: false, reason: 'invalid_ref_format' };
  }
  if (!isValidArtifactType(input.artifactType)) {
    return { ok: false, reason: 'invalid_artifact' };
  }
  if (!input.artifactId || input.artifactId.length === 0 || input.artifactId.length > 200) {
    return { ok: false, reason: 'invalid_artifact' };
  }

  const ref = input.ref as string;
  const artifactType = input.artifactType as ArtifactType;

  const supabase = createServerSupabase();

  // Look up the referrer. We need both the row's id (for self-ref check
  // and for the FK on referred_by_pending finalisation later) and the
  // tier (a deleted referrer's tier defaults to 'citizen' in this codebase
  // — there is no separate banned/deleted flag yet, so we treat
  // "row exists" as sufficient validation per spec §1.4 ATTRIBUTION TO A
  // DELETED OR BANNED USER, deferring banned-state checks to a later PR).
  const { data: referrer } = await supabase
    .from('user_profiles')
    .select('id, public_id')
    .eq('public_id', ref)
    .maybeSingle();

  if (!referrer) {
    return { ok: false, reason: 'unknown_referrer' };
  }

  // If the recipient is the referrer themselves, discard. Spec §1.4
  // SELF-REFERRAL: "the user record's referred_by field stays null."
  if (input.recipientUserId && input.recipientUserId === referrer.id) {
    return { ok: false, reason: 'self_ref' };
  }

  // If the recipient is already paying, attribution is a no-op. Spec
  // §1.3 step 4: "If the recipient is already authenticated as a paying
  // user, do nothing — they cannot be attributed to anyone."
  let recipientTier: string | null = null;
  let recipientReferredByPending: string | null = null;
  let recipientReferredBy: string | null = null;

  if (input.recipientUserId) {
    const { data: recipient } = await supabase
      .from('user_profiles')
      .select('tier, referred_by, referred_by_pending')
      .eq('id', input.recipientUserId)
      .maybeSingle();

    if (recipient) {
      recipientTier = recipient.tier ?? null;
      recipientReferredBy = (recipient as { referred_by: string | null }).referred_by ?? null;
      recipientReferredByPending =
        (recipient as { referred_by_pending: string | null }).referred_by_pending ?? null;
    }

    if (recipientTier && recipientTier !== 'citizen') {
      return { ok: false, reason: 'recipient_paid' };
    }

    // Spec §1.4 DUPLICATE ATTRIBUTION ATTEMPT: "If the user already has
    // a referred_by_pending value when a new ?ref= cookie attempts to
    // overwrite it, the original wins (first-touch persistence)."
    if (recipientReferredBy || recipientReferredByPending) {
      // Still log the event for analytics — capturing every share
      // including the non-binding ones is the value of attribution_events
      // (spec §4.5 / §1.6). But do not overwrite the pending pointer.
      await logEvent();
      return { ok: false, reason: 'recipient_already_attributed' };
    }
  }

  await logEvent();

  // Finalise the pending pointer for free-tier authenticated recipients
  // per spec §1.3 step 5. Anonymous recipients persist via the cookie
  // until signup; that path is wired in PR 3.
  if (input.recipientUserId && recipientTier === 'citizen') {
    await supabase
      .from('user_profiles')
      .update({ referred_by_pending: ref })
      .eq('id', input.recipientUserId)
      // Re-check no-overwrite at update time to close the
      // race between the SELECT above and this UPDATE.
      .is('referred_by_pending', null)
      .is('referred_by', null);
  }

  return { ok: true };

  async function logEvent() {
    await supabase.from('attribution_events').insert({
      referrer_public_id: ref,
      artifact_type: artifactType,
      artifact_id: input.artifactId,
      recipient_session_id: input.recipientSessionId,
      recipient_user_id: input.recipientUserId,
      ip_hash: input.rawIp ? hashIpAddress(input.rawIp) : null,
    });
  }
}
