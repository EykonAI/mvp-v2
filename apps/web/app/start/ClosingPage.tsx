'use client';

import { useEffect, useRef, useState } from 'react';
import type { ClosingStatus } from '@/lib/closing/status';
import { captureWithFirstTouch, campaignPropsFromLocation } from '@/lib/analytics/utm';
import { TrackedCta } from '@/components/marketing/CampaignTracking';
import { ProofBlock } from '@/components/closing/ProofBlock';
import { FounderVideo } from '@/components/closing/FounderVideo';
import { HonestyBoard } from '@/components/closing/HonestyBoard';
import { QualifyForm } from '@/components/closing/QualifyForm';
import { SeatCounter } from '@/components/closing/SeatCounter';

/**
 * /start — the closing page shell (brief v1.3 §4). Seven screens, one
 * exit. closing_page_viewed fires once with the utm_* fields and writes
 * first-touch person properties; proof_scrolled {depth} fires once per
 * screen at 50% visibility, so the funnel shows exactly which screen
 * loses people.
 */

const SCREEN_IDS = ['proof', 'video', 'what', 'honesty', 'qualify', 'offer', 'checkout'] as const;

export function ClosingPage({
  status,
  turnstileSiteKey,
  videoSrc,
  videoPoster,
}: {
  status: ClosingStatus;
  turnstileSiteKey: string | null;
  videoSrc: string | null;
  videoPoster: string | null;
}) {
  const viewFired = useRef(false);
  const depthsFired = useRef<Set<number>>(new Set());
  const [cadence, setCadence] = useState<'annual' | 'monthly'>('annual');

  useEffect(() => {
    if (viewFired.current) return;
    viewFired.current = true;
    captureWithFirstTouch({ event: 'closing_page_viewed', ...campaignPropsFromLocation() });
  }, []);

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const depth = SCREEN_IDS.indexOf(e.target.id as (typeof SCREEN_IDS)[number]) + 1;
          if (depth > 0 && !depthsFired.current.has(depth)) {
            depthsFired.current.add(depth);
            captureWithFirstTouch({ event: 'proof_scrolled', depth });
          }
        }
      },
      { threshold: 0.5 },
    );
    for (const id of SCREEN_IDS) {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, []);

  return (
    <div className="cs-shell">
      <ProofBlock />
      <div style={{ margin: '-28px 0 0', paddingBottom: 40, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <a href="#qualify" className="cs-btn">
          See what we&apos;re watching tonight →
        </a>
        <span className="cs-mono" style={{ fontSize: 10.5, color: 'var(--ink-dim)', letterSpacing: '0.09em' }}>
          NO SIGNUP WALL — THE FORM COMES AFTER THE EVIDENCE
        </span>
      </div>

      <FounderVideo src={videoSrc} poster={videoPoster} />

      {/* Screen 3 — what it is. Three sentences, not six pillars (§4.3). */}
      <section className="cs-section" id="what">
        <div className="cs-kicker">·· What this is ··</div>
        <h2 className="cs-h2">Three sentences. Not six pillars.</h2>
        <div className="cs-three">
          <div className="cs-card">
            <div className="cs-n">01 · THE MAP IS FREE</div>
            <h3>Every layer, every tier.</h3>
            <p>
              Aircraft, conflict, thermal anomalies, night-time radiance and chokepoint
              vessels over the infrastructure that makes them interpretable. Source and
              refresh timestamp inline on every layer.
            </p>
          </div>
          <div className="cs-card">
            <div className="cs-n">02 · THE INTELLIGENCE IS THE PRODUCT</div>
            <h3>Signals, not dashboards.</h3>
            <p>
              Convergence scored on independent sensor classes — not on how many news feeds
              repeated the same story. An AI analyst with 23 tools wired to the live tables.
            </p>
          </div>
          <div className="cs-card">
            <div className="cs-n">03 · THE RECORD IS PUBLIC</div>
            <h3>Wrong calls left standing.</h3>
            <p>
              Every forecast is hashed before the outcome, scored against ground truth and
              published — recompute any hash yourself on its forecast page. Including the
              ones that went badly. Especially those.
            </p>
          </div>
        </div>
      </section>

      <HonestyBoard status={status} />

      <QualifyForm turnstileSiteKey={turnstileSiteKey} />

      {/* Screen 6 — the offer (§4.6). */}
      <section className="cs-section" id="offer">
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
        <p className="cs-mono" style={{ maxWidth: 830, marginTop: 12, fontSize: 11, color: 'var(--ink-dim)', lineHeight: 1.7 }}>
          Same founding rate either way — <span style={{ color: 'var(--teal)' }}>locked for life</span>, including
          after the feeds are complete. Nothing auto-renews: each period is a payment you
          actively make, and we remind you before it lapses.
        </p>

        <div className="cs-kicker" style={{ marginTop: 30 }}>
          ·· What you are accepting ··
        </div>
        <div className="cs-lim">
          <div className="cs-lrow">
            <div className="cs-lno">
              LIMIT 1<em>Data feeds</em>
            </div>
            <div className="cs-lsay">
              The feeds are not there yet. AIS is thin; four of nine INTEL workspaces are
              models, badged ILLUSTRATIVE. Initial use cases are genuinely limited — the
              roadmap to full coverage runs about twelve months.
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
              month; Deep Analysis and dossier exports draw on the same budget. Heavy users
              will hit the ceiling.
            </div>
            <div className="cs-lget">
              Top up mid-month without changing plan — <strong>Query Pack, $5 for +25 queries</strong>,
              stackable, on any plan. No upgrade, no renegotiation.
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
              14-day full refund, single click, settled in USDC. Quoted in USD-equivalent,
              locked 20 minutes at checkout. Nothing can silently charge you, because
              nothing holds a card.
            </div>
          </div>
        </div>
      </section>

      {/* Screen 7 — checkout (§4.7). Two paid options, never four. */}
      <section className="cs-section" id="checkout" style={{ borderBottom: 0 }}>
        <div className="cs-kicker">·· Checkout ··</div>
        <h2 className="cs-h2">Pay in crypto. Two minutes.</h2>
        <div className="cs-co">
          <div className="cs-copanel">
            <div className="cs-mono" style={{ fontSize: 10, letterSpacing: '0.15em', color: 'var(--ink-dim)', marginBottom: 11 }}>
              T-02 · PRO · FOUNDING
            </div>
            <div className="cs-seg">
              <button
                type="button"
                className={cadence === 'annual' ? 'cs-segb cs-on' : 'cs-segb'}
                onClick={() => setCadence('annual')}
              >
                ANNUAL — SAVE 30%
              </button>
              <button
                type="button"
                className={cadence === 'monthly' ? 'cs-segb cs-on' : 'cs-segb'}
                onClick={() => setCadence('monthly')}
              >
                MONTHLY
              </button>
            </div>
            {cadence === 'annual' ? (
              <>
                <div className="cs-strike" style={{ marginTop: 14 }}>
                  $1,009.80 / yr standard
                </div>
                <div className="cs-price">
                  $243.60 <span>/ year</span>
                </div>
                <div className="cs-mono" style={{ fontSize: 10, color: 'var(--teal)', marginTop: 7, letterSpacing: '0.1em' }}>
                  = $20.30 / MO · LOCKED FOR LIFE
                </div>
                <div className="cs-coins">
                  <span className="cs-coin">USDC</span>
                  <span className="cs-coin">USDT</span>
                  <span className="cs-coin">BTC</span>
                  <span className="cs-coin">ETH</span>
                </div>
              </>
            ) : (
              <>
                <div className="cs-strike" style={{ marginTop: 14 }}>
                  $84.15 / mo standard-equivalent
                </div>
                <div className="cs-price">
                  $29.00 <span>/ month</span>
                </div>
                <div className="cs-mono" style={{ fontSize: 10, color: 'var(--teal)', marginTop: 7, letterSpacing: '0.1em' }}>
                  SAME RATE · LOCKED FOR LIFE
                </div>
                <div className="cs-coins">
                  <span className="cs-coin">USDC · Base</span>
                  <span className="cs-coin">USDT · Polygon</span>
                </div>
              </>
            )}
            <div className="cs-note">
              Quoted in USD-equivalent, locked 20 minutes at checkout. Nothing auto-renews.
              14-day full refund in USDC.
            </div>
            <div style={{ marginTop: 18 }}>
              <TrackedCta
                href={cadence === 'annual' ? '/pricing?plan=pro_founding_annual' : '/pricing?plan=pro_founding_monthly'}
                source="closing"
                contentId={null}
                style={{ display: 'inline-block' }}
              >
                <span className="cs-btn">Claim founding seat →</span>
              </TrackedCta>
            </div>
          </div>
          <div className="cs-copanel">
            <div className="cs-mono" style={{ fontSize: 10, letterSpacing: '0.15em', color: 'var(--ink-dim)', marginBottom: 11 }}>
              NOT READY TO PAY?
            </div>
            <h3 className="cs-h2" style={{ fontSize: 15 }}>
              Week Pass · $9
            </h3>
            <p className="cs-sub" style={{ fontSize: 12.5, marginBottom: 16 }}>
              Everything in Pro for 7 days. No auto-renew — it expires.
            </p>
            <TrackedCta href="/pricing?plan=week_pass" source="closing" contentId={null} style={{ display: 'inline-block' }}>
              <span className="cs-btn cs-ghost cs-sm">Get a week pass →</span>
            </TrackedCta>
            <h3 className="cs-h2" style={{ fontSize: 15, marginTop: 22 }}>
              Observer · free forever
            </h3>
            <p className="cs-sub" style={{ fontSize: 12.5, marginBottom: 16 }}>
              Live map, daily brief, 5 analyst queries/mo. No card.
            </p>
            <TrackedCta href="/auth/signin?next=/app" source="closing" contentId={null} style={{ display: 'inline-block' }}>
              <span className="cs-btn cs-ghost cs-sm">Start free →</span>
            </TrackedCta>
            <div className="cs-note" style={{ marginTop: 20 }}>
              Your email is already in the pipeline from the form above — a bounce here
              still leaves a qualified lead.
            </div>
          </div>
        </div>
      </section>

      <div className="cs-footer">
        eYKON.ai · geopolitical intelligence · detected from open-source data. Not a
        financial advisor; signals are decision-support, not trade recommendations.
      </div>
    </div>
  );
}
