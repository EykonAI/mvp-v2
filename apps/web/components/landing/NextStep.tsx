'use client';

// NEXT STEP — the /start hand-off (LP v2, PR-B).
//
// Sits immediately after the use cases, before the analyst section. That is
// where intent peaks: the visitor has just read three worked examples tied to
// named beats, and the next thought is "what would it show for mine". /start's
// persona qualification answers exactly that, so the button lands as the answer
// rather than as an interruption.
//
// Not in the hero. The hero already carries two CTAs at deliberately different
// weights (Observer primary, founding rate secondary); a third would flatten a
// hierarchy that was set on purpose, and it would ask a stranger to fill in a
// form before they know what the product is.
//
// This band LINKS to the funnel. It does not reproduce it: no questions, no
// persona routing, no offer block, nothing writing to closing_leads. That flow
// belongs to /start and the two pages have different jobs.

import { COHORT_DISPLAY_FLOOR } from '@/lib/marketing/platform-stats';

export function NextStep({
  spotsLeft,
  cohortSize,
}: {
  /** Already fetched by Landing for the hero — passed down so the page never
   *  computes the seat number twice. A second calculation would be a second
   *  answer to the figure the page invites readers to audit. */
  spotsLeft: number | null;
  /** Founding-cohort size, or null when it is not being published yet. */
  cohortSize?: number | null;
}) {
  // Never a fabricated fallback: an em dash while the real number is in flight.
  const spotsDisplay = spotsLeft == null ? '—' : spotsLeft.toLocaleString('en-US');

  // Below the floor the figure argues against us, so it is absent rather than
  // small. See COHORT_DISPLAY_FLOOR for the reasoning and the live numbers.
  const showCohort = typeof cohortSize === 'number' && cohortSize >= COHORT_DISPLAY_FLOOR;

  return (
    <div className="nextstep">
      <div className="nextstep-in">
        <span className="eyebrow">·· Next step ··</span>
        <h2>Tell us what you watch. We&rsquo;ll show you the read.</h2>
        <p className="nextstep-lede">
          Six questions, about two minutes. You get a walkthrough built around your own
          beat — the feeds that cover it, the ones that do not yet, and what the ledger
          says about how well we have called it.
        </p>

        <div className="nextstep-metrics">
          <div className="nextstep-metric">
            <span className="n">
              {spotsDisplay}
              <small>of 1,000</small>
            </span>
            <span className="k">Founding seats left</span>
          </div>
          {showCohort && (
            <div className="nextstep-metric">
              <span className="n">{cohortSize!.toLocaleString('en-US')}</span>
              <span className="k">Analysts in the founding cohort</span>
            </div>
          )}
        </div>

        <a className="nextstep-cta" href="/start">
          Find out what eYKON sees on your beat →
        </a>

        <p className="nextstep-fine">
          Two minutes · no card · you keep the walkthrough either way. Or{' '}
          <a href="/auth/signup">start free as Observer</a> and skip straight in.
        </p>
      </div>
    </div>
  );
}
