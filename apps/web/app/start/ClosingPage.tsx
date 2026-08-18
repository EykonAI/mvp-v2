'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClosingStatus } from '@/lib/closing/status';
import { PERSONA_BY_ID, type PersonaId } from '@/lib/closing/personas';
import { captureWithFirstTouch, campaignPropsFromLocation } from '@/lib/analytics/utm';
import { TrackedCta } from '@/components/marketing/CampaignTracking';
import { ProofBlock } from '@/components/closing/ProofBlock';
import { FounderVideo } from '@/components/closing/FounderVideo';
import { HonestyBoard } from '@/components/closing/HonestyBoard';
import { PersonaGrid } from '@/components/closing/PersonaGrid';
import { PersonaPitch } from '@/components/closing/PersonaPitch';
import { QualifyForm } from '@/components/closing/QualifyForm';
import { SeatCounter } from '@/components/closing/SeatCounter';

/**
 * /start — the three-step persona funnel (brief v1.4 §4.0).
 *
 *   1 · WHO + PROOF   persona grid, then the Kuwait receipt.
 *   2 · THE PITCH     tailored pitch, founder video, live honesty board.
 *   3 · QUALIFY       six questions → offer (if the offer is for them)
 *                     → checkout.
 *
 * ?p=<persona> deep-links straight to step 2, so a post that already
 * knows its audience never asks the question twice.
 *
 * proof_scrolled {depth} is reused for step depth rather than cutting a
 * second taxonomy — one source of truth for the funnel (PR B).
 */
const STEP_CTX = ['· who you are', '· your pitch', '· your setup'];

