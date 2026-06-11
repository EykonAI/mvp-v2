'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import seed from '@/lib/fixtures/posture_seed.json';

/**
 * Persistent Convergence badge — TopNav left zone, beside the
 * CalibrationBadge and sharing its stacked label-over-metric layout.
 * The pairing is the value proposition in two chips: Calibration =
 * "we grade ourselves", Convergence = "independent feeds agree".
 *
 * Shows the LATEST convergence event (theatre name + age), never a
 * count: convergences are rare by design, so "0 today" would read as a
 * dead feature while "Taiwan Strait · 18h" stays compelling all week.
 * Cold start (no event ever recorded) → "watching N theatres".
 *
 * Same behaviour rules as CalibrationBadge: fetch on mount + 5-min
 * poll (compute-convergences runs every 15 min — faster polling is
 * waste), render nothing on fetch error (TopNav must never break),
 * responsive-collapse below lg. Click → /intel (Convergence Feed).
 */

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const HREF = '/intel';

interface ConvergenceRow {
  location: string | null;
  created_at: string;
}

interface Payload {
  events: ConvergenceRow[];
}

type BadgeState =
  | { kind: 'event'; place: string; age: string }
  | { kind: 'cold' };

export default function ConvergenceBadge() {
  const [state, setState] = useState<BadgeState | 'error' | 'loading'>('loading');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch('/api/intel/convergences?latest=1', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as Payload;
        if (cancelled) return;
        const latest = Array.isArray(body.events) ? body.events[0] : undefined;
        if (!latest) {
          setState({ kind: 'cold' });
          return;
        }
        setState({
          kind: 'event',
          place: theatreLabelFor(latest.location) ?? latest.location ?? '—',
          age: timeAgo(latest.created_at),
        });
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
      aria-label="View Convergence Feed"
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
        Convergence
      </span>
      <span style={{ fontSize: 11.5, color: 'var(--ink)', letterSpacing: 'normal' }}>
        {state.kind === 'event'
          ? `${state.place} · ${state.age}`
          : `watching ${seed.theatres.length} theatres`}{' '}
        <span style={{ color: 'var(--violet)' }} aria-hidden="true">
          →
        </span>
      </span>
    </Link>
  );
}

/**
 * convergence_events.location is the 5°×5° cell centre, e.g.
 * "(22.5, 117.5)" — unreadable in the nav. Map it to a posture-seed
 * theatre label when the point falls inside a theatre bbox (the
 * detectors that feed convergence are theatre-scoped, so most real
 * events will match); fall back to the raw string otherwise.
 */
function theatreLabelFor(location: string | null): string | null {
  const m = /\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?/.exec(location ?? '');
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lon = parseFloat(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  for (const t of seed.theatres) {
    const b = t.bbox as
      | { lat_min: number; lat_max: number; lon_min: number; lon_max: number }
      | undefined;
    if (!b) continue;
    if (lat >= b.lat_min && lat <= b.lat_max && lon >= b.lon_min && lon <= b.lon_max) {
      return (t as { label?: string }).label ?? t.slug;
    }
  }
  return null;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return 'now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hoursAgo = Math.floor(minutes / 60);
  if (hoursAgo < 48) return `${hoursAgo}h`;
  return `${Math.floor(hoursAgo / 24)}d`;
}
