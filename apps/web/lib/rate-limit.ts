/**
 * In-app rate limit helpers for open POST endpoints (PR-S2, see
 * docs/SECURITY_HARDENING_PLAN.md §4 PR-S2).
 *
 * Storage: Postgres counts via the service-role client. No new tables,
 * no migration — we count rows already being written by the protected
 * routes (attribution_events.ip_hash for the silent attribution path,
 * user_queries/user_notification_log.shared_at for share creation).
 *
 * Failure mode: fail-open. If the count query errors, the helper
 * returns `{ exceeded: false }` so a buggy limiter never breaks the
 * existing flow. Errors are logged server-side via console.error
 * (PR-S3 will sweep these into safeError).
 *
 * Layering note: this is the SOLE rate-limit layer for these routes
 * under Path A (Cloudflare WAF deferred until DNS migrates). Do not
 * rely on edge-layer absorption.
 *
 * Performance: at launch volumes the queries are bounded by an indexed
 * column scan (`attribution_events` has no index on ip_hash, but the
 * created_at filter clamps the row set; `user_queries` and
 * `user_notification_log` are tiny tables). A composite index on
 * `(ip_hash, created_at DESC)` is a Phase-2 follow-up if attribution
 * volume grows past ~100k rows.
 */

import { createServerSupabase } from '@/lib/supabase-server';

export type RateLimitResult = {
  /** true when the caller has hit or exceeded the configured ceiling */
  exceeded: boolean;
  /** current count in the window (best-effort; 0 on error) */
  current: number;
};

const FAIL_OPEN: RateLimitResult = { exceeded: false, current: 0 };

/**
 * Counts attribution_events for the given ip_hash in the trailing window.
 * Returns `exceeded: true` once `current >= max`.
 *
 * The IP is hashed by the caller (see lib/referral/capture#hashIpAddress)
 * because attribution_events stores ip_hash, never the raw IP.
 */
export async function checkAttributionIpRate(opts: {
  ipHash: string;
  windowSeconds: number;
  max: number;
}): Promise<RateLimitResult> {
  if (!opts.ipHash) return FAIL_OPEN;

  const cutoff = new Date(Date.now() - opts.windowSeconds * 1000).toISOString();
  try {
    const admin = createServerSupabase();
    const { count, error } = await admin
      .from('attribution_events')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', opts.ipHash)
      .gt('created_at', cutoff);

    if (error) {
      console.error('[rate-limit] attribution count failed', error.message);
      return FAIL_OPEN;
    }

    const current = count ?? 0;
    return { exceeded: current >= opts.max, current };
  } catch (err) {
    console.error('[rate-limit] attribution count threw', err);
    return FAIL_OPEN;
  }
}

/**
 * Counts the user's recent share creations across both shareable tables
 * (`user_queries` for analyst artifacts, `user_notification_log` for
 * notification artifacts) in the trailing window. A row counts only when
 * `shared_at > cutoff` — the route is idempotent on re-clicks so re-shares
 * of an already-shared artifact don't bump the count.
 */
export async function checkUserShareRate(opts: {
  userId: string;
  windowSeconds: number;
  max: number;
}): Promise<RateLimitResult> {
  if (!opts.userId) return FAIL_OPEN;

  const cutoff = new Date(Date.now() - opts.windowSeconds * 1000).toISOString();
  try {
    const admin = createServerSupabase();
    const [analyst, notif] = await Promise.all([
      admin
        .from('user_queries')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', opts.userId)
        .gt('shared_at', cutoff),
      admin
        .from('user_notification_log')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', opts.userId)
        .gt('shared_at', cutoff),
    ]);

    if (analyst.error || notif.error) {
      console.error(
        '[rate-limit] share count failed',
        analyst.error?.message ?? notif.error?.message,
      );
      return FAIL_OPEN;
    }

    const current = (analyst.count ?? 0) + (notif.count ?? 0);
    return { exceeded: current >= opts.max, current };
  } catch (err) {
    console.error('[rate-limit] share count threw', err);
    return FAIL_OPEN;
  }
}

/**
 * Convenience: seconds until the user can retry, given the window
 * length. We don't track per-row timestamps for an exact answer
 * (would require an extra round-trip); the conservative "wait the
 * full window" is fine for a 429 hint.
 */
export function retryAfterSeconds(windowSeconds: number): number {
  return windowSeconds;
}
