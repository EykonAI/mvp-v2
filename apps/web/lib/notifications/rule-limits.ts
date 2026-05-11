import type { Tier } from '@/lib/auth/session';

// Per-tier active-rule limits.
//
// Citizen = 1 per the trial-mechanism brief §5.3: Observer users pick
// one rule from the suggestion library, deliver to email only, and
// watch it fire over weeks. This is the single most powerful conversion
// mechanic for Path-1 (heavy free-tier self-conversion). Pro+ stay at
// the §10 brief levels (Pro 10, Desk 30, Enterprise 100).
export const ACTIVE_RULE_LIMITS: Record<Tier, number> = {
  citizen: 1,
  pro: 10,
  desk: 30,
  enterprise: 100,
};

// Default cooldown matches §10. Server-side floor (15 min) is the
// CHECK constraint on user_notification_rules.cooldown_minutes.
export const DEFAULT_COOLDOWN_MINUTES = 360;
export const MIN_COOLDOWN_MINUTES = 15;
