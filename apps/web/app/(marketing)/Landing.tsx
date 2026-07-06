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
import { CommShowcase } from '@/components/landing/CommShowcase';
import { BriefsShowcase } from '@/components/landing/BriefsShowcase';

// Billing cycle state — drives prices and CTAs across the pricing grid.
type Cycle = 'monthly' | 'annual' | 'annual-crypto';

// The cycle the pricing grid lands on. Default to Annual + Crypto: it is the
// only rail that can actually transact today (the fiat tabs just open the
// waitlist), and it anchors on the best price + the founding offer. Revisit
// when fiat (Lemon Squeezy) launches.
const DEFAULT_CYCLE: Cycle = 'annual-crypto';

type PriceText = { amt: string; per: string; strike: string; savings: string };

const PRO_PRICES: Record<Cycle, PriceText> = {
  monthly: { amt: '$29', per: '/ month', strike: '$99/mo standard', savings: '−70%' },
  annual: { amt: '$348', per: '/ year', strike: '$1,188/yr standard', savings: '−71%' },
  'annual-crypto': {
    amt: '$244',
    per: '/ year in crypto',
    strike: '$1,010/yr standard',
    savings: '−76%',
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
    strike: '$2,030/seat/yr standard',
    savings: '−59%',
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
    // Route through /pricing (the auth-aware checkout router), NOT
    // /auth/signup: signed-in users must land straight on the NOWPayments
    // launcher; /pricing redirects only signed-out users to signup.
    href: '/pricing?plan=pro_founding_annual',
    label: 'Claim Founding Rate (crypto) →',
  },
};

const ENTERPRISE_CTA: Record<Cycle, CtaAction> = {
  monthly: { kind: 'waitlist', tier: 'enterprise', label: 'Join fiat waitlist →' },
  annual: { kind: 'waitlist', tier: 'enterprise', label: 'Join fiat waitlist →' },
  'annual-crypto': {
    kind: 'crypto',
    // See PRO_CTA: /pricing is the auth-aware checkout router.
    href: '/pricing?plan=enterprise_founding_annual',
    label: 'Start 3-Seat Team (crypto) →',
  },
};

// Member (monetisation review §4.1): the community rung between Citizen
// and Pro. No founding cohort, no strike-through story — one honest
// price. Fiat cycles still route to the crypto annual checkout (Member
// is deliberately NOT on the fiat waitlist — migration 072 note);
// monthly $12 arrives with fiat billing.
const MEMBER_PRICES: Record<Cycle, { amt: string; per: string; note: string }> = {
  monthly: {
    amt: '$12',
    per: '/ month',
    note: 'Monthly opens with fiat billing · pay $84.15/yr in crypto today',
  },
  annual: {
    amt: '$99',
    per: '/ year',
    note: 'Fiat annual opens soon · pay $84.15/yr in crypto today',
  },
  'annual-crypto': {
    amt: '$84.15',
    per: '/ year in crypto',
    note: '−15% crypto rate on the $99 annual price',
  },
};

const MEMBER_CTA: Record<Cycle, CtaAction> = {
  // Crypto is the only rail that can transact today (see DEFAULT_CYCLE);
  // all three cycles route to the auth-aware checkout router.
  monthly: { kind: 'crypto', href: '/pricing?plan=member_standard_annual', label: 'Join as Member (crypto annual) →' },
  annual: { kind: 'crypto', href: '/pricing?plan=member_standard_annual', label: 'Join as Member (crypto annual) →' },
  'annual-crypto': { kind: 'crypto', href: '/pricing?plan=member_standard_annual', label: 'Join as Member →' },
};

const NAV_ANCHORS = ['top', 'platform', 'intelligence', 'community', 'pricing', 'faq'] as const;

