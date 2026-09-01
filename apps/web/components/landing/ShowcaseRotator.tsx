'use client';

// SHOWCASE ROTATOR — screenshot and text sharing one fixed slot (LP v2, PR-D).
//
// Used twice: the six platform pillars and the eight Intelligence Center
// worksheets. Both previously rendered as static text grids, which is why the
// page shipped with no product imagery at all — a geospatial intelligence
// platform whose homepage showed the visitor nothing.
//
// Chassis is the pricing carousel's for the third time (pricing → use cases →
// here). Same state shape, same pos-* classes, same fallbacks. The difference
// is that this one moves an image and its copy together, so the slot is one
// piece of real estate rather than a list.
//
// Behaviour that is not negotiable:
//   - Fixed stage height. Slides of different length must not make the page
//     jump as they swap.
//   - Auto-advance pauses on hover AND on focus, and does not run at all under
//     prefers-reduced-motion. A section that cycles away mid-sentence is worse
//     than one that sits still.
//   - SSR / no-JS / reduced-motion / narrow viewport all render the static
//     stacked list. Every slide's text is in the DOM either way, so nothing is
//     reachable only by waiting.
//   - Images carry width/height so the frame reserves its space before they
//     load, and lazy-load below the fold.

import { useCallback, useEffect, useState } from 'react';

export type Slide = {
  /** e.g. "P-01 · GLOBE" */
  code: string;
  title: string;
  body: string;
  /** Path under /public. Null renders the labelled empty frame rather than a broken image. */
  shot: string | null;
  /** Alt text. Describes what the screenshot shows, not "screenshot of X". */
  alt: string;
  /** Optional honesty marker, e.g. an illustrative-model workspace. */
  flag?: string;
};

const SHOT_W = 1100;
const SHOT_H = 687;

export function ShowcaseRotator({
  slides,
  intervalMs = 7000,
  idPrefix,
  label,
}: {
  slides: Slide[];
  intervalMs?: number;
  idPrefix: string;
  label: string;
}) {
  const [center, setCenter] = useState(0);
  const [rotating, setRotating] = useState(false);
  const [auto, setAuto] = useState(true);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || window.innerWidth <= 900) return;
    setRotating(true);
  }, []);

  useEffect(() => {
    if (!rotating || !auto || paused) return;
    const t = setInterval(() => setCenter(c => (c + 1) % slides.length), intervalMs);
    return () => clearInterval(t);
  }, [rotating, auto, paused, intervalMs, slides.length]);

  const goTo = useCallback(
    (idx: number) => {
      setAuto(false);
      setCenter((idx + slides.length) % slides.length);
    },
    [slides.length],
  );

  return (
    <div
      className={rotating ? 'sr' : 'sr sr-static'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      aria-roledescription={rotating ? 'carousel' : undefined}
      aria-label={rotating ? label : undefined}
    >
      <div className="sr-stage">
        {slides.map((s, i) => (
          <div
            key={s.code}
            className={rotating ? (i === center ? 'sr-slide on' : 'sr-slide') : 'sr-slide on'}
            id={`${idPrefix}-slide-${i}`}
            role={rotating ? 'group' : undefined}
            aria-roledescription={rotating ? 'slide' : undefined}
            aria-label={rotating ? `${i + 1} of ${slides.length}: ${s.title}` : undefined}
            aria-hidden={rotating && i !== center ? true : undefined}
          >
            <div className="sr-media">
              {s.shot ? (
                <img
                  className="sr-shot"
                  src={s.shot}
                  alt={s.alt}
                  width={SHOT_W}
                  height={SHOT_H}
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <div className="sr-shot sr-shot-empty">
                  <span>{s.code}</span>
                </div>
              )}
            </div>
            <div className="sr-copy">
              <span className="sr-code">{s.code}</span>
              {s.flag && <span className="sr-flag">{s.flag}</span>}
              <h3 className="sr-title">{s.title}</h3>
              <p className="sr-body">{s.body}</p>
            </div>
          </div>
        ))}
      </div>

      {rotating && (
        <div className="sr-bar">
          <button type="button" className="sr-arw" aria-label={`Previous — ${label}`} onClick={() => goTo(center - 1)}>
            ‹
          </button>
          <span className="sr-dots">
            {slides.map((s, i) => (
              <button
                key={s.code}
                type="button"
                className={i === center ? 'on' : undefined}
                aria-label={`Show ${i + 1} of ${slides.length}: ${s.title}`}
                aria-current={i === center ? 'true' : undefined}
                onClick={() => goTo(i)}
              />
            ))}
          </span>
          <span className="sr-count">
            {center + 1} / {slides.length}
          </span>
          <button type="button" className="sr-arw" aria-label={`Next — ${label}`} onClick={() => goTo(center + 1)}>
            ›
          </button>
        </div>
      )}
    </div>
  );
}
