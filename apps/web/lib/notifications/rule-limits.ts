import type { Tier } from '@/lib/auth/session';

// Per-tier active-rule limits per brief §10. Citizens never reach a
// rule-creation path (the /notif page tier-gates them out earlier),
// but we keep the entry for completeness so callers don't need a
// nullable lookup.
export const ACTIVE_RULE_LIMITS: Record<Tier, number> = {
  citizen: 0,
  pro: 10,
  desk: 30,
  enterprise: 100,
};

// Default cooldown matches §10. Server-side floor (15 min) is the
// CHECK constraint on user_notification_rules.cooldown_minutes.
export const DEFAULT_COOLDOWN_MINUTES = 360;
export const MIN_COOLDOWN_MINUTES = 15;
