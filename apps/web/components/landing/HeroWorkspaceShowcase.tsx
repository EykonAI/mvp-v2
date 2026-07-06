'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

// Section §5 of the landing page. Three Hero workspaces in fixed
// order — Calibration Ledger, Shadow Fleet, Regime Shifts. Marketing
// surface narrowed per the workspace-tiering decision (BACKEND/Intel
// workspaces update). Order is locked by JSX, not sort: Calibration
// first because it underwrites the other two.
//
// Landing update 2026-07-06: rotating carousel on desktop, centre card
// zoomed. All three cards stay in the DOM; the carousel is a visual
// transform layer only. Static grid is the SSR/no-JS/reduced-motion/
// narrow-viewport rendering.

const HERO_WORKSPACES = [
  {
    label: 'Calibration Ledger',
    href: '/intel/calibration',
    body: 'Brier and log-loss across 7-, 30-, and 90-day windows. Every probabilistic claim is logged, scored, and published — defensible by audit.',
  },
  {
    label: 'Shadow Fleet',
    href: '/intel/shadow-fleet',
    body: 'Ranked vessel leads with composite score across multiple indicators. The strongest analyst-persona workspace; the workspace traders use to anticipate sanctions and supply disruptions.',
  },
  {
    label: 'Regime Shifts',
    href: '/intel/regime-shifts',
    body: '30-day-vs-60-day statistical test with p-values and effect sizes. The trader-persona artefact: quantitative, confidence-framed, converts naturally into a trade hypothesis.',
  },
];

const ROTATE_MS = 6000;

export function HeroWorkspaceShowcase() {
  const [center, setCenter] = useState(0);
  const [carousel, setCarousel] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [paused, setPaused] = useState(false);

  // Progressive enhancement: the carousel only switches on after mount,
  // on wide viewports, and never under prefers-reduced-motion.
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduced && window.innerWidth > 900) setCarousel(true);
  }, []);

  useEffect(() => {
    if (!carousel || !autoRotate || paused) return;
    const t = setInterval(() => setCenter(c => (c + 1) % HERO_WORKSPACES.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [carousel, autoRotate, paused]);

  // Deliberate interaction stops auto-rotation for good.
  function goTo(idx: number) {
    setAutoRotate(false);
    setCenter((idx + HERO_WORKSPACES.length) % HERO_WORKSPACES.length);
  }

  function slotClass(idx: number): string {
    if (!carousel) return 'ws-slot';
    const offset = (idx - center + HERO_WORKSPACES.length) % HERO_WORKSPACES.length;
    return `ws-slot ${offset === 0 ? 'pos-center' : offset === 1 ? 'pos-right' : 'pos-left'}`;
  }

  return (
    <section
      className="ws-showcase"
      aria-roledescription="carousel"
      aria-label="Hero workspaces"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div className="ws-kicker">·· Hero workspaces ··</div>
      <h2 className="ws-title">
        Three workspaces that <span style={{ color: 'var(--cyan)' }}>do the conversion</span>.
      </h2>
      <p className="ws-sub">
        Calibration underwrites the trustworthiness of the other two. Shadow Fleet is the analyst
        hero. Regime Shifts is the trader hero. Together they tell a coherent story without
        requiring the user to learn seven different workspace concepts.
      </p>

      <div className={carousel ? 'ws-carousel' : 'ws-grid'}>
        {HERO_WORKSPACES.map((w, idx) => (
          <div className={slotClass(idx)} key={w.href}>
            <Link
              href={w.href}
              className="ws-card"
              tabIndex={carousel && idx !== center ? -1 : undefined}
              aria-hidden={carousel && idx !== center ? true : undefined}
              onClick={e => {
                // Side cards rotate to the centre instead of navigating;
                // only the centre card opens its workspace.
                if (carousel && idx !== center) {
                  e.preventDefault();
                  goTo(idx);
                }
              }}
            >
              <div className="ws-card-kicker">Workspace</div>
              <div className="ws-card-title">{w.label}</div>
              <div className="ws-card-body">{w.body}</div>
              <div className="ws-card-open">Open →</div>
            </Link>
          </div>
        ))}
      </div>

      {carousel && (
        <div className="ws-controls">
          <button
            type="button"
            className="lc-arrow"
            aria-label="Previous workspace"
            onClick={() => goTo(center - 1)}
          >
            ‹
          </button>
          {HERO_WORKSPACES.map((w, idx) => (
            <button
              key={w.href}
              type="button"
              className={idx === center ? 'lc-dot active' : 'lc-dot'}
              aria-label={`Show ${w.label}`}
              aria-pressed={idx === center}
              onClick={() => goTo(idx)}
            />
          ))}
          <button
            type="button"
            className="lc-arrow"
            aria-label="Next workspace"
            onClick={() => goTo(center + 1)}
          >
            ›
          </button>
        </div>
      )}

      <p className="ws-footnote">
        Plus deeper workspaces for Commodities and Critical Minerals — visible in the Intelligence Center
        navigation when you sign in.
      </p>
    </section>
  );
}
