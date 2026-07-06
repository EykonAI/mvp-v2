'use client';
import { useEffect, useState } from 'react';

// Generic rotating tile carousel for landing sections (landing update
// follow-up 2026-07-06): the same effect as the workspace showcase —
// centre card zoomed with the cyan glow, sides scaled/dimmed — applied
// to plain informational tiles (COMM reputation spine, COMM creator
// economy, BRIEFS surfaces). Tiles are not links: clicking a side tile
// centres it; the centre tile is inert.
//
// Progressive enhancement contract (same as the other carousels):
// SSR / no-JS / prefers-reduced-motion / <=900px render the static
// grid passed via `staticClass`. All tiles stay in the DOM.

export type Tile = { label: string; title: string; body: string };

const ROTATE_MS = 6000;

export function TileCarousel({
  items,
  staticClass,
  ariaLabel,
}: {
  items: Tile[];
  staticClass: string;
  ariaLabel: string;
}) {
  const [center, setCenter] = useState(0);
  const [carousel, setCarousel] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduced && window.innerWidth > 900) setCarousel(true);
  }, []);

  useEffect(() => {
    if (!carousel || !autoRotate || paused) return;
    const t = setInterval(() => setCenter(c => (c + 1) % items.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [carousel, autoRotate, paused, items.length]);

  // Deliberate interaction stops auto-rotation for good.
  function goTo(idx: number) {
    setAutoRotate(false);
    setCenter((idx + items.length) % items.length);
  }

  // 3 items → left/centre/right. 4 items → the extra card waits
  // off-stage behind the centre (same pattern as the pricing carousel).
  function slotClass(idx: number): string {
    if (!carousel) return 'tc-slot';
    const offset = (idx - center + items.length) % items.length;
    if (offset === 0) return 'tc-slot pos-center';
    if (offset === 1) return 'tc-slot pos-right';
    if (offset === items.length - 1) return 'tc-slot pos-left';
    return 'tc-slot pos-off';
  }

  return (
    <div
      aria-roledescription={carousel ? 'carousel' : undefined}
      aria-label={ariaLabel}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div className={carousel ? 'tile-carousel' : staticClass}>
        {items.map((t, idx) => (
          <div
            className={slotClass(idx)}
            key={t.label}
            onClick={() => {
              if (carousel && idx !== center) goTo(idx);
            }}
          >
            <div className="pillar">
              <div className="pillar-label">{t.label}</div>
              <div className="pillar-title">{t.title}</div>
              <p className="pillar-body">{t.body}</p>
            </div>
          </div>
        ))}
      </div>

      {carousel && (
        <div className="tc-controls">
          <button
            type="button"
            className="lc-arrow"
            aria-label="Previous"
            onClick={() => goTo(center - 1)}
          >
            ‹
          </button>
          {items.map((t, idx) => (
            <button
              key={t.label}
              type="button"
              className={idx === center ? 'lc-dot active' : 'lc-dot'}
              aria-label={`Show ${t.title}`}
              aria-pressed={idx === center}
              onClick={() => goTo(idx)}
            />
          ))}
          <button
            type="button"
            className="lc-arrow"
            aria-label="Next"
            onClick={() => goTo(center + 1)}
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