export function ClosingPage({
  status,
  turnstileSiteKey,
  videoSrc,
  videoPoster,
  initialPersona,
}: {
  status: ClosingStatus;
  turnstileSiteKey: string | null;
  videoSrc: string | null;
  videoPoster: string | null;
  /** Resolved from ?p= on the server, so a deep-linked visitor's own
   *  pitch is in the first paint rather than replacing step 1 after
   *  hydration. */
  initialPersona: PersonaId | null;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(initialPersona ? 2 : 1);
  const [persona, setPersona] = useState<PersonaId | null>(initialPersona);
  const [offerUnlocked, setOfferUnlocked] = useState(false);
  const [altPath, setAltPath] = useState<string | null>(null);
  const viewFired = useRef(false);
  const depthsFired = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (viewFired.current) return;
    viewFired.current = true;
    captureWithFirstTouch({ event: 'closing_page_viewed', ...campaignPropsFromLocation() });
    // A deep-linked arrival starts on step 2, so record that depth too —
    // otherwise the funnel would show step 2 with no entrants.
    if (initialPersona) {
      depthsFired.current.add(2);
      captureWithFirstTouch({ event: 'proof_scrolled', depth: 2 });
    }
  }, [initialPersona]);

  const go = useCallback((n: 1 | 2 | 3) => {
    setStep(n);
    if (!depthsFired.current.has(n)) {
      depthsFired.current.add(n);
      captureWithFirstTouch({ event: 'proof_scrolled', depth: n });
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const choose = useCallback(
    (id: PersonaId) => {
      setPersona(id);
      go(2);
    },
    [go],
  );

  const unlockOffer = useCallback((destination: string) => {
    setOfferUnlocked(true);
    // A /pricing destination IS the founding-rate CTA below, so there is
    // no second door to show. Anything else is a genuine alternative.
    setAltPath(destination.startsWith('/pricing') ? null : destination);
    requestAnimationFrame(() =>
      document.getElementById('offer')?.scrollIntoView({ behavior: 'smooth' }),
    );
  }, []);

  // The alternative path, labelled for what it actually is.
  const altLabel = !altPath
    ? null
    : altPath.startsWith('mailto:partners')
      ? 'Or talk to us about a Founding Partner seat →'
      : altPath.startsWith('mailto:verify')
        ? 'Or get verified for press access →'
        : 'Or start free as Observer →';

  const p = persona ? PERSONA_BY_ID[persona] : null;

  return (
    <>
      <header className="cs-header">
        <Link href="/" prefetch={false} className="cs-logo">
          ⊕ EYKON<span>.AI</span>
        </Link>
        <div className="cs-rail">
          <span className="cs-raillbl">
            STEP <b>{step}</b>/3 <span className="cs-railctx">{STEP_CTX[step - 1]}</span>
          </span>
          <span
            className="cs-segs"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={3}
            aria-valuenow={step}
            aria-label="Progress"
          >
            {[1, 2, 3].map((i) => (
              <i key={i} className={i <= step ? 'cs-seg cs-on' : 'cs-seg'} />
            ))}
          </span>
        </div>
      </header>

      <div className="cs-shell">
        {/* ── STEP 1 · WHO + PROOF ─────────────────────────────── */}
        {step === 1 && (
          <section className="cs-section">
            <div className="cs-kicker">S-01 · the only question that matters first</div>
            <h1 className="cs-h1">
              What describes you <span className="cs-dim">best?</span>
            </h1>
            <p className="cs-sub">
              eYKON adapts to how you work — the pitch, the tools, even the analyst&apos;s framing.
              Pick one; everything after this is built for you.
            </p>
            <PersonaGrid selected={persona} onSelect={choose} />
            <hr className="cs-rule" />
            <ProofBlock />
          </section>
        )}

        {/* ── STEP 2 · THE PITCH ───────────────────────────────── */}
        {step === 2 && p && (
          <section className="cs-section">
            <button type="button" className="cs-back" onClick={() => go(1)}>
              ← Change role
            </button>
            <PersonaPitch persona={p} />
            <FounderVideo src={videoSrc} poster={videoPoster} />
            <hr className="cs-rule" />
            <HonestyBoard status={status} />
            <div className="cs-actions">
              <button type="button" className="cs-btn" onClick={() => go(3)}>
                This is me — continue →
              </button>
              <button type="button" className="cs-btn cs-ghost" onClick={() => go(1)}>
                Not quite
              </button>
            </div>
          </section>
        )}

        {/* ── STEP 3 · QUALIFY → OFFER → CHECKOUT ──────────────── */}
        {step === 3 && p && (
          <section className="cs-section">
            <button type="button" className="cs-back" onClick={() => go(2)}>
              ← Back
            </button>
            <div className="cs-kicker">S-03 · last step before your seat</div>
            <h1 className="cs-h1">
              Tell us what you <span className="cs-dim">watch.</span>
            </h1>
            <p className="cs-sub">
              About a minute. It pre-configures your workspace and tells us whether our sensors
              actually cover your beat — before you&apos;ve paid anything.
            </p>
            <QualifyForm
              persona={p}
              turnstileSiteKey={turnstileSiteKey}
              onOfferUnlocked={unlockOffer}
            />

            {offerUnlocked && (
              <>
                <hr className="cs-rule" id="offer" />
                <div className="cs-kicker">·· Founding cohort ··</div>
                <h2 className="cs-h2">Founding rate. Locked for life.</h2>
                <SeatCounter />

                <div className="cs-twop">
                  <div className="cs-pcard cs-rec">
                    <div className="cs-pflag">RECOMMENDED · SAVE 30%</div>
                    <div className="cs-pk">ANNUAL</div>
                    <div className="cs-pv">
                      $243.60<span>/ year</span>
                    </div>
                    <div className="cs-pe">effectively $20.30 / month · two months free</div>
                    <div className="cs-pc">USDC · USDT · BTC · ETH · + L2</div>
                  </div>
                  <div className="cs-pcard">
                    <div className="cs-pk">MONTHLY</div>
                    <div className="cs-pv">
                      $29.00<span>/ month</span>
                    </div>
                    <div className="cs-pe">the low-commitment door · cancel by not renewing</div>
                    <div className="cs-pc">USDC · USDT on Base or Polygon</div>
                  </div>
                </div>

                <div className="cs-kicker" style={{ marginTop: 30 }}>
                  ·· What you are accepting ··
                </div>
                <div className="cs-lim">
                  <div className="cs-lrow">
                    <div className="cs-lno">
                      LIMIT 1<em>Data feeds</em>
                    </div>
                    <div className="cs-lsay">
                      The feeds are not all there yet. Four of nine INTEL workspaces are models,
                      badged ILLUSTRATIVE, and vessel coverage is chokepoint-only. The roadmap to
                      full coverage runs about twelve months.
                    </div>
                    <div className="cs-lget">
                      Your price is locked for life, <strong>including after the feeds are complete</strong>.
                      You buy the finished platform at the unfinished price. That gap is the whole
                      reason this rate exists.
                    </div>
                  </div>
                  <div className="cs-lrow">
                    <div className="cs-lno">
                      LIMIT 2<em>Usage caps</em>
                    </div>
                    <div className="cs-lsay">
                      Token-consuming features are capped. Pro includes 500 AI Analyst queries a
                      month; Deep Analysis and dossier exports draw on the same budget.
                    </div>
                    <div className="cs-lget">
                      Top up mid-month without changing plan — <strong>Query Pack, $5 for +25
                      queries</strong>, stackable, on any plan.
                    </div>
                  </div>
                  <div className="cs-lrow" style={{ borderBottom: 0 }}>
                    <div className="cs-lno">
                      LIMIT 3<em>Payment rail</em>
                    </div>
                    <div className="cs-lsay">
                      Crypto only at this stage. Fiat billing does not exist and we are not going to
                      pretend otherwise. Nothing auto-renews — each period is a payment you actively
                      make, and we remind you before it lapses.
                    </div>
                    <div className="cs-lget">
                      14-day full refund, single click, settled in USDC. Nothing can silently charge
                      you, because nothing holds a card.
                    </div>
                  </div>
                </div>

                <div className="cs-actions" style={{ marginTop: 26 }}>
                  <TrackedCta
                    href={
                      p.id === 'risk'
                        ? '/pricing?plan=enterprise_founding_annual'
                        : '/pricing?plan=pro_founding_annual'
                    }
                    source="closing"
                    contentId={null}
                  >
                    <span className="cs-btn">Claim founding seat — annual →</span>
                  </TrackedCta>
                  <TrackedCta href="/pricing?plan=pro_founding_monthly" source="closing" contentId={null}>
                    <span className="cs-btn cs-ghost">Or $29 / month →</span>
                  </TrackedCta>
                </div>

                {/* The persona's own door, kept beside the rate rather than
                    in place of it — every persona may claim the founding
                    rate, and the alternative is offered, not imposed. */}
                {altPath && altLabel && (
                  <p className="cs-fine">
                    <a href={altPath} className="cs-inline">
                      {altLabel}
                    </a>
                  </p>
                )}
                <p className="cs-fine">
                  Not ready? The <TrackedCta href="/pricing?plan=week_pass" source="closing" contentId={null}><span className="cs-inline">$9 Week Pass</span></TrackedCta> is everything in Pro for seven days, and Observer is free forever.
                </p>
              </>
            )}
          </section>
        )}
      </div>

      <footer className="cs-footer">
        <span className="cs-spine">Don&apos;t trust us. Audit us.</span> · public sensor data ·
        decision-support, not trade recommendations
      </footer>
    </>
  );
}
