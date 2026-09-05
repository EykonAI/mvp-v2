// ─── API-key auth for programmatic access (migration 117) ────────
//
// The auth substrate for the MCP server (PR-2) and any later REST
// surface. Deliberately transport-agnostic: nothing here knows about
// MCP, JSON-RPC or Next — it takes an Authorization header value and
// returns a caller or a typed refusal.
//
// KEY FORMAT
//   eyk_<43 chars base64url>   = 'eyk_' + 32 bytes of CSPRNG
//
//   The 'eyk_' prefix exists so a leaked key is greppable in logs,
//   gists and repositories, and so secret scanners can be taught one
//   pattern. The stored key_prefix is 'eyk_' + the first 8 secret
//   chars — enough to name a key in a list, useless for authenticating.
//
// WHAT IS STORED
//   Only sha256(key). The plaintext is returned to the caller ONCE by
//   createApiKey() and never persisted, so a database disclosure does
//   not yield working keys. See migration 117 for why a fast hash is
//   the right choice for a high-entropy secret.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServerSupabase } from '@/lib/supabase-server';
import { getTierForUserId } from '@/lib/subscription';
import type { Tier } from '@/lib/pricing';

export const KEY_PREFIX = 'eyk_';
const SECRET_BYTES = 32;
const PREFIX_DISPLAY_CHARS = 8;

/** How stale last_used_at may get before the resolver refreshes it. */
const LAST_USED_REFRESH_MS = 5 * 60 * 1000;

export interface ApiCaller {
  userId: string;
  tier: Tier;
  keyId: string;
  keyPrefix: string;
}

export type AuthFailure =
  | { ok: false; reason: 'missing'; message: string }
  | { ok: false; reason: 'malformed'; message: string }
  | { ok: false; reason: 'unknown'; message: string }
  | { ok: false; reason: 'revoked'; message: string }
  | { ok: false; reason: 'expired'; message: string };

export type AuthResult = { ok: true; caller: ApiCaller } | AuthFailure;

// ─── Hashing ─────────────────────────────────────────────────────

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/**
 * Constant-time compare of two hex digests.
 *
 * The lookup below is by hash equality in Postgres, which is not
 * constant-time — but that comparison happens on the HASH, never on
 * the secret, and a hash is not a credential. This helper exists for
 * the places that do compare a caller-supplied value directly.
 */
export function safeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

// ─── Issuing ─────────────────────────────────────────────────────

export interface CreatedKey {
  /** Shown to the user exactly once. Never stored, never logged. */
  plaintext: string;
  id: string;
  keyPrefix: string;
}

export async function createApiKey(
  userId: string,
  label: string,
  opts: { expiresAt?: Date } = {},
): Promise<CreatedKey> {
  const secret = randomBytes(SECRET_BYTES).toString('base64url');
  const plaintext = `${KEY_PREFIX}${secret}`;
  const keyPrefix = `${KEY_PREFIX}${secret.slice(0, PREFIX_DISPLAY_CHARS)}`;

  const admin = createServerSupabase();
  const { data, error } = await admin
    .from('api_keys')
    .insert({
      user_id: userId,
      key_hash: hashApiKey(plaintext),
      key_prefix: keyPrefix,
      label: label.trim().slice(0, 80),
      expires_at: opts.expiresAt?.toISOString() ?? null,
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`Could not create API key: ${error?.message ?? 'no row returned'}`);
  }
  return { plaintext, id: data.id as string, keyPrefix };
}

