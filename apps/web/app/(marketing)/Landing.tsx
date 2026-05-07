'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import './landing.css';
import { captureBrowser } from '@/lib/analytics/client';
import { AnalystWithTools } from '@/components/landing/AnalystWithTools';
import { HeroWorkspaceShowcase } from '@/components/landing/HeroWorkspaceShowcase';
import { NotificationCenterTease } from '@/components/landing/NotificationCenterTease';
import { AdvancedScenariosBrief } from '@/components/landing/AdvancedScenariosBrief';
import { CalibrationAnchor } from '@/components/landing/CalibrationAnchor';

// Billing cycle state — drives prices and CTAs across the pricing grid.
type Cycle = 'monthly' | 'annual' | 'annual-crypto';

type PriceText = { amt: string; per: string; strike: string; savings: string };

const PRO_PRICES: Record<Cycle, PriceText> = {
  monthly: { amt: '$29', per: '/ month', strike: '$99/mo standard', savings: '−70%' },
  annual: { amt: '$348', per: '/ year', strike: '$1,188/yr standard', savings: '−71%' },
  'annual-crypto': {
    amt: '$244',
    per: '/ year in crypto',
    strike: '$832/yr standard',
    savings: '−71%',
  },
};

const ENTERPRISE_PRICES: Record<Cycle, PriceText> = {
  monthly: { amt: '$99', per: '/ seat / mo', strike: '$199/seat/mo standard', savings: '−50%' },
  annual: {
    amt: '$1,188',
    per: '/ seat / yr',
    strike: '$2,388/seat/yr standard',
    savings: '−50%',
  },
  'annual-crypto': {
    amt: '$832',
    per: '/ seat / yr in crypto',
    strike: '$1,671/seat/yr standard',
    savings: '−50%',
  },
};

type CtaAction =
  | { kind: 'waitlist'; tier: 'pro' | 'enterprise'; label: string }
  | { kind: 'crypto'; href: string; label: string };

const PRO_CTA: Record<Cycle, CtaAction> = {
  monthly: { kind: 'waitlist', tier: 'pro', label: 'Join fiat waitlist →' },
  annual: { kind: 'waitlist', tier: 'pro', label: 'Join fiat waitlist →' },
  'annual-crypto': {
    kind: 'crypto',
    href: '/auth/signup?plan=pro_founding_annual',
    label: 'Claim Founding Rate (crypto) →',
  },
};

const ENTERPRISE_CTA: Record<Cycle, CtaAction> = {
  monthly: { kind: 'waitlist', tier: 'enterprise', label: 'Join fiat waitlist →' },
  annual: { kind: 'waitlist', tier: 'enterprise', label: 'Join fiat waitlist →' },
  'annual-crypto': {
    kind: 'crypto',
    href: '/auth/signup?plan=enterprise_founding_annual',
    label: 'Start 3-Seat Team (crypto) →',
  },
};

const NAV_ANCHORS = ['top', 'platform', 'intelligence', 'pricing', 'faq'] as const;

