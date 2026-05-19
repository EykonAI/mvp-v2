'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

/**
 * Persistent Calibration trust badge — lives in the TopNav left zone,
 * after the Live pill. Reads /api/intel/calibration/summary and renders
 * the aggregate Brier + resolved-count as a status pill. Click → the
 * public /calibration page (Pro+ users still reach the workspace via
 * the existing Intel tab).
 *
 * Surfaces calibration as a credential rather than as a section: every
 * page render exposes the actual number, so trust accrues even for
 * users who never click through.
 *
 * Behaviour rules (from 2026-05-19 brief §5):
 *   • Fetch once on mount, then poll every 5 minutes. The Brier moves
 *     on the hour at most (score-predictions cron), faster polling is
 *     waste. Interval is cleared on unmount.
 *   • Warming-up state (no data or value === "—" or degraded=true):
 *     render "Calibration: warming up →".
 *   • Fetch error: return null. TopNav must never break because the
 *     summary endpoint hiccupped.
 *   • Below the lg breakpoint: render nothing (responsive collapse).
 *     Matches the Live pill at TopNav.tsx:101.
 */

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const HREF = '/calibration';

interface SummaryMetric {
  key: string;
  label: string;
  value: string;
}

interface SummaryResponse {
  metrics: SummaryMetric[];
  generated_at?: string;
  degraded?: boolean;
  resolved_count?: number;
}

interface BadgeState {
  brier: string | null;        // null = warming-up
  resolved: number | null;     // null = unknown (older endpoint)
}

const WARMING: BadgeState = { brier: null, resolved: null };

export default function CalibrationBadge() {
  const [state, setState] = useState<BadgeState | 'error' | 'loading'>('loading');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch('/api/intel/calibration/summary', {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as SummaryResponse;
        if (cancelled) return;
        setState(extractBadgeState(body));
      } catch {
        if (cancelled) return;
        setState('error');
      }
    }

    load();
    const id = window.setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (state === 'loading' || state === 'error') return null;

  return (
    <Link
      href={HREF}
      className="hidden lg:inline-flex items-center"
      aria-label="View Calibration Ledger"
      style={{
        fontFamily: 'var(--f-mono)',
        fontSize: 10.5,
        letterSpacing: '0.15em',
        textTransform: 'uppercase',
        color: 'var(--ink-dim)',
        textDecoration: 'none',
        gap: 8,
      }}
    >
      <span style={{ color: 'var(--ink-dim)' }}>Calibration</span>

      {state.brier == null ? (
        <span style={{ color: 'var(--ink-dim)', textTransform: 'none' }}>
          warming up
        </span>
      ) : (
        <>
          <span
            style={{
              color: 'var(--ink)',
              textTransform: 'none',
              letterSpacing: 'normal',
              fontSize: 11.5,
            }}
          >
            {state.brier} Brier
          </span>
          {state.resolved != null && state.resolved > 0 && (
            <>
              <span style={{ color: 'var(--ink-dim)' }}>·</span>
              <span
                style={{
                  color: 'var(--ink-dim)',
                  textTransform: 'none',
                  letterSpacing: 'normal',
                  fontSize: 11.5,
                }}
              >
                {state.resolved} resolved
              </span>
            </>
          )}
        </>
      )}

      <span style={{ color: 'var(--teal)' }} aria-hidden="true">
        →
      </span>
    </Link>
  );
}

function extractBadgeState(body: SummaryResponse): BadgeState {
  const brierMetric = Array.isArray(body.metrics)
    ? body.metrics.find((m) => m.key === 'brier')
    : null;
  const rawValue = brierMetric?.value ?? '—';
  const degraded = body.degraded === true;
  const isPlaceholder = !rawValue || rawValue === '—';

  if (degraded || isPlaceholder) return WARMING;

  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric)) return WARMING;

  return {
    brier: numeric.toFixed(2),
    resolved:
      typeof body.resolved_count === 'number' && body.resolved_count >= 0
        ? body.resolved_count
        : null,
  };
}
