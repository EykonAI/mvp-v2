'use client';
import { useState } from 'react';
import { captureBrowser } from '@/lib/analytics/client';

/**
 * Renders the user's referral link with a one-click copy button. Fires a
 * `referral_clicked` PostHog event on copy / share actions so post-launch
 * we can see which surface is actually driving outbound shares.
 */
export function ReferralCard({
  referralCode,
  baseUrl,
}: {
  referralCode: string;
  baseUrl: string;
}) {
  const [copied, setCopied] = useState(false);
  const url = `${baseUrl.replace(/\/$/, '')}/?via=${referralCode}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      captureBrowser({ event: 'referral_clicked', target: 'link_copy' });
    } catch {
      // Clipboard API can be blocked (insecure origin, permissions).
      // Users can still select + copy manually.
    }
  }

  const tweetUrl = `https://twitter.com/intent/tweet?${new URLSearchParams({
    text:
      'If you trade off geopolitical signals, eYKON.ai is worth a look. Founding rate is locked for life and you get 25% off your first year via this link:',
    url,
  }).toString()}`;

  const mailto = `mailto:?subject=${encodeURIComponent(
    'eYKON.ai — intelligence signals for fast decisions',
  )}&body=${encodeURIComponent(
    `I've been using eYKON.ai — real-time geopolitical signals translated into trade-relevant cues. Built for day-traders, analysts, and journalists.\n\nYou get 25% off your first year via this link: ${url}\n\n— Sent from my eYKON referral.`,
  )}`;

  return (
    <section
      style={{
        background: 'var(--bg-panel)',
        border: '1px solid var(--rule)',
        borderRadius: 6,
        padding: '24px 28px',
        marginBottom: 24,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10.5,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--teal)',
          marginBottom: 10,
        }}
      >
        ·· Referral program ··
      </div>
      <h2
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: '-0.3px',
          color: 'var(--ink)',
          marginBottom: 8,
        }}
      >
        Your referral link
      </h2>
      <p
        style={{
          color: 'var(--ink-dim)',
          fontSize: 13,
          lineHeight: 1.6,
          marginBottom: 18,
        }}
      >
        When someone signs up through this link and upgrades to a paid tier,
        you earn <strong style={{ color: 'var(--ink)' }}>30% lifetime commission</strong> OR{' '}
        <strong style={{ color: 'var(--ink)' }}>2 months of your own subscription free</strong> —
        you choose per referral. Referred users get 25% off their first year.
      </p>

      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'stretch',
          flexWrap: 'wrap',
          marginBottom: 16,
        }}
      >
        <div
          style={{
            flex: 1,
            minWidth: 280,
            fontFamily: 'var(--f-mono)',
            fontSize: 13,
            background: 'var(--bg-void)',
            border: '1px solid var(--rule-strong)',
            borderRadius: 4,
            padding: '12px 14px',
            color: 'var(--ink)',
            wordBreak: 'break-all',
            userSelect: 'all',
          }}
        >
          {url}
        </div>
        <button
          type="button"
          onClick={copy}
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 12,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: copied ? 'var(--bg-void)' : 'var(--teal)',
            background: copied ? 'var(--teal)' : 'transparent',
            border: '1px solid var(--teal)',
            borderRadius: 4,
            padding: '11px 18px',
            cursor: 'pointer',
            fontWeight: 600,
            transition: 'background 0.15s, color 0.15s',
          }}
        >
          {copied ? 'Copied ✓' : 'Copy link'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12 }}>
        <a
          href={tweetUrl}
          target="_blank"
          rel="noreferrer"
          onClick={() => captureBrowser({ event: 'referral_clicked', target: 'share_twitter' })}
          style={{
            color: 'var(--ink-dim)',
            textDecoration: 'none',
            borderBottom: '1px dashed var(--rule-strong)',
            paddingBottom: 1,
          }}
        >
          Share on X →
        </a>
        <a
          href={mailto}
          onClick={() => captureBrowser({ event: 'referral_clicked', target: 'share_email' })}
          style={{
            color: 'var(--ink-dim)',
            textDecoration: 'none',
            borderBottom: '1px dashed var(--rule-strong)',
            paddingBottom: 1,
          }}
        >
          Share via email →
        </a>
      </div>
    </section>
  );
}
