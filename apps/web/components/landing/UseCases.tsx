'use client';

// USE CASES — three worked examples from the live platform (LP v2, PR-B).
//
// Placed after the six pillars and before the analyst section: capabilities
// first, then what they are for. The section converts a capability list into
// jobs, which is the specificity the value proposition otherwise lacks.
//
// Chassis is the pricing carousel's, deliberately — same overlap, same centre
// zoom, same reduced-motion and narrow-viewport behaviour. A second visual
// language for the same idea would just be drift.
//
// Every figure here is measured. Two rules that are not style choices:
//   - Missing observations render as gaps, never zero and never interpolated.
//     The Kuwait chart shows this with hollow markers and a "no clear look"
//     label on the two nights the sensor had no confident view.
//   - No Hormuz figure exists anywhere in this file. There has been no
//     observation since 2026-05-28, so UC-01 states the gap instead of hiding
//     it. Critical Minerals is fixture-backed and likewise absent.
//
// Each card carries the four-part provenance rule — chip, wordmark, source
// feed, UTC stamp — because a card is the only artifact this platform emits
// that travels without its caveats.

import { useCallback, useEffect, useState } from 'react';

const ROTATE_MS = 9000;
const COUNT = 3;

type Persona = 'trader' | 'press';

export function UseCases() {
  // SSR / no-JS / reduced-motion / narrow viewport all render the static grid.
  // The carousel switches on after mount, desktop only — same rule the pricing
  // section uses, for the same reason.
  const [center, setCenter] = useState(1); // UC-02 Kuwait, the strongest artifact
  const [carousel, setCarousel] = useState(false);
  const [auto, setAuto] = useState(true);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || window.innerWidth <= 1100) return;
    setCarousel(true);
  }, []);

  useEffect(() => {
    if (!carousel || !auto || paused) return;
    const t = setInterval(() => setCenter(c => (c + 1) % COUNT), ROTATE_MS);
    return () => clearInterval(t);
  }, [carousel, auto, paused]);

  const goTo = useCallback((idx: number) => {
    setAuto(false);
    setCenter((idx + COUNT) % COUNT);
  }, []);

  function slotClass(idx: number): string {
    if (!carousel) return 'uc-slot';
    const offset = (idx - center + COUNT) % COUNT;
    const pos = offset === 0 ? 'pos-center' : offset === 1 ? 'pos-right' : 'pos-left';
    return `uc-slot ${pos}`;
  }

  // Clicking a side card centres it; links inside keep working on one click.
  function slotClick(idx: number, e: React.MouseEvent) {
    if (!carousel || idx === center) return;
    if ((e.target as HTMLElement).closest('a,button')) return;
    e.preventDefault();
    goTo(idx);
  }

  return (
    <section className="section" id="use-cases">
      <div className="section-head">
        <span className="eyebrow">·· Use cases ··</span>
        <h2>What people actually do with it.</h2>
        <p>
          Three worked examples from the live platform — the signal, the read, and what it
          was worth knowing before the news said it. Every figure below is measured, and
          every limit is stated.
        </p>
      </div>

      <div
        className={carousel ? 'uc-carousel' : 'uc-grid'}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={() => setPaused(false)}
      >
        <div className={slotClass(0)} onClick={e => slotClick(0, e)}>
          <UseCaseCard
            code="UC-01 · Corridor shift"
            persona="trader"
            title="A shipping lane changed behaviour, and the test said so"
            question="Has traffic through Malacca genuinely shifted, or is that our pipe?"
            figure={<MalaccaFigure />}
            chip="live"
            feed="AIS chokepoint coverage"
            stamp="2026-08-31 15:28 UTC"
            points={[
              <>AIS chokepoint coverage plus a <b>two-sample Kolmogorov–Smirnov test</b>, run nightly</>,
              <>Six theatres against five signals, at <b>p &lt; 0.01</b></>,
              <>Signals whose volume is set by our own ingest display, but <b>can never raise a flag</b></>,
            ]}
            limit="AIS here is thin and chokepoint-only. Hormuz is not covered at all, and the panel says so rather than showing a zero."
            gate="Pro"
            href="/intel/regime-shifts"
            cta="Open Regime Shifts"
          />
        </div>

        <div className={slotClass(1)} onClick={e => slotClick(1, e)}>
          <UseCaseCard
            code="UC-02 · Grid outage"
            persona="trader"
            flag="Founder-confirmed"
            title="A power plant went dark before anyone reported it"
            question="Is Kuwaiti generation actually down, or is this a rumour?"
            figure={<KuwaitFigure />}
            chip="live"
            feed="NASA Black Marble VNP46A2"
            stamp="2026-07-23 22:14 UTC"
            points={[
              <>Night-time radiance sampled nightly at <b>10,556 facilities</b></>,
              <>Three neighbouring sites collapsed together across <b>three consecutive confidently-clear nights</b></>,
              <>Az Zour North then showed a thermal elevation the next day — <b>heat up just after light down</b></>,
              <>Confirmed independently by the founder. No news input.</>,
            ]}
            limit="Radiance is not power state. Cloud, snow and moon geometry all hide light. This is an inference, and the reading says so."
            gate="Free on Observer"
            gateFree
            href="/app"
            cta="See the night-lights layer"
            primary
          />
        </div>

        <div className={slotClass(2)} onClick={e => slotClick(2, e)}>
          <UseCaseCard
            code="UC-03 · Dark vessel"
            persona="press"
            title="A ship went dark, and the network around it did not"
            question="Who is behind this vessel, and can I show it?"
            figure={<ActorGraphFigure />}
            chip="diagram"
            feed="OFAC SDN actor graph"
            stamp="Rebuilt weekly · Mon 03:00 UTC"
            points={[
              <>AIS <b>dark-gap detection</b> and flag-of-convenience scoring</>,
              <>An OFAC actor graph of <b>2,140 entities</b>, rebuilt weekly</>,
              <>Ranked leads, each <b>drillable to the evidence</b> that produced it — publishable, not just persuasive</>,
            ]}
            limit="A dark gap is a missing signal, not proof of intent. Attribution belongs in your prose, never in the score."
            gate="Pro"
            href="/intel/shadow-fleet"
            cta="Open Shadow Fleet"
          />
        </div>
      </div>

      {carousel && (
        <div className="uc-controls">
          <button type="button" className="uc-arw" aria-label="Previous use case" onClick={() => goTo(center - 1)}>‹</button>
          <span className="uc-dots">
            {[0, 1, 2].map(i => (
              <button
                key={i}
                type="button"
                className={i === center ? 'on' : undefined}
                aria-label={`Show use case ${i + 1} of ${COUNT}`}
                aria-current={i === center ? 'true' : undefined}
                onClick={() => goTo(i)}
              />
            ))}
          </span>
          <button type="button" className="uc-arw" aria-label="Next use case" onClick={() => goTo(center + 1)}>›</button>
        </div>
      )}
    </section>
  );
}

