/**
 * Public-share framework for eYKON artifacts. Two artifact kinds are
 * supported in this PR:
 *
 *   analyst       → user_queries.share_token       (artifact type A2)
 *   notification  → user_notification_log.share_token (artifact type A4)
 *
 * Owner clicks Share → POST /api/share/create generates an opaque
 * share_token (s_<16 hex>), writes it on the row alongside shared_at,
 * and returns the public URL with ?ref=<owner.public_id> attached so
 * recipients are attributed back to the sharer when they sign up.
 *
 * Owner can revoke at any time → DELETE /api/share/revoke clears
 * share_token and shared_at (revocation is just NULL-out).
 *
 * The public route reads by share_token via the service-role client
 * because anonymous viewers have no RLS access.
 */

import { randomBytes } from 'crypto';
import type { ArtifactType } from '@/lib/referral/attribution';

export type ShareKind = 'analyst' | 'notification';

export const SHARE_KIND_ARTIFACT_TYPE: Record<ShareKind, ArtifactType> = {
  analyst: 'A2',
  notification: 'A4',
};

export const SHARE_KIND_TABLE: Record<ShareKind, 'user_queries' | 'user_notification_log'> = {
  analyst: 'user_queries',
  notification: 'user_notification_log',
};

export const SHARE_KIND_PATH: Record<ShareKind, string> = {
  analyst: '/analyst',
  notification: '/notification',
};

// 's_' + 16 hex chars (64 bits of entropy). Matches the format
// produced by the SQL helper generate_share_token() in migration 025.
// We generate in app code to avoid an extra round-trip + the RLS
// pitfalls of calling the helper from a user-scoped client (its
// collision check would be filtered to the caller's own rows).
const SHARE_TOKEN_REGEX = /^s_[a-f0-9]{16}$/;

export function generateShareToken(): string {
  return 's_' + randomBytes(8).toString('hex');
}

export function isValidShareToken(value: string | null | undefined): boolean {
  if (!value) return false;
  return SHARE_TOKEN_REGEX.test(value);
}

export function isShareKind(value: unknown): value is ShareKind {
  return value === 'analyst' || value === 'notification';
}

/**
 * Builds the absolute public URL for a shared artifact, with
 * ?ref=<owner.public_id> attached so recipients are attributed back
 * to the sharer when they sign up. Owner.public_id is the existing
 * column from migration 025; pass null when the owner is unknown
 * (the URL falls back to no attribution, which is still functional —
 * the artifact remains viewable, just unattributed).
 */
export function buildShareUrl(
  origin: string,
  kind: ShareKind,
  token: string,
  ownerPublicId: string | null,
): string {
  const base = origin.replace(/\/$/, '');
  const path = SHARE_KIND_PATH[kind];
  const url = `${base}${path}/${token}`;
  if (!ownerPublicId) return url;
  return `${url}?ref=${ownerPublicId}`;
}
