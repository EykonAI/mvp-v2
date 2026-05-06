/**
 * Advocate state machine (spec §2.2). Valid transitions:
 *
 *   none      → invited
 *   invited   → active            (founder marks partnership doc signed)
 *   invited   → none              (decline / 14-d auto-revert; PR 11 cron)
 *   active    → paused
 *   active    → terminated
 *   paused    → active
 *   paused    → terminated
 *   terminated → (terminal — no transitions)
 *
 * The transitions array is the single source of truth; the API and
 * the admin UI both read it.
 */

import type { AdvocateState } from '@/lib/auth/session';

export const VALID_TRANSITIONS: ReadonlyArray<readonly [AdvocateState, AdvocateState]> = [
  ['none', 'invited'],
  ['invited', 'active'],
  ['invited', 'none'],
  ['active', 'paused'],
  ['active', 'terminated'],
  ['paused', 'active'],
  ['paused', 'terminated'],
];

export function canTransition(from: AdvocateState, to: AdvocateState): boolean {
  return VALID_TRANSITIONS.some(([a, b]) => a === from && b === to);
}

export function nextStatesFor(from: AdvocateState): AdvocateState[] {
  return VALID_TRANSITIONS.filter(([a]) => a === from).map(([, b]) => b);
}

/**
 * Returns the column update fragment that should accompany an
 * advocate_state change. Each transition timestamps a corresponding
 * field per spec §2.3 + §2.7. The handle_first_paid_conversion trigger
 * does NOT cover these — that one's about subscription tier, not
 * advocate state.
 */
export function timestampUpdatesFor(
  to: AdvocateState,
  nowIso: string,
): Record<string, string | null> {
  switch (to) {
    case 'invited':
      return { advocate_invited_at: nowIso };
    case 'active':
      return { advocate_onboarded_at: nowIso };
    case 'terminated':
      return { advocate_terminated_at: nowIso };
    case 'none':
    case 'paused':
      // No new timestamp; the historical _at fields stay so the
      // admin UI can show "previously invited / onboarded".
      return {};
    default:
      return {};
  }
}
