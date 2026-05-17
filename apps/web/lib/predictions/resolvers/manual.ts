import type { Resolver } from './types';

/**
 * Manual / fallback resolver.
 *
 * The pre-PR-CAL behaviour: the cron stored a deterministic 0.5
 * placeholder so the prediction_outcomes table started populating with
 * numbers. Operators issuing source='manual' predictions are expected
 * to update the row by hand from the admin tool (added in PR-CAL-6).
 *
 * The 0.5 stub still ships so existing seeded predictions continue to
 * resolve and the resolution pipeline never silently skips a row that
 * lacks a per-source resolver.
 */
export const resolveManual: Resolver = async () => {
  return { observed: 0.5, source_url: null };
};
