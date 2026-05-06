/**
 * Founder-allowlist gate for the advocate admin panel and its
 * supporting API routes. There is no admin role concept in
 * user_profiles today; this is the simplest gate that doesn't
 * require a schema migration.
 *
 * Set FOUNDER_EMAILS as a comma-separated list of canonical emails
 * on the production web service. Comparison is case-insensitive.
 *
 * If the env var is unset, every gate denies — fail-closed default.
 */

import type { User } from '@supabase/supabase-js';

export function getFounderEmails(): string[] {
  const raw = process.env.FOUNDER_EMAILS;
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isFounder(user: User | { email?: string | null } | null | undefined): boolean {
  if (!user?.email) return false;
  const allowed = getFounderEmails();
  if (allowed.length === 0) return false;
  return allowed.includes(user.email.toLowerCase());
}
