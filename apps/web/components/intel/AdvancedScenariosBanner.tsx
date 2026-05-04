'use client';
import { useEffect, useState } from 'react';

// Framing copy for the four Advanced Scenarios workspaces (Chokepoint
// Simulator, Sanctions Wargame, Cascade Propagation, Precursor Analogs).
//
// Verbatim per the engineering execution prompt §6.1 — do not edit,
// soften, or expand without product sign-off. Same string is mirrored
// on the public landing page's Advanced Scenarios brief mention.

export const ADVANCED_BANNER_COPY =
  "Advanced Scenarios are designed for institutional analysis — sanctions cascades, chokepoint stress tests, multi-domain pattern matching. They’re available to all paid users; dedicated institutional support is part of our Enterprise tier.";

const INLINE_DISMISSED_KEY = 'eykon.advanced_banner_dismissed';

interface BannerProps {
  isInline?: boolean;
}

/**
 * Two layouts of the same component:
 *   • prominent (default) — full-width card at the top of /intel/advanced.
 *     Teal accent on the left edge, generous padding, no CTA. This
 *     instance owns the strongest framing surface for the four
 *     advanced workspaces.
 *   • inline (isInline=true) — single-line strip rendered at the top
 *     of each individual advanced workspace page. Dismissable per
 *     session via a small × that writes a sessionStorage key —
 *     does not persist across sessions, which is intentional (next
 *     visit re-asserts the framing).
 */
export function AdvancedScenariosBanner({ isInline = false }: BannerProps) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isInline) return;
    if (typeof window === 'undefined') return;
    if (window.sessionStorage.getItem(INLINE_DISMISSED_KEY) === 'true') {
      setDismissed(true);
    }
  }, [isInline]);

  if (isInline && dismissed) return null;

  if (isInline) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '8px 16px',
          background: 'rgba(25, 208, 184, 0.06)',
          borderBottom: '1px solid var(--teal-deep)',
          color: 'var(--ink-dim)',
          fontSize: 12,
          lineHeight: 1.5,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 9.5,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--teal)',
            flexShrink: 0,
          }}
        >
          Advanced Scenarios
        </span>
        <span style={{ flex: 1 }}>{ADVANCED_BANNER_COPY}</span>
        <button
          type="button"
          onClick={() => {
            if (typeof window !== 'undefined') {
              window.sessionStorage.setItem(INLINE_DISMISSED_KEY, 'true');
            }
            setDismissed(true);
          }}
          aria-label="Dismiss banner for this session"
          style={{
            flexShrink: 0,
            background: 'transparent',
            border: 'none',
            color: 'var(--ink-faint)',
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
            padding: 4,
          }}
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'relative',
        background: 'var(--bg-panel)',
        border: '1px solid var(--rule)',
        borderLeft: '3px solid var(--teal)',
        borderRadius: 6,
        padding: '20px 24px',
        marginBottom: 24,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10.5,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color: 'var(--teal)',
          marginBottom: 8,
        }}
      >
        Advanced Scenarios
      </div>
      <p
        style={{
          color: 'var(--ink)',
          fontSize: 14,
          lineHeight: 1.55,
          margin: 0,
          maxWidth: 820,
        }}
      >
        {ADVANCED_BANNER_COPY}
      </p>
    </div>
  );
}