function UseCaseCard(props: {
  code: string;
  persona: Persona;
  flag?: string;
  title: string;
  question: string;
  figure: React.ReactNode;
  chip: 'live' | 'diagram';
  feed: string;
  stamp: string;
  points: React.ReactNode[];
  limit: string;
  gate: string;
  gateFree?: boolean;
  href: string;
  cta: string;
  primary?: boolean;
}) {
  return (
    <article className={props.primary ? 'uc-card highlight' : 'uc-card'}>
      {props.flag && <span className="uc-flag">{props.flag}</span>}
      <span className="uc-code">{props.code}</span>
      <span className={`uc-persona ${props.persona}`}>
        {props.persona === 'trader' ? 'Trader' : 'Investigative journalist'}
      </span>
      <h3 className="uc-title">{props.title}</h3>

      <div className="uc-figure">
        {props.figure}
        <div className="uc-prov">
          <span className={`uc-chip ${props.chip}`}>{props.chip === 'live' ? 'Live' : 'Diagram'}</span>
          <span className="uc-wm">eYKON</span>
          <span className="uc-sep">·</span>
          <span>{props.feed}</span>
          <span className="uc-sep">·</span>
          <span>{props.stamp}</span>
        </div>
      </div>

      <p className="uc-question">“{props.question}”</p>

      <span className="uc-sub">The instrument</span>
      <ul className="uc-points">
        {props.points.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ul>

      <div className="uc-limit">
        <span className="uc-limit-k">What this cannot tell you</span>
        <p>{props.limit}</p>
      </div>

      <div className="uc-foot">
        <a className={props.primary ? 'uc-btn primary' : 'uc-btn'} href={props.href}>
          {props.cta} →
        </a>
        <span className={props.gateFree ? 'uc-gate free' : 'uc-gate'}>{props.gate}</span>
      </div>
    </article>
  );
}

/* ── Figures ──────────────────────────────────────────────────────────
   Hand-authored inline SVG. No charting library: the CI budget ratchet
   only falls, and three static figures do not justify a runtime dependency
   on the marketing bundle. Each carries a <title> and <desc> so the figure
   is not silent to assistive technology — the a11y gate counts unnamed
   <svg> and its budget is zero.                                        */

function KuwaitFigure() {
  return (
    <svg viewBox="0 0 520 190" role="img" aria-labelledby="uc-kuwait-t uc-kuwait-d">
      <title id="uc-kuwait-t">Night-time radiance at three Kuwaiti facilities, 21–23 July 2026</title>
      <desc id="uc-kuwait-d">
        Az Zour South falls from a baseline near 97 to 4.7, Az Zour North from 46 to 3.4, and
        Mina Al Ahmadi from 104 to 16.7 with no clear look on the final two nights.
      </desc>
      <line x1="60" y1="150" x2="500" y2="150" stroke="#1f2e48" />
      <line x1="60" y1="83" x2="500" y2="83" stroke="#1f2e48" strokeDasharray="2 4" />
      <line x1="60" y1="16" x2="500" y2="16" stroke="#1f2e48" strokeDasharray="2 4" />
      <text x="52" y="154" fill="#3a4256" fontFamily="IBM Plex Mono, monospace" fontSize="9" textAnchor="end">0</text>
      <text x="52" y="87" fill="#3a4256" fontFamily="IBM Plex Mono, monospace" fontSize="9" textAnchor="end">55</text>
      <text x="52" y="20" fill="#3a4256" fontFamily="IBM Plex Mono, monospace" fontSize="9" textAnchor="end">110</text>

      {/* Mina Al Ahmadi — solid to the last confident look, then absent */}
      <polyline points="60,23.3 205,129.7" fill="none" stroke="#e8a84c" strokeWidth="2" />
      <polyline points="205,129.7 350,140 495,140" fill="none" stroke="#e8a84c" strokeWidth="1.4" strokeDasharray="3 5" opacity="0.42" />
      <circle cx="60" cy="23.3" r="3.2" fill="#e8a84c" />
      <circle cx="205" cy="129.7" r="3.2" fill="#e8a84c" />
      <circle cx="350" cy="140" r="3.4" fill="none" stroke="#e8a84c" strokeWidth="1.3" opacity="0.55" />
      <circle cx="495" cy="140" r="3.4" fill="none" stroke="#e8a84c" strokeWidth="1.3" opacity="0.55" />

      <polyline points="60,31.8 205,141.2 350,143.3 495,144.3" fill="none" stroke="#19d0b8" strokeWidth="2.2" />
      <circle cx="60" cy="31.8" r="3.2" fill="#19d0b8" />
      <circle cx="205" cy="141.2" r="3.2" fill="#19d0b8" />
      <circle cx="350" cy="143.3" r="3.2" fill="#19d0b8" />
      <circle cx="495" cy="144.3" r="3.6" fill="#19d0b8" />

      <polyline points="60,94 205,143.4 350,144.4 495,145.9" fill="none" stroke="#8b7fd8" strokeWidth="2.2" />
      <circle cx="60" cy="94" r="3.2" fill="#8b7fd8" />
      <circle cx="205" cy="143.4" r="3.2" fill="#8b7fd8" />
      <circle cx="350" cy="144.4" r="3.2" fill="#8b7fd8" />
      <circle cx="495" cy="145.9" r="3.6" fill="#8b7fd8" />

      <text x="66" y="18" fill="#e8a84c" fontFamily="IBM Plex Mono, monospace" fontSize="9.5">MINA AL AHMADI</text>
      <text x="66" y="44" fill="#19d0b8" fontFamily="IBM Plex Mono, monospace" fontSize="9.5">AZ ZOUR SOUTH</text>
      <text x="66" y="106" fill="#8b7fd8" fontFamily="IBM Plex Mono, monospace" fontSize="9.5">AZ ZOUR NORTH</text>
      <text x="332" y="133" fill="#8791a4" fontFamily="IBM Plex Mono, monospace" fontSize="8.5">no clear look</text>

      <text x="60" y="169" fill="#8791a4" fontFamily="IBM Plex Mono, monospace" fontSize="9" textAnchor="middle">BASELINE</text>
      <text x="205" y="169" fill="#8791a4" fontFamily="IBM Plex Mono, monospace" fontSize="9" textAnchor="middle">21 JUL</text>
      <text x="350" y="169" fill="#8791a4" fontFamily="IBM Plex Mono, monospace" fontSize="9" textAnchor="middle">22 JUL</text>
      <text x="495" y="169" fill="#8791a4" fontFamily="IBM Plex Mono, monospace" fontSize="9" textAnchor="middle">23 JUL</text>
      <text x="60" y="185" fill="#3a4256" fontFamily="IBM Plex Mono, monospace" fontSize="8">nW·cm⁻²·sr⁻¹</text>
    </svg>
  );
}

function MalaccaFigure() {
  return (
    <svg viewBox="0 0 520 190" role="img" aria-labelledby="uc-mal-t uc-mal-d">
      <title id="uc-mal-t">Vessel coverage at the Strait of Malacca</title>
      <desc id="uc-mal-d">
        891 vessels observed on 31 August 2026 over a 24-hour window on the free
        chokepoint-only AIS tier. Hormuz is not covered.
      </desc>
      <text x="30" y="34" fill="#8791a4" fontFamily="IBM Plex Mono, monospace" fontSize="10" letterSpacing="1.4">STRAIT OF MALACCA</text>
      <text x="30" y="96" fill="#19d0b8" fontFamily="Jura, sans-serif" fontSize="58" fontWeight="600">891</text>
      <text x="146" y="96" fill="#8791a4" fontFamily="IBM Plex Mono, monospace" fontSize="11">vessels</text>
      <text x="30" y="120" fill="#8791a4" fontFamily="IBM Plex Mono, monospace" fontSize="9.5">24-HOUR WINDOW · 31 AUG 2026</text>
      <line x1="30" y1="138" x2="490" y2="138" stroke="#1f2e48" />
      <text x="30" y="158" fill="#4abf8a" fontFamily="IBM Plex Mono, monospace" fontSize="9">● MALACCA · SUEZ · BOSPHORUS — covered</text>
      <text x="30" y="175" fill="#8791a4" fontFamily="IBM Plex Mono, monospace" fontSize="9">○ HORMUZ — no observation since 28 May 2026</text>
    </svg>
  );
}

function ActorGraphFigure() {
  return (
    <svg viewBox="0 0 520 190" role="img" aria-labelledby="uc-graph-t uc-graph-d">
      <title id="uc-graph-t">How a dark vessel resolves into a named network</title>
      <desc id="uc-graph-d">
        A vessel with an AIS gap links to its registered owner, flag registry, a sister
        vessel and a port call, and the owner links to a designated entity in the OFAC graph.
      </desc>
      <line x1="150" y1="95" x2="60" y2="42" stroke="#2a3f5f" strokeWidth="1.2" />
      <line x1="150" y1="95" x2="60" y2="150" stroke="#2a3f5f" strokeWidth="1.2" />
      <line x1="150" y1="95" x2="300" y2="52" stroke="#2a3f5f" strokeWidth="1.2" />
      <line x1="300" y1="52" x2="428" y2="92" stroke="#de7f70" strokeWidth="1.6" />
      <line x1="150" y1="95" x2="300" y2="146" stroke="#2a3f5f" strokeWidth="1.2" />

      <circle cx="150" cy="95" r="12" fill="#05080f" stroke="#19d0b8" strokeWidth="2" />
      <circle cx="150" cy="95" r="4.5" fill="#19d0b8" />
      <text x="150" y="122" fill="#19d0b8" fontFamily="IBM Plex Mono, monospace" fontSize="9" textAnchor="middle">DARK VESSEL</text>

      <circle cx="60" cy="42" r="6.5" fill="#152138" stroke="#2a3f5f" strokeWidth="1.2" />
      <text x="60" y="28" fill="#8791a4" fontFamily="IBM Plex Mono, monospace" fontSize="8.5" textAnchor="middle">FLAG REGISTRY</text>

      <circle cx="60" cy="150" r="6.5" fill="#152138" stroke="#2a3f5f" strokeWidth="1.2" />
      <text x="60" y="169" fill="#8791a4" fontFamily="IBM Plex Mono, monospace" fontSize="8.5" textAnchor="middle">SISTER VESSEL</text>

      <circle cx="300" cy="52" r="6.5" fill="#152138" stroke="#2a3f5f" strokeWidth="1.2" />
      <text x="300" y="38" fill="#8791a4" fontFamily="IBM Plex Mono, monospace" fontSize="8.5" textAnchor="middle">REGISTERED OWNER</text>

      <circle cx="300" cy="146" r="6.5" fill="#152138" stroke="#2a3f5f" strokeWidth="1.2" />
      <text x="300" y="166" fill="#8791a4" fontFamily="IBM Plex Mono, monospace" fontSize="8.5" textAnchor="middle">PORT CALL</text>

      <circle cx="428" cy="92" r="10" fill="#05080f" stroke="#de7f70" strokeWidth="2" />
      <circle cx="428" cy="92" r="3.6" fill="#de7f70" />
      <text x="428" y="117" fill="#de7f70" fontFamily="IBM Plex Mono, monospace" fontSize="8.5" textAnchor="middle">DESIGNATED</text>
      <text x="428" y="128" fill="#de7f70" fontFamily="IBM Plex Mono, monospace" fontSize="8.5" textAnchor="middle">ENTITY</text>

      <text x="30" y="184" fill="#3a4256" fontFamily="IBM Plex Mono, monospace" fontSize="8">
        SCHEMATIC — MECHANISM, NOT A SCREENSHOT · 2,140 ENTITIES
      </text>
    </svg>
  );
}
