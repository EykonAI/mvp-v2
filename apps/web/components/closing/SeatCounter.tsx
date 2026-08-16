'use client';

import { useEffect, useRef, useState } from 'react';
import { captureBrowser } from '@/lib/analytics/client';

/**
 * Screen 6's live seat counter (brief v1.3 §4.6). Reads the same
 * GET /api/founding/spots the homepage uses — derived from the purchases
 * ledger, honestly computed, never hardcoded.
 *
 * While loading (or on error) it renders an em dash. A fabricated
 * fallback count on the one number this page tells readers to audit
 * would cost the entire "don't trust us, audit us" position.
 *
 * offer_viewed fires once when the counter scrolls into view, carrying
 * the number the visitor actually saw.
 */
export function SeatCounter() {
  const [spotsLeft, setSpotsLeft] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const viewed = useRef(false);
  const spotsRef = useRef<number | null>(null);
  spotsRef.current = spotsLeft;

  useEffect(() => {
    let cancelled = false;
    fetch('/api/founding/spots')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { spots_left?: number } | null) => {
        if (!cancelled && d && typeof d.spots_left === 'number') setSpotsLeft(d.spots_left);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !viewed.current) {
          viewed.current = true;
          captureBrowser({ event: 'offer_viewed', spots_left: spotsRef.current });
          obs.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const display = spotsLeft == null ? '—' : spotsLeft.toLocaleString('en-US');
  const pct = spotsLeft == null ? 0 : Math.max(2, Math.round(((1000 - spotsLeft) / 1000) * 100));

  return (
    <div className="cs-counter" ref={ref}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div className="cs-cnum">
          {display} <small>/ 1,000 seats remaining</small>
        </div>
        <div className="cs-mono" style={{ fontSize: 9.5, color: 'var(--ink-dim)', textAlign: 'right', lineHeight: 1.6 }}>
          LIVE — GET /api/founding/spots
          <br />
          first come, first served · no waitlist · never hardcoded
        </div>
      </div>
      <div className="cs-bar">
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="cs-mono" style={{ fontSize: 10.5, color: 'var(--ink-dim)' }}>
        Derived from the purchases ledger — audit it the same way you audit our forecasts.
      </div>
    </div>
  );
}
