// Canonical PostHog event taxonomy. Keep this file the single source of truth
// so the landing, app, and server routes can't drift on event names.
//
// Naming convention: <noun>_<past_participle> for things that happened
// (signup_completed), <noun>_<verb> for user intents (plan_selected,
// upgrade_clicked). Matches the pattern documented in the launch plan.

export const EVENT = {
  PAGE_VIEWED: 'page_viewed',
  SIGNUP_STARTED: 'signup_started',
  SIGNUP_COMPLETED: 'signup_completed',
  PLAN_SELECTED: 'plan_selected',
  CHECKOUT_STARTED: 'checkout_started',
  CHECKOUT_SUCCEEDED: 'checkout_succeeded',
  CHECKOUT_FAILED: 'checkout_failed',
  MODULE_OPENED: 'module_opened',
  AI_QUERY: 'ai_query',
  EXPORT_RUN: 'export_run',
  UPGRADE_CLICKED: 'upgrade_clicked',
  CANCEL_CLICKED: 'cancel_clicked',
  REFERRAL_CLICKED: 'referral_clicked',
  WAITLIST_JOINED: 'waitlist_joined',
} as const;

export type EventName = (typeof EVENT)[keyof typeof EVENT];

export type PaymentMethod = 'fiat' | 'crypto';

// Minimum property shape for each event. Extra fields are fine — PostHog
// widens schemas on demand — but this set is what dashboards rely on.
export type EventProps =
  | { event: 'page_viewed'; path: string }
  | { event: 'signup_started'; plan?: string | null }
  | { event: 'signup_completed'; plan?: string | null; has_referrer?: boolean }
  | { event: 'plan_selected'; plan: string; billing_cycle: 'monthly' | 'annual' | 'annual-crypto'; payment_method: PaymentMethod }
  | { event: 'checkout_started'; plan: string; payment_method: PaymentMethod; amount_usd_cents?: number }
  | { event: 'checkout_succeeded'; plan: string; payment_method: PaymentMethod; amount_usd_cents?: number; founding_locked?: boolean }
  | { event: 'checkout_failed'; plan: string; payment_method: PaymentMethod; reason?: string }
  | { event: 'module_opened'; module_slug: string; tier?: 'hero' | 'visible' | 'advanced' }
  | { event: 'ai_query'; tier: string; queries_this_month?: number }
  | { event: 'export_run'; format: string; size_bytes?: number }
  | { event: 'upgrade_clicked'; from_tier: string; target_tier: string; context?: string }
  | { event: 'cancel_clicked'; from_tier: string }
  | { event: 'referral_clicked'; target: 'link_copy' | 'share_twitter' | 'share_email' }
  | { event: 'waitlist_joined'; tier: 'pro' | 'enterprise' };