export async function revokeApiKey(userId: string, keyId: string): Promise<boolean> {
  const admin = createServerSupabase();
  // Scoped by user_id as well as id: a caller must not be able to
  // revoke someone else's key by guessing a uuid.
  const { data, error } = await admin
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId)
    .eq('user_id', userId)
    .is('revoked_at', null)
    .select('id');
  if (error) throw new Error(`Could not revoke API key: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

// ─── Resolving ───────────────────────────────────────────────────

/**
 * Extracts a key from an Authorization header.
 *
 * Accepts `Bearer eyk_…` and a bare `eyk_…`. Bearer is what MCP
 * clients send; the bare form is what people paste into curl by hand,
 * and refusing it would produce a confusing 401 for a key that is
 * perfectly valid.
 */
export function extractKey(headerValue: string | null | undefined): string | null {
  if (!headerValue) return null;
  const raw = headerValue.trim();
  const bearer = /^Bearer\s+(.+)$/i.exec(raw);
  const candidate = (bearer ? bearer[1] : raw).trim();
  return candidate.length > 0 ? candidate : null;
}

/**
 * Resolves an Authorization header to a caller, or a typed refusal.
 *
 * Every refusal is DISTINGUISHABLE — missing / malformed / unknown /
 * revoked / expired. §13.2.3: a gate must say what it caught. A single
 * opaque 401 makes a revoked key indistinguishable from a typo, which
 * is the difference between "rotate this now" and "check your paste".
 *
 * The messages are safe to return to the caller: none of them confirm
 * whether a particular key ever existed beyond what the holder of the
 * key already knows.
 */
export async function resolveApiKey(
  authorizationHeader: string | null | undefined,
): Promise<AuthResult> {
  const key = extractKey(authorizationHeader);
  if (!key) {
    return {
      ok: false,
      reason: 'missing',
      message: 'Missing Authorization header. Send: Authorization: Bearer eyk_…',
    };
  }
  if (!key.startsWith(KEY_PREFIX)) {
    return {
      ok: false,
      reason: 'malformed',
      message: `Not an eYKON API key — keys start with "${KEY_PREFIX}". Create one at /settings/api.`,
    };
  }

  const admin = createServerSupabase();
  const { data, error } = await admin
    .from('api_keys')
    .select('id, user_id, key_prefix, revoked_at, expires_at, last_used_at')
    .eq('key_hash', hashApiKey(key))
    .maybeSingle();

  // Fail loud: a database error is NOT "unknown key". Conflating them
  // would turn an outage into a wall of misleading 401s and send
  // everyone hunting for a credential problem that does not exist.
  if (error) {
    throw new Error(`API key lookup failed: ${error.message}`);
  }
  if (!data) {
    return {
      ok: false,
      reason: 'unknown',
      message: 'API key not recognised. It may have been deleted, or copied incompletely.',
    };
  }
  if (data.revoked_at) {
    return {
      ok: false,
      reason: 'revoked',
      message: `API key ${data.key_prefix}… was revoked on ${new Date(
        data.revoked_at as string,
      ).toISOString().slice(0, 10)}. Create a new one at /settings/api.`,
    };
  }
  if (data.expires_at && new Date(data.expires_at as string).getTime() <= Date.now()) {
    return {
      ok: false,
      reason: 'expired',
      message: `API key ${data.key_prefix}… expired on ${new Date(
        data.expires_at as string,
      ).toISOString().slice(0, 10)}. Create a new one at /settings/api.`,
    };
  }

  const tier = await getTierForUserId(data.user_id as string);

  // Throttled — an authenticated read should not also be a write on
  // every call. Fire-and-forget: last_used_at is convenience metadata
  // for the management UI, and failing to record it must never fail
  // the request the caller actually made.
  const last = data.last_used_at ? new Date(data.last_used_at as string).getTime() : 0;
  if (Date.now() - last > LAST_USED_REFRESH_MS) {
    void admin
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', data.id)
      .then(({ error: e }) => {
        if (e) console.warn('[mcp/auth] last_used_at refresh failed:', e.message);
      });
  }

  return {
    ok: true,
    caller: {
      userId: data.user_id as string,
      tier,
      keyId: data.id as string,
      keyPrefix: data.key_prefix as string,
    },
  };
}

/** Keys a user can see in the management UI (PR-4). Never the secret. */
export async function listApiKeys(userId: string) {
  const admin = createServerSupabase();
  const { data, error } = await admin
    .from('api_keys')
    .select('id, key_prefix, label, last_used_at, revoked_at, expires_at, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Could not list API keys: ${error.message}`);
  return data ?? [];
}