export function Landing() {
  const [cycle, setCycle] = useState<Cycle>(DEFAULT_CYCLE);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTier, setModalTier] = useState<'pro' | 'enterprise'>('pro');
  const [activeSection, setActiveSection] = useState<string>('top');

  // Founding seats remaining — wired to the real computed count
  // (GET /api/founding/spots → lib/founding-seats, decision D-4). The page
  // stays static; we progressively replace the marketing fallback once the
  // real number loads. Both pills below read `spotsLeft ?? 847`.
  const [spotsLeft, setSpotsLeft] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/founding/spots')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (alive && d && typeof d.spots_left === 'number') setSpotsLeft(d.spots_left);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const spotsDisplay = (spotsLeft ?? 847).toLocaleString('en-US');

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
    // Only fire plan_selected when the user deliberately moves off the
    // default cycle — landing on DEFAULT_CYCLE isn't a deliberate choice.
    if (nextCycle !== DEFAULT_CYCLE) {
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
  const member = MEMBER_PRICES[cycle];
  const proCta = PRO_CTA[cycle];
  const entCta = ENTERPRISE_CTA[cycle];
  const memberCta = MEMBER_CTA[cycle];

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
          {(['platform', 'intelligence', 'community', 'pricing', 'faq'] as const).map((id) => (
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
          <span className="count">■ {spotsDisplay}</span> of <span className="count">1,000</span>{' '}
          founding seats remaining · USD pricing · Pay in fiat or crypto
        </p>
        <p className="hero-meta">
          Live feeds free on <span className="count">every tier</span> — you pay for
          intelligence, never the map.
        </p>
        <div className="hero-ctas">
          <a href="#pricing" className="btn-primary">
            Claim Founding Rate →
          </a>
          <a href="#pricing" className="btn-text">
            Or start free as Observer — no time limit
          </a>
        </div>
        <p className="hero-trial-note">
          Observer is free forever. Use it as your trial: a live workspace, daily
          briefing, weekly intelligence email, and 5 AI analyst queries / month —
          no countdown, no card required.
        </p>
      </section>

      {/* ─── PLATFORM ────────────────────────────────────────────── */}
      <section className="section" id="platform">
        <div className="section-head">
          <div className="section-kicker">·· Platform ··</div>
          <h2 className="section-title">
            The <span className="accent">platform</span>.
          </h2>
          <p className="section-sub">
            Six pillars. One platform. The map is free — the intelligence is the product.
          </p>
        </div>
        <div className="pillars">
          <Pillar
            label="P-01 · GLOBE"
            title="The state of the world, on one screen — free for everyone."
            body="Live vessels (AIS), aircraft (ADS-B), conflict events (GDELT 2.0) and weather, over the infrastructure that makes them interpretable: ~127,000 power-plant units, ~700 refineries, ~304,000 mineral deposits, ~3,800 seaports, ~7,500 airports, gas and oil pipelines, LNG terminals. Every layer carries its source and refresh timestamp inline. Live feeds are free on every tier — including free."
          />
          <Pillar
            label="P-02 · AI ANALYST"
            title="Ask in plain English. It queries the database."
            body="A Fable 5 analyst with a catalog of first-class tools wired directly into the live feeds and the platform's proprietary signal tables — no SQL, no guessing from documentation. Persona-aware: pick one of seven roles and the framing, tool selection and output density adapt. When the data can't support an answer, it says so."
          />
          <Pillar
            label="P-03 · INTEL"
            title="Nine workspaces where signals become decisions."
            body="Calibration Ledger, Shadow Fleet, Regime Shifts, Chokepoint Simulator, Sanctions Wargame, Cascade Propagation, Precursor Analogs, Commodities, Critical Minerals — compound signals computed on eYKON infrastructure, with posture scores for five named theatres refreshed every 30 minutes."
          />
          <Pillar
            label="P-04 · NOTIF"
            title="Alerts that watch four different ways."
            body="Single-event, multi-event, outcome-driven AI (&quot;anything that could move WTI by ≥$2/bbl in 24 hours&quot;), and cross-data convergence rules — evaluated on 15-minute and hourly cadences, delivered by email, SMS and WhatsApp, with a persona-tuned starter library so a working pipeline takes three clicks."
          />
          <Pillar
            label="P-05 · COMM"
            title="The network where being right is measurable."
            body="Sealed, commit-reveal predictions scored against live outcomes; a leaderboard ranked by Brier-skill, not follower count; rooms, DMs, and an in-room analyst; paid Spaces in non-custodial USDC where calibrated analysts monetise their track record. Reputation earned by being right — wrong calls left standing."
          />
          <Pillar
            label="P-06 · BRIEFS"
            title="What eYKON publishes back."
            body="A daily brief composed each morning from the live feeds, persona digests for seven roles, the convergence wire — and eYKON's own forecasts, sealed at issue and scored in public when they resolve. Reporting you can audit, not just read."
          />
        </div>
        <div className="stat-strip">
          <div className="stat">
            <span className="val">6</span> pillars
          </div>
          <div className="stat sep">·</div>
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
              ['IM-04', 'Conflict Feed', 'GDELT 2.0 events with escalation scoring and territorial-control deltas.'],
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

      {/* ─── COMM — community, reputation, creator economy ───────── */}
      <CommShowcase />

      {/* ─── BRIEFS — the reading room ────────────────────────────── */}
      <BriefsShowcase />

      {/* ─── PRICING ─────────────────────────────────────────────── */}
      <section id="pricing" style={{ paddingTop: 60 }}>
        <div className="section-head" style={{ padding: '0 32px' }}>
          <div className="section-kicker">·· Pricing ··</div>
          <h2 className="section-title">
            Founding rate, <span className="accent">locked for life</span>.
          </h2>
          <p className="section-sub">
            Four honest rungs. US dollars. Fiat or crypto. No hidden seats, no hidden fees.
          </p>
        </div>

        <div className="feeds-free-strip">
          Live feeds are free for everyone. What you pay for on eYKON is{' '}
          <strong>intelligence, never the map</strong>.
        </div>

        <div className="scarcity-strip">
          <span className="mark">■</span> Founding seats remaining ·{' '}
          <span className="count">{spotsDisplay}</span> of <span className="count">1,000</span>
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
              Free forever. Your trial that never expires.
            </div>
            <div className="price-original">&nbsp;</div>
            <div className="price-block">
              <span className="price-amt">Free</span>
            </div>
            <div className="price-note dim">No card required · no time limit</div>
            <Link href="/auth/signup" className="tier-btn">
              Start Observing Free
            </Link>
            <div className="tier-section-label">Includes</div>
            <ul className="tier-features">
              <li>
                Operational <strong>Globe</strong> with all map layers
              </li>
              <li>
                <strong>Live feeds</strong> — AIS, ADS-B, conflicts · 1 <strong>watchlist</strong>
              </li>
              <li>
                Daily personalised <strong>briefing</strong> on the home screen
              </li>
              <li>
                Weekly <strong>briefing email</strong> · Tuesday 09:00 UTC
              </li>
              <li>
                <strong>5 AI Analyst</strong> queries / month
              </li>
              <li>
                1 live <strong>notification rule</strong> · email-only
              </li>
              <li>
                <strong>Calibration Ledger</strong> preview · 8 more workspaces visible
              </li>
            </ul>
          </div>

          {/* Member */}
          <div className="tier-card t-member">
            <div className="tier-code">T-01 · MEMBER</div>
            <div className="tier-name">Member</div>
            <div className="tier-tag">
              For the community. Full standing in COMM, Spaces and your track record.
            </div>
            <div className="price-original">&nbsp;</div>
            <div className="price-block">
              <span className="price-amt">{member.amt}</span>
              <span className="price-per">{member.per}</span>
            </div>
            <div className="price-note dim">{member.note}</div>
            <CtaButton cta={memberCta} onWaitlist={openWaitlist} />
            <div className="tier-section-label">Everything in Citizen, plus</div>
            <ul className="tier-features">
              <li>
                <strong>25 AI Analyst</strong> queries / month · full tool surface
              </li>
              <li>
                Persisted <strong>query history</strong> — pick any thread back up
              </li>
              <li>
                5 live <strong>notification rules</strong> · email
              </li>
              <li>
                3 <strong>watchlists</strong>
              </li>
            </ul>
          </div>

          {/* Pro */}
          <div className="tier-card highlight t-pro">
            <div className="tier-code">T-02 · PRO</div>
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
                <strong>SMS + WhatsApp</strong> alert delivery
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
            <div className="tier-code">T-03 · TEAM</div>
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

        <div className="passes-strip">
          <div className="passes-strip-title">No subscription? Two honest one-offs.</div>
          <div className="passes-grid">
            <div className="pass-card">
              <div className="pass-name">
                Week Pass <span className="pass-price">$9</span>
              </div>
              <p className="pass-body">
                Everything Pro for 7 days, while the event is live. No subscription, no
                auto-renew — it simply expires.
              </p>
              <Link href="/pricing?plan=week_pass" className="tier-btn">
                Get a Week Pass →
              </Link>
            </div>
            <div className="pass-card">
              <div className="pass-name">
                Query Pack <span className="pass-price">$5</span>
              </div>
              <p className="pass-body">
                25 extra AI Analyst queries added to your current month. Stackable, on any
                plan.
              </p>
              <Link href="/pricing?plan=query_pack_25" className="tier-btn">
                Add 25 queries →
              </Link>
            </div>
          </div>
        </div>

        <p className="refund-disclosure">
          <strong>14-day full refund.</strong> Single-click from billing. No questions.
          Crypto refunds settle in USDC.
        </p>
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
              <p>
                That <span className="pct">30%</span> is the <strong>founding</strong> crypto
                rate — lock it for life by claiming one of the first 1,000 seats. Once they&apos;re
                gone, standard crypto pricing is <span className="pct">15%</span> off.
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

      {/* ─── HOW EYKON GROWS ─────────────────────────────────────── */}
      <div className="referral-bg">
        <section className="section" id="referral">
          <div className="section-head">
            <div className="section-kicker">·· How eYKON grows ··</div>
            <h2 className="section-title">
              Through the work, <span className="accent">not the funnel</span>.
            </h2>
            <p className="section-sub">
              eYKON grows through what its users build. Every analytical view you create is
              shareable, and every share is attributed automatically. Practitioners with weight
              in their networks become founder advocates by invitation.
            </p>
          </div>
          <div className="referral-steps">
            <div className="step">
              <div className="step-num">1</div>
              <div className="step-title">Share your work.</div>
              <p className="step-body">
                Every analyst conversation, notification fire, and replayable view inside
                eYKON has a Share button. Clicking it copies a public link that automatically
                carries your attribution.
              </p>
            </div>
            <div className="step">
              <div className="step-num">2</div>
              <div className="step-title">Attribution is silent.</div>
              <p className="step-body">
                When someone signs up after viewing what you shared, we know it came from you.
                No dashboard to check, no commission to chase, no link to remember. The
                mechanic runs in the background.
              </p>
            </div>
            <div className="step">
              <div className="step-num">3</div>
              <div className="step-title">Become a founder advocate.</div>
              <p className="step-body">
                Practitioners whose endorsement carries real weight — analysts, traders,
                journalists, researchers, podcast hosts — are invited into a hand-curated
                partnership program with cash compensation on bilateral terms.
              </p>
            </div>
          </div>
          <div className="referral-unlock">
            The full program — philosophy, attribution mechanics, FAQ, and the inbound
            application form — lives on a dedicated page. We do not run an open affiliate
            program because we do not believe that is the right shape for an intelligence
            platform.
          </div>
          <div className="referral-cta">
            <Link href="/grow" className="btn-primary">
              How eYKON grows →
            </Link>
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
          Every plan — including Citizen — receives real-time feeds: <code>ADS-B ~15s</code>,{' '}
          <code>AIS ~60s</code>, <code>GDELT ~hourly</code>, static infrastructure daily.
          Paid tiers differ on the intelligence layer — AI Analyst budget, the nine INTEL
          workspaces, alerts and exports — never on the rawness of the map. Every data
          point carries its source, license, and ingestion timestamp.
        </Faq>
        <Faq q="How does the crypto discount work in practice?">
          Select Annual billing, then toggle &quot;Annual + Crypto −30%&quot;. At checkout,
          choose your coin (USDC, BTC, ETH, or USDT). Your wallet is quoted in USD-equivalent
          at execution price via our payment processor. Crypto payments are annual-only — no
          monthly subscriptions on-chain — and the 30% discount applies automatically.
          That 30% is part of the founding offer: claim one of the first 1,000 seats and it&apos;s
          locked for life. Once those are gone, standard crypto pricing is 15% off.
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
          and feed browsing are <strong>free and unmetered</strong>. Citizen = 5
          queries/month, Member = 25/month on the full tool surface, Pro = 500/month,
          Enterprise = 5,000/month/seat. A <strong>Query Pack</strong> ($5) adds 25 queries
          to any month. Unused queries do not roll over.
        </Faq>
        <Faq q="What is a Week Pass?">
          $9 for <strong>everything Pro for 7 days</strong> — built for live events. No
          subscription, no auto-renew; access simply expires. Its companion, the{' '}
          <strong>Query Pack</strong> ($5), adds 25 AI Analyst queries to your current month
          on any plan, including free.
        </Faq>
        <Faq q="What is the Reputation Note?">
          The spine of COMM. Analysts seal predictions with a commit-reveal SHA-256 hash
          before the outcome, reveal them after, and every call is scored against live
          resolution — wrong calls stay on the record. Ten resolved predictions earn a public{' '}
          <strong>Reputation Note</strong>: a Brier-skill score on your profile. The Note is{' '}
          <strong>never for sale</strong> — no tier, no payment, no partnership changes it.
        </Faq>
        <Faq q="What is a paid Space, and who can run one?">
          Paid Spaces are subscription communities run by calibrated analysts, settled in{' '}
          <strong>USDC on Base</strong> through the creator&apos;s own Unlock lock —
          non-custodial: your lock, your wallet, eYKON never holds your funds. Platform fee
          is 15%, enforced on-chain. Creating a paid Space requires a shown Reputation Note —
          or a <strong>Founding Partner</strong> seat. Creators also earn a{' '}
          <strong>25% conversion bounty</strong> on the first-year subscription of any Space
          member who upgrades to an eYKON plan, and <strong>Creator Pro</strong> ($20/month,
          free for life for the first 50 creators) adds the dashboard, an embeddable
          reputation card, Space branding, and Discover priority.
        </Faq>
        <Faq q="What is the Founding Partner programme?">
          Twenty seats, ever. eYKON&apos;s rule is that you don&apos;t charge a community
          until your track record is provable — ten resolved, sealed predictions, scored in
          public. The Founding Partner programme is the bridge for analysts who arrive with
          credibility earned elsewhere: vetted for tone, reach and credibility (never
          self-serve), partners receive immediate paid-Space rights, Creator Pro for life,
          and the Founding Partner emblem — in exchange for earning their Reputation Note
          within six months, on the same commit-reveal rules as everyone else.{' '}
          <strong>The first slot is taken. Nineteen remain.</strong> Introduce yourself at{' '}
          <code>partners@eykon.ai</code>.
        </Faq>
        <Faq q="Can I cancel? Is there a refund?">
          Yes. Cancel anytime from the billing portal — you keep access until the end of your
          paid period. We offer a no-questions <strong>14-day refund</strong> on any first
          purchase (monthly or annual, fiat or crypto). Single-click from billing. Crypto
          refunds settle in <strong>USDC</strong> within 5 business days. Full details in the{' '}
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
        <Faq q="How does the referral program work?">
          eYKON does not run a public open-enrollment affiliate program. Sharing inside the
          product is silent and automatically attributed — every shareable view carries the
          source&apos;s identifier without any setup. Beyond that, we run a hand-curated{' '}
          <strong>founder advocate program</strong> for practitioners whose endorsement
          carries weight in their networks; advocates receive cash compensation on agreed
          terms. Full mechanics and the inbound application form are on the{' '}
          <Link href="/grow" style={{ color: 'var(--cyan)' }}>
            How eYKON grows
          </Link>{' '}
          page.
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
              <li><a href="#community">Community (COMM)</a></li>
              <li><a href="#briefs">BRIEFS</a></li>
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
