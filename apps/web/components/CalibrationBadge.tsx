'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

/**
 * Persistent Calibration trust badge — lives in the TopNav left zone,
 * after the Live pill, stacked label-over-metric so it pairs with the
 * ConvergenceBadge beside it. Reads /api/intel/calibration/summary and
 * renders the resolved-count. Click → the public /calibration page
 * (Pro+ users still reach the workspace via the existing Intel tab).
 *
 * The aggregate Brier is deliberately NOT shown here (2026-06-11
 * decision): it is jargon in the nav and is duplicated one glance away
 * in the Calibration Ledger strip and the /calibration page. The chip
 * keeps "N resolved" — a monotonically growing track-record number —
 * while the Brier remains the warm/warming-up detector internally.
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
      className="hidden lg:inline-flex"
      aria-label="View Calibration Ledger"
      style={{
        fontFamily: 'var(--f-mono)',
        textDecoration: 'none',
        flexDirection: 'column',
        gap: 3,
        lineHeight: 1,
      }}
    >
      <span
        style={{
          fontSize: 10.5,
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          color: 'var(--ink-dim)',
        }}
      >
        Calibration
      </span>
      <span style={{ fontSize: 11.5, color: 'var(--ink)', letterSpacing: 'normal' }}>
        {state.brier == null
          ? 'warming up'
          : `${state.resolved ?? '—'} resolved`}{' '}
        <span style={{ color: 'var(--teal)' }} aria-hidden="true">
          →
        </span>
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