export function Landing() {
  const [cycle, setCycle] = useState<Cycle>('monthly');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTier, setModalTier] = useState<'pro' | 'enterprise'>('pro');
  const [activeSection, setActiveSection] = useState<string>('top');

  function openWaitlist(tier: 'pro' | 'enterprise') {
    setModalTier(tier);
    setModalOpen(true);
    captureBrowser({
      event: 'plan_selected',
      plan: `${tier}_founding_${cycle === 'annual-crypto' ? 'annual' : cycle}`,
      billing_cycle: cycle,
      payment_method: cycle === 'annual-crypto' ? 'crypto' : 'fiat',
    });
  }

  function trackCycleChange(nextCycle: Cycle) {
    setCycle(nextCycle);
    // Don't double-count monthly (the landing defaults there); only fire
    // plan_selected when the user deliberately moves off the default.
    if (nextCycle !== 'monthly') {
      captureBrowser({
        event: 'plan_selected',
        plan: 'pricing_toggle',
        billing_cycle: nextCycle,
        payment_method: nextCycle === 'annual-crypto' ? 'crypto' : 'fiat',
      });
    }
  }

  function closeWaitlist() {
    setModalOpen(false);
  }

  // Lock body scroll + Escape-to-close while modal is open.
  useEffect(() => {
    if (!modalOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModalOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [modalOpen]);

  // IntersectionObserver drives the nav-link active state as the viewer scrolls.
  useEffect(() => {
    const targets = NAV_ANCHORS.map((id) => document.getElementById(id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    if (!targets.length || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActiveSection(entry.target.id);
        });
      },
      { rootMargin: '-40% 0px -55% 0px', threshold: 0 },
    );
    targets.forEach((t) => observer.observe(t));
    return () => observer.disconnect();
  }, []);

  const pro = PRO_PRICES[cycle];
  const ent = ENTERPRISE_PRICES[cycle];
  const proCta = PRO_CTA[cycle];
  const entCta = ENTERPRISE_CTA[cycle];

  return (
    <div className="eykon-landing">
      {/* ─── NAV ─────────────────────────────────────────────────── */}
      <nav>
        <a href="#top" className="brand">
          <div className="brand-mark">⊕</div>
          <div className="brand-name">
            eYKON<span className="dot">.ai</span>
          </div>
        </a>
        <div className="links">
          {(['platform', 'intelligence', 'pricing', 'faq'] as const).map((id) => (
            <a
              key={id}
              href={`#${id}`}
              className={activeSection === id ? 'active' : undefined}
            >
              {id === 'intelligence' ? 'Intelligence' : id.charAt(0).toUpperCase() + id.slice(1)}
            </a>
          ))}
        </div>
        <div className="nav-actions">
          <Link href="/auth/signin" className="cta">
            Sign in
          </Link>
          <Link
            href="/auth/signup"
            className="cta-primary"
            onClick={() => {
              captureBrowser({
                event: 'signup_started',
                plan: null,
              });
            }}
          >
            Sign up →
          </Link>
        </div>
      </nav>

      {/* ─── HERO ────────────────────────────────────────────────── */}
      <section className="hero" id="top">
        <div className="founding-pill">
          <span className="dot"></span>
          Founding Members · First 1,000 · Rate locked for life
        </div>
        <h1 className="hero-title">
          When the world moves,
          <br />
          <span className="accent">your positions should already know.</span>
        </h1>
        <p className="hero-sub">
          Real-time geopolitical signals — maritime chokepoints, energy infrastructure,
          sanctions events, conflict escalation — translated into trade-relevant cues.
          Built for OSINT analysts and day-traders.
        </p>
        <p className="hero-meta">
          <span className="count">■ 847</span> of <span className="count">1,000</span>{' '}
          founding seats remaining · USD pricing · Pay in fiat or crypto
        </p>
        <div className="hero-ctas">
          <a href="#pricing" className="btn-primary">
            Claim Founding Rate →
          </a>
          <a href="#pricing" className="btn-text">
            Or start free as Observer
          </a>
        </div>
      </section>

      {/* ─── PLATFORM ────────────────────────────────────────────── */}
      <section className="section" id="platform">
        <div className="section-head">
          <div className="section-kicker">·· Platform ··</div>
          <h2 className="section-title">
            The <span className="accent">platform</span>.
          </h2>
          <p className="section-sub">Intelligence-grade data. Trader-grade latency.</p>
        </div>
        <div className="pillars">
          <Pillar
            label="P-01 · REAL-TIME"
            title="A single screen for the state of the world."
            body="Maritime traffic (AIS), flight paths (ADS-B), active conflicts (ACLED), energy infrastructure, and strategic chokepoints — all rendered on a 3D globe with sub-minute refresh. No tab-switching, no context loss."
          />
          <Pillar
            label="P-02 · DECISION LAYER"
            title="From incident to position idea in seconds."
            body="Every event carries a machine-readable impact score across equities, commodities, FX, and crypto. A chokepoint closure is never just news — it's a ranked list of assets that historically moved, with confidence bands."
          />
          <Pillar
            label="P-03 · AI ANALYST"
            title="Ask in plain English. Get analyst-grade answers."
            body="The embedded analyst reads the same feeds you see, and answers questions like &quot;what's the base-rate for BTC moves on Strait of Hormuz incidents?&quot; with sourced, timestamped reasoning — never hallucinated."
          />
          <Pillar
            label="P-04 · CALIBRATION"
            title="Every data point carries its receipts."
            body="Source, license, ingestion timestamp, and historical accuracy are attached to every signal. Export to GeoJSON or CSV for your own notebooks. Cite with confidence in your newsletter, research note, or trade journal."
          />
        </div>
        <div className="stat-strip">
          <div className="stat">
            <span className="val">47</span> integrated feeds
          </div>
          <div className="stat sep">·</div>
          <div className="stat">
            <span className="val">&lt; 60 s</span> refresh
          </div>
          <div className="stat sep">·</div>
          <div className="stat">
            <span className="val">25+</span> Intelligence Menu modules
          </div>
        </div>
      </section>

      {/* ─── AI Analyst differentiation (PARAGRAPH 1, prompt §6.1) ─ */}
      <AnalystWithTools />

      {/* ─── Hero workspace showcase ─────────────────────────────── */}
      <HeroWorkspaceShowcase />

      {/* ─── Notification Center tease ───────────────────────────── */}
      <NotificationCenterTease />

      {/* ─── Advanced Scenarios brief mention ────────────────────── */}
      <AdvancedScenariosBrief />

      {/* ─── INTELLIGENCE MENU ───────────────────────────────────── */}
      <section className="section" id="intelligence">
        <div className="section-head">
          <div className="section-kicker">·· Intelligence Menu ··</div>
          <h2 className="section-title">
            The <span className="accent">Intelligence Menu</span>.
          </h2>
          <p className="section-sub">Twenty-five modules. One operational picture.</p>
        </div>
        <p className="intelligence-intro">
          Every module below is a different lens on the same live dataset — pick the ones
          that fit how you trade, analyze, or report.
        </p>

        <div className="clusters">
          {/* Cluster C foregrounded */}
          <Cluster
            foreground
            title="Financial & crypto market intelligence"
            code="Cluster C · IM-13 → IM-17"
            lead="The core loop for traders: an event on the map becomes a ranked basket of affected instruments within seconds."
            modules={[
              ['IM-13', 'Asset Impact Lens', 'For any event on the globe, the ranked list of equities, commodities, FX, and crypto pairs historically correlated.'],
              ['IM-14', 'Crypto Flow Monitor', 'Stablecoin issuance, large-wallet movements, exchange in/out flows during geopolitical events.'],
              ['IM-15', 'Sanctions Tracker', 'New designations, delisting, and OFAC-class event timeline mapped to affected tickers.'],
              ['IM-16', 'Commodity Pricing Panel', 'Oil, gas, grain, metals with event overlays.'],
              ['IM-17', 'Correlation Heatmap', 'User watchlist vs. global event stream; historical and live coefficients.'],
            ]}
          />
          <Cluster
            title="Real-time situational awareness"
            code="Cluster A · IM-01 → IM-06"
            modules={[
              ['IM-01', 'Operational Globe', 'The 3D Earth with all live layers: maritime, aviation, conflict, infrastructure.'],
              ['IM-02', 'Maritime Tracker', 'AIS vessel positions, vessel metadata, port-call history, shadow-fleet flags.'],
              ['IM-03', 'Aviation Tracker', 'ADS-B with military-adjacent callsign detection and squawk anomalies.'],
              ['IM-04', 'Conflict Feed', 'ACLED events with escalation scoring and territorial-control deltas.'],
              ['IM-05', 'Satellite Watch', 'Sentinel-2 imagery with change-detection pins over user watchlists.'],
              ['IM-06', 'Weather & Environmental Layer', 'Storm tracks, wildfires, and disruption overlays.'],
            ]}
          />
          <Cluster
            title="Infrastructure & strategic assets"
            code="Cluster B · IM-07 → IM-12"
            modules={[
              ['IM-07', 'Energy Atlas', 'Refineries, LNG terminals, pipelines, power plants, and grid interconnectors.'],
              ['IM-08', 'Chokepoint Monitor', 'Strait-by-strait transit volumes, closures, and historical base rates.'],
              ['IM-09', 'Strategic Minerals', 'Cobalt, lithium, REE mine locations with ownership and export routes.'],
              ['IM-10', 'Port & Logistics', 'Container-port throughput, dwell times, queue anomalies.'],
              ['IM-11', 'Grid & Power Flow', 'ENTSO-E live load, cross-border flows, outage events.'],
              ['IM-12', 'Pipeline Status Board', 'Nord Stream-class assets with state, flow, and incident history.'],
            ]}
          />
          <Cluster
            title="Signal analysis & forensics"
            code="Cluster D · IM-18 → IM-22"
            modules={[
              ['IM-18', 'Cascade Analyzer', 'Multi-step downstream impact of a single incident (refinery hit → product crack → equity tickers).'],
              ['IM-19', 'Shadow Fleet Tracker', 'AIS-dark vessels, flag-hop patterns, sanctioned-cargo suspects.'],
              ['IM-20', 'Sanctions Cascade', 'Counterparty exposure mapping from a primary designation.'],
              ['IM-21', 'Anomaly Flags', 'ML-surfaced deviations from baseline across all live feeds.'],
              ['IM-22', 'Precursor Patterns', 'Pattern-matching against analog events from the historical archive.'],
            ]}
          />
          <Cluster
            title="Analyst, alerts & output"
            code="Cluster E · IM-23 → IM-27"
            modules={[
              ['IM-23', 'AI Analyst (Claude-powered)', 'Plain-English querying of the full dataset with cited reasoning.'],
              ['IM-24', 'Compound-Signal Alerts', 'Multi-condition triggers delivered via email, push, or webhook.'],
              ['IM-25', 'Personalized Briefings', "A daily digest tailored to the user's persona and watchlist."],
              ['IM-26', 'Calibration Ledger', 'Track record of every alert and analyst claim, scored over time.'],
              ['IM-27', 'Export & API', 'GeoJSON, CSV, and REST endpoints for external notebooks and pipelines.'],
            ]}
          />
        </div>

        <div className="see-in-action">
          <a href="#pricing">▸ See every module in action — start free as Observer</a>
        </div>
      </section>

      {/* ─── Calibration anchor (PARAGRAPH 2, prompt §6.2) ───────── */}
      <CalibrationAnchor />

      {/* ─── PRICING ─────────────────────────────────────────────── */}
      <section id="pricing" style={{ paddingTop: 60 }}>
        <div className="section-head" style={{ padding: '0 32px' }}>
          <div className="section-kicker">·· Pricing ··</div>
          <h2 className="section-title">
            Founding rate, <span className="accent">locked for life</span>.
          </h2>
          <p className="section-sub">
            Three lanes. US dollars. Fiat or crypto. No hidden seats, no hidden fees.
          </p>
        </div>

        <div className="scarcity-strip">
          <span className="mark">■</span> Founding seats remaining ·{' '}
          <span className="count">847</span> of <span className="count">1,000</span>
        </div>

        <div className="toggle-wrap">
          <div className="billing-toggle" role="tablist">
            <button
              type="button"
              role="tab"
              className={cycle === 'monthly' ? 'active' : undefined}
              onClick={() => trackCycleChange('monthly')}
            >
              Monthly
            </button>
            <button
              type="button"
              role="tab"
              className={cycle === 'annual' ? 'active' : undefined}
              onClick={() => trackCycleChange('annual')}
            >
              Annual
            </button>
            <button
              type="button"
              role="tab"
              className={cycle === 'annual-crypto' ? 'active' : undefined}
              onClick={() => trackCycleChange('annual-crypto')}
            >
              Annual + Crypto <span className="save-badge">−30%</span>
            </button>
          </div>
        </div>

        <div className="waitlist-strip">
          <div className="waitlist-strip-inner">
            <div className="waitlist-strip-icon">⏱</div>
            <div className="waitlist-strip-txt">
              <strong>Fiat billing opens Week 2 post-launch.</strong> Secure 1 of{' '}
              <span className="count">400</span> waitlist-reserved founding seats (of 1,000) —
              or pay in crypto today to claim instantly.
            </div>
          </div>
        </div>

        <div className="pricing-grid">
          {/* Citizen */}
          <div className="tier-card muted t-citizen">
            <div className="tier-code">T-00 · OBSERVER</div>
            <div className="tier-name">Citizen</div>
            <div className="tier-tag">
              For concerned observers. Read-only access to the operational globe.
            </div>
            <div className="price-original">&nbsp;</div>
            <div className="price-block">
              <span className="price-amt">Free</span>
            </div>
            <div className="price-note dim">No card required</div>
            <Link href="/auth/signup" className="tier-btn">
              Start Observing Free
            </Link>
            <div className="tier-section-label">Includes</div>
            <ul className="tier-features">
              <li>
                <strong>IM-01</strong> Operational Globe (limited view)
              </li>
              <li>
                <strong>1 watchlist</strong>, up to 5 assets
              </li>
              <li>
                24-hour <strong>delayed</strong> data feeds
              </li>
              <li>
                Daily plain-language <strong>citizen briefing</strong> (IM-25)
              </li>
              <li className="disabled">AI analyst access</li>
              <li className="disabled">Intelligence Menu (25+ modules)</li>
            </ul>
          </div>

          {/* Pro */}
          <div className="tier-card highlight t-pro">
            <div className="tier-code">T-01 · PRO</div>
            <div className="tier-name">Pro</div>
            <div className="tier-tag">
              For OSINT analysts and day-traders. Full platform, single seat.
            </div>
            <div className="price-original">
              <span className="strike">{pro.strike}</span>
              <span className="save-pill">{pro.savings}</span>
            </div>
            <div className="price-block">
              <span className="price-amt">{pro.amt}</span>
              <span className="price-per">{pro.per}</span>
            </div>
            <div className="price-note">Founding rate · locked for life</div>
            <CtaButton cta={proCta} primary onWaitlist={openWaitlist} />
            <div className="tier-section-label">Everything in Citizen, plus</div>
            <ul className="tier-features">
              <li>
                <strong>All 25+ Intelligence Menu</strong> modules (IM-01 → IM-27)
              </li>
              <li>
                <strong>Real-time</strong> feeds: AIS, ADS-B, ACLED
              </li>
              <li>
                <strong>IM-13 Asset Impact Lens</strong> +{' '}
                <strong>IM-14 Crypto Flow Monitor</strong>
              </li>
              <li>
                <strong>AI Analyst</strong> — 500 queries / month (IM-23)
              </li>
              <li>10 watchlists, 50 assets each</li>
              <li>Compound-signal alerts (IM-24) · email + push</li>
              <li>
                Full data <strong>export</strong> — GeoJSON, CSV (IM-27)
              </li>
            </ul>
          </div>

          {/* Enterprise */}
          <div className="tier-card t-enterprise">
            <div className="tier-code">T-02 · TEAM</div>
            <div className="tier-name">Enterprise</div>
            <div className="tier-tag">
              For trading desks and small newsrooms. Team workspace, shared watchlists, API
              access.
            </div>
            <div className="price-original">
              <span className="strike">{ent.strike}</span>
              <span className="save-pill">{ent.savings}</span>
            </div>
            <div className="price-block">
              <span className="price-amt">{ent.amt}</span>
              <span className="price-per">{ent.per}</span>
            </div>
            <div className="price-note">3-seat minimum · locked for life</div>
            <CtaButton cta={entCta} onWaitlist={openWaitlist} />
            <div className="tier-section-label">Everything in Pro, plus</div>
            <ul className="tier-features">
              <li>
                Team <strong>workspaces</strong> + shared watchlists
              </li>
              <li>
                Collaborative <strong>annotation</strong> layer
              </li>
              <li>
                AI Analyst — <strong>5,000 queries</strong> / month / seat (IM-23)
              </li>
              <li>
                <strong>REST API</strong> access — 10k calls / month (IM-27)
              </li>
              <li>
                <strong>IM-26 Calibration Ledger</strong> on team track record
              </li>
              <li>
                Exportable <strong>PDF briefs</strong> (IM-25)
              </li>
              <li>Priority support · &lt; 4h response</li>
            </ul>
          </div>
        </div>
      </section>

      {/* ─── CRYPTO CALLOUT ──────────────────────────────────────── */}
      <section className="crypto-callout">
        <div className="crypto-box">
          <div className="icon-block">
            <div className="crypto-icon">₿</div>
            <div className="crypto-txt">
              <h3>
                Pay annually in crypto, save <span className="pct">30% extra</span>.
              </h3>
              <p>
                Annual-only — USDC, USDT, BTC, or ETH on native chains, plus USDC/USDT on
                Polygon and Base. Settles in minutes, no chargebacks. Price is quoted in
                USD-equivalent and locked for 20 minutes at checkout.
              </p>
            </div>
          </div>
          <div className="crypto-coins">
            <span>USDC</span>
            <span>USDT</span>
            <span>BTC</span>
            <span>ETH</span>
            <span>+ L2</span>
          </div>
        </div>
      </section>

      {/* ─── REFERRAL ────────────────────────────────────────────── */}
      <div className="referral-bg">
        <section className="section" id="referral">
          <div className="section-head">
            <div className="section-kicker">·· Referral Program ··</div>
            <h2 className="section-title">
              Bring your network — <span className="accent">earn for life</span>.
            </h2>
            <p className="section-sub">
              Every paying member gets a unique referral link. Share it, get paid.
            </p>
          </div>
          <div className="referral-steps">
            <div className="step">
              <div className="step-num">1</div>
              <div className="step-title">Get your link.</div>
              <p className="step-body">
                Every Pro and Enterprise member automatically gets a unique referral link in
                their dashboard.
              </p>
            </div>
            <div className="step">
              <div className="step-num">2</div>
              <div className="step-title">Share it.</div>
              <p className="step-body">
                Post it on X, Substack, your trading Discord, or email it directly to analyst
                colleagues.
              </p>
            </div>
            <div className="step">
              <div className="step-num">3</div>
              <div className="step-title">Earn.</div>
              <p className="step-body">
                For every referral that converts to paid, choose one:{' '}
                <strong style={{ color: 'var(--text-primary)' }}>
                  30% lifetime commission
                </strong>{' '}
                on their subscription, OR{' '}
                <strong style={{ color: 'var(--text-primary)' }}>
                  2 months of your own subscription free
                </strong>
                .
              </p>
            </div>
          </div>
          <div className="referral-unlock">
            <strong>Founding Referrer badge</strong> · Unlock at 5 paid referrals. Public
            recognition, priority feature requests, and early access to new Intelligence Menu
            modules. Referrals tracked via Rewardful · commissions paid monthly via Stripe
            Connect, PayPal, or USDC · referred users receive 25% off their first year.
          </div>
          <div className="referral-cta">
            <a href="#pricing" className="btn-primary">
              Join as Pro — your referral link is waiting →
            </a>
          </div>
        </section>
      </div>

      {/* ─── FAQ ─────────────────────────────────────────────────── */}
      <section className="faq" id="faq">
        <h2>
          Frequently <span className="accent">asked</span>
        </h2>
        <Faq open q={'What does "Founding Member rate locked for life" mean?'}>
          If you subscribe to Pro or Enterprise at the Founding price before the first 1,000
          paid seats are taken, your rate is locked for as long as you maintain an active
          subscription — no price increases, no re-pricing at renewal. Standard prices (
          <code>$99/mo</code> Pro, <code>$199/seat/mo</code> Enterprise) apply to everyone
          after the founding cohort is full.
        </Faq>
        <Faq q="Why is fiat payment a waitlist instead of a direct purchase at launch?">
          We&apos;re sequencing the launch. <strong>Crypto payments</strong> (via
          NOWPayments) are live from day one — pay annually in USDC, USDT, BTC, or ETH and
          claim your founding seat instantly. <strong>Fiat billing</strong> (via Lemon
          Squeezy) activates in Week 2 post-launch. Until then,{' '}
          <strong>400 of the 1,000 founding seats</strong> are reserved for the fiat waitlist,
          allocated first-come, first-served by waitlist position. When fiat goes live, we
          email the top 400 with a payment-authorization link at the Founding rate, locked
          for life. Joining today costs nothing and keeps your seat warm.
        </Faq>
        <Faq q="I'm a crypto day-trader. What do I actually get that I couldn't cobble together myself?">
          A single screen where a Strait of Hormuz incident becomes a ranked list of affected
          crypto pairs in seconds, with historical base rates. You could theoretically piece
          together AIS, ACLED, sanctions feeds, and correlation analysis yourself — but not
          fast enough to trade on it. The <code>IM-13 Asset Impact Lens</code> and{' '}
          <code>IM-14 Crypto Flow Monitor</code> modules are purpose-built for this loop.
        </Faq>
        <Faq q="How fresh is the data?">
          Pro and Enterprise receive real-time feeds: <code>ADS-B ~15s</code>,{' '}
          <code>AIS ~60s</code>, <code>ACLED hourly</code>, static infrastructure daily.
          Citizen tier feeds are delayed by 24 hours. Every data point carries its source,
          license, and ingestion timestamp.
        </Faq>
        <Faq q="How does the crypto discount work in practice?">
          Select Annual billing, then toggle &quot;Annual + Crypto −30%&quot;. At checkout,
          choose your coin (USDC, BTC, ETH, or USDT). Your wallet is quoted in USD-equivalent
          at execution price via our payment processor. Crypto payments are annual-only — no
          monthly subscriptions on-chain — and the 30% discount applies automatically.
        </Faq>
        <Faq q="Which cryptocurrencies do you accept?">
          USDC, USDT, BTC, ETH on their native chains, plus USDC and USDT on Polygon and Base
          (lower gas fees). Minimum payment is the annual price of your chosen tier.
          Transactions typically confirm in under 15 minutes; your Pro or Enterprise access
          activates the moment the payment is confirmed on-chain.
        </Faq>
        <Faq q="What happens if the crypto price moves between checkout and confirmation?">
          Our processor (<strong>NOWPayments</strong>) locks the USD-equivalent quote for 20
          minutes from the moment you initiate payment. If the transaction confirms within
          that window, the locked rate applies. If it doesn&apos;t, the difference is
          reconciled automatically — you never pay more than the USD price shown at checkout,
          and small overpayments are credited to your account.
        </Faq>
        <Faq q="Can I switch between fiat and crypto, or between monthly and annual, later?">
          Yes. You can upgrade, downgrade, or switch payment method from your billing portal
          at any time. Annual plans paid in crypto do not auto-renew — you receive a renewal
          reminder 14 days before expiry and choose whether to continue. Fiat subscriptions
          renew automatically unless canceled.
        </Faq>
        <Faq q={'What counts as an AI analyst "query"?'}>
          A single natural-language question to the analyst panel, or one automated
          compound-signal alert your watchlist fires. Context-retrieval, map interactions,
          and feed browsing are <strong>free and unmetered</strong>. Pro = 500 queries/month,
          Enterprise = 5,000 queries/month/seat. Unused queries do not roll over.
        </Faq>
        <Faq q="Can I cancel? Is there a refund?">
          Yes. Cancel anytime from the billing portal — you keep access until the end of your
          paid period. We offer a no-questions 14-day refund on first monthly purchases and a
          30-day refund on first annual purchases. Crypto annual refunds are returned in the
          same coin at the rate paid. Full details in the{' '}
          <Link href="/refund" style={{ color: 'var(--cyan)' }}>
            Refund Policy
          </Link>
          .
        </Faq>
        <Faq q="Do you offer discounts for journalists, researchers, or students?">
          Yes. Verified journalists (press card), full-time academic researchers, and
          students receive an additional 50% off Pro and Enterprise tiers, stackable with the
          Founding rate. Email <code>verify@eykon.ai</code> with your credentials.
        </Faq>
        <Faq q="How does the referral program pay out?">
          Referrals are tracked via <strong>Rewardful</strong>. You choose one reward model
          per referred customer: 30% lifetime commission (paid monthly via Stripe Connect,
          PayPal, or USDC), OR 2 months of your own subscription free. Referred users
          receive 25% off their first year. See the Referral section above for mechanics.
        </Faq>
        <Faq q="Will the Intelligence Menu keep growing?">
          Yes. Pro and Enterprise members get every new module as it ships, at no additional
          cost, for as long as their Founding Member rate holds. The roadmap adds
          approximately eight modules over the next two quarters, focused on satellite-derived
          intelligence, network-graph analysis, and temporal pattern-matching.
        </Faq>
        <Faq q="Who's the platform NOT for?">
          eYKON is built for fast-decision individuals — day-traders, independent analysts,
          journalists, bloggers. If you need a procurement-friendly enterprise contract, a
          cleared-personnel deployment, or a $50k/year managed service, we&apos;re not the
          right fit today. Reach out if your needs evolve.
        </Faq>
        <Faq q="Where is my data stored and who can see it?">
          Platform is hosted on <strong>Railway</strong> and <strong>Supabase</strong> (EU
          regions available on request). We do not sell, share, or broker any user data. Your
          watchlists, queries, and alert history are visible only to you. Full details in the{' '}
          <Link href="/privacy" style={{ color: 'var(--cyan)' }}>
            Privacy Policy
          </Link>{' '}
          and{' '}
          <Link href="/dpa" style={{ color: 'var(--cyan)' }}>
            DPA
          </Link>
          .
        </Faq>
      </section>

      {/* ─── FOOTER ──────────────────────────────────────────────── */}
      <footer>
        <div className="footer-grid">
          <div className="footer-col">
            <div className="footer-brand">
              <div className="brand-mark">⊕</div>
              <div className="brand-name">
                eYKON<span className="dot">.ai</span>
              </div>
            </div>
            <p className="footer-tag">Geopolitical signals for fast decisions.</p>
            <p className="footer-copy">© 2026 eYKON.ai</p>
          </div>

          <div className="footer-col">
            <h4>Product</h4>
            <ul>
              <li><a href="#platform">Platform</a></li>
              <li><a href="#intelligence">Intelligence Menu</a></li>
              <li><a href="#pricing">Pricing</a></li>
              <li><a href="#faq">FAQ</a></li>
              <li><Link href="/grow">How eYKON grows</Link></li>
              <li>
                <a href="https://status.eykon.ai" target="_blank" rel="noreferrer">
                  Status Page
                </a>
              </li>
            </ul>
          </div>

          <div className="footer-col">
            <h4>Legal &amp; contact</h4>
            <ul>
              <li><Link href="/terms">Terms of Service</Link></li>
              <li><Link href="/privacy">Privacy Policy</Link></li>
              <li><Link href="/refund">Refund Policy</Link></li>
              <li><Link href="/cookies">Cookie Policy</Link></li>
              <li><Link href="/dpa">DPA</Link></li>
              <li><a href="mailto:support@eykon.ai">support@eykon.ai</a></li>
              <li><a href="mailto:verify@eykon.ai">verify@eykon.ai</a></li>
            </ul>
          </div>
        </div>
        <div className="compliance-strip">
          eYKON.ai is not a financial advisor. Intelligence signals are decision-support, not
          trade recommendations. Past performance is not indicative of future results.
        </div>
      </footer>

      {/* ─── WAITLIST MODAL ──────────────────────────────────────── */}
      <WaitlistModal
        open={modalOpen}
        tier={modalTier}
        onClose={closeWaitlist}
        onTierChange={setModalTier}
      />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────
// Sub-components
// ───────────────────────────────────────────────────────────────

function Pillar({ label, title, body }: { label: string; title: string; body: string }) {
  return (
    <div className="pillar">
      <div className="pillar-label">{label}</div>
      <div className="pillar-title">{title}</div>
      <p className="pillar-body">{body}</p>
    </div>
  );
}

function Cluster({
  title,
  code,
  lead,
  modules,
  foreground = false,
}: {
  title: string;
  code: string;
  lead?: string;
  modules: Array<[string, string, string]>;
  foreground?: boolean;
}) {
  return (
    <div className={foreground ? 'cluster foreground' : 'cluster'}>
      <div className="cluster-head">
        <div className="cluster-title">{title}</div>
        <div className="cluster-code">{code}</div>
      </div>
      {lead && <div className="cluster-lead">{lead}</div>}
      {modules.map(([mcode, mname, mdesc]) => (
        <div className="module-row" key={mcode}>
          <div className="module-code">{mcode}</div>
          <div className="module-name">{mname}</div>
          <div className="module-desc">{mdesc}</div>
        </div>
      ))}
    </div>
  );
}

function CtaButton({
  cta,
  primary,
  onWaitlist,
}: {
  cta: CtaAction;
  primary?: boolean;
  onWaitlist: (tier: 'pro' | 'enterprise') => void;
}) {
  const cls = primary ? 'tier-btn primary' : 'tier-btn';
  if (cta.kind === 'waitlist') {
    return (
      <button
        type="button"
        className={cls}
        onClick={() => onWaitlist(cta.tier)}
      >
        {cta.label}
      </button>
    );
  }
  return (
    <Link href={cta.href} className={cls}>
      {cta.label}
    </Link>
  );
}

function Faq({
  q,
  children,
  open = false,
}: {
  q: string;
  children: React.ReactNode;
  open?: boolean;
}) {
  return (
    <details className="faq-item" open={open}>
      <summary className="faq-q">{q}</summary>
      <p className="faq-a">{children}</p>
    </details>
  );
}

// ───────── Waitlist modal ─────────

function WaitlistModal({
  open,
  tier,
  onClose,
  onTierChange,
}: {
  open: boolean;
  tier: 'pro' | 'enterprise';
  onClose: () => void;
  onTierChange: (t: 'pro' | 'enterprise') => void;
}) {
  const emailRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'info' | 'success' | 'error' } | null>(
    null,
  );

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => emailRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
    setMsg(null);
  }, [open]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    const data = Object.fromEntries(new FormData(form).entries());
    setSubmitting(true);
    setMsg({ text: 'Reserving your seat…', tone: 'info' });

    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        setMsg({
          text: '✓ You are on the waitlist. Check your inbox for confirmation.',
          tone: 'success',
        });
        form.reset();
        setTimeout(onClose, 2600);
      } else {
        const body = await res.json().catch(() => ({}));
        setMsg({
          text: body?.error ?? 'Something went wrong. Please try again.',
          tone: 'error',
        });
      }
    } catch {
      setMsg({
        text: '✓ Received. We will email you when fiat billing opens.',
        tone: 'success',
      });
      form.reset();
      setTimeout(onClose, 2600);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className={open ? 'modal-backdrop open' : 'modal-backdrop'}
      aria-hidden={!open}
      role="dialog"
      aria-modal="true"
      aria-labelledby="waitlist-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-card">
        <button
          type="button"
          className="modal-close"
          aria-label="Close"
          onClick={onClose}
        >
          ×
        </button>
        <div className="modal-kicker">·· Fiat waitlist ··</div>
        <h3 className="modal-title" id="waitlist-title">
          Reserve your founding seat.
        </h3>
        <p className="modal-sub">
          400 of the 1,000 founding seats are reserved for the fiat waitlist. When fiat
          billing launches in Week 2 post-launch, we email the top 400 for payment
          authorization at the Founding rate — locked for life. First-come, first-served.
        </p>
        <form className="waitlist-form" onSubmit={onSubmit} noValidate>
          <div className="form-row">
            <label htmlFor="wl-email">Email</label>
            <input
              ref={emailRef}
              type="email"
              id="wl-email"
              name="email"
              required
              placeholder="you@domain.com"
              autoComplete="email"
            />
          </div>
          <div className="form-row">
            <label htmlFor="wl-tier">Tier</label>
            <select
              id="wl-tier"
              name="tier"
              required
              value={tier}
              onChange={(e) => onTierChange(e.target.value as 'pro' | 'enterprise')}
            >
              <option value="pro">Pro · $29/mo founding</option>
              <option value="enterprise">
                Enterprise · $99/seat/mo founding (3-seat min)
              </option>
            </select>
          </div>
          <div className="form-row">
            <label htmlFor="wl-note">
              Anything we should know? <span className="form-optional">(optional)</span>
            </label>
            <textarea
              id="wl-note"
              name="note"
              rows={2}
              placeholder="Seat count, use case, timing…"
            />
          </div>
          <label className="form-consent">
            <input type="checkbox" name="consent" required />
            <span>
              I agree to be contacted by eYKON.ai about my waitlist seat. No marketing spam.
            </span>
          </label>
          <button type="submit" className="btn-primary modal-submit" disabled={submitting}>
            {submitting ? 'Reserving…' : 'Reserve my seat →'}
          </button>
          <div
            className="form-msg"
            role="status"
            aria-live="polite"
            style={{
              color:
                msg?.tone === 'success'
                  ? 'var(--cyan)'
                  : msg?.tone === 'error'
                  ? 'var(--red)'
                  : 'var(--text-secondary)',
            }}
          >
            {msg?.text ?? ''}
          </div>
        </form>
      </div>
    </div>
  );
}
