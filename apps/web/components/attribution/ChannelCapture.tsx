'use client';

import { useEffect } from 'react';
import { parseChannelTouch } from '@/lib/attribution/channels';

/**
 * PAMS — anonymous channel-touch capture (decision D3, full-funnel).
 * Mounted once in the root layout. On mount it inspects the current URL;
 * if it carries a recognised campaign tag (utm_source / ?ch) this is a
 * tagged landing, so it fires a single fire-and-forget POST to
 * /api/attribution/channel to record one channel_touchpoints row.
 *
 * The eykon_channel cookie that resolves the user-level first-touch at
 * signup is set independently by the middleware — this component is only
 * the top-of-funnel touch stream and is a strict no-op on any page that
 * does not carry a campaign tag.
 *
 * Renders nothing. Idempotent within a session via sessionStorage — a
 * soft refresh of a tagged URL does not log a duplicate touch.
 */
export function ChannelCapture() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    const touch = parseChannelTouch(params);
    if (!touch) return; // not a tagged landing — no-op

    const dedupeKey = `eykon_ch_${touch.channel}_${touch.utm.campaign ?? ''}`;
    if (window.sessionStorage.getItem(dedupeKey)) return;
    window.sessionStorage.setItem(dedupeKey, '1');

    // Host of the referrer only (never the full URL — PII). Same-origin
    // referrers (internal navigation) are dropped as not meaningful.
    let referrerHost: string | undefined;
    if (document.referrer) {
      try {
        const host = new URL(document.referrer).host;
        if (host && host !== window.location.host) referrerHost = host;
      } catch {
        // Malformed referrer — ignore.
      }
    }

    fetch('/api/attribution/channel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        utm_source: touch.utm.source ?? touch.channel,
        utm_medium: touch.utm.medium ?? undefined,
        utm_campaign: touch.utm.campaign ?? undefined,
        utm_content: touch.utm.content ?? undefined,
        utm_term: touch.utm.term ?? undefined,
        landing_path: window.location.pathname,
        referrer_host: referrerHost,
      }),
      keepalive: true,
    }).catch(() => {
      // Silent — attribution must never disrupt the page.
    });
  }, []);

  return null;
}
