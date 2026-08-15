'use client';

import { getPostHogBrowser } from './client';
import type { CampaignProps, EventProps } from './events';

/**
 * Campaign attribution capture — the scoped exception to the global
 * query-string rule.
 *
 * PostHogProvider deliberately strips the query string from page_viewed:
 * the product surface carries intent params (?plan=, ?next=) that must
 * not leak through URL strings. That decision is right for the app and
 * wrong for a campaign landing page, where the query string IS the data.
 * The resolution is scope, not reversal: the campaign surfaces (/c, /q,
 * /start) call these helpers to carry utm_* explicitly on their own
 * typed events, and everything else keeps stripping.
 *
 * First touch: the first campaign view also writes $set_once person
 * properties (first_utm_source, first_utm_campaign, first_landing_path,
 * first_referrer). $set_once never overwrites, so the first channel that
 * found a visitor keeps the credit even if they return through another —
 * and because the properties sit on the person, a visitor who comes back
 * DIRECT three days later and pays still attributes to the original
 * channel. Without this, a working channel looks dead and gets killed by
 * mistake (7 attribution events all-time against 14 published posts is
 * how this file came to exist).
 */

export function campaignPropsFromLocation(): CampaignProps {
  if (typeof window === 'undefined') {
    return {
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      utm_content: null,
      referrer: null,
      landing_path: '',
    };
  }
  const params = new URLSearchParams(window.location.search);
  const pick = (k: string): string | null => {
    const v = params.get(k);
    return v && v.trim() ? v.trim().slice(0, 200) : null;
  };

  // External referrers only — a same-host referrer is internal navigation,
  // not an acquisition channel.
  let referrer: string | null = null;
  try {
    if (document.referrer) {
      const r = new URL(document.referrer);
      if (r.host !== window.location.host) referrer = r.origin + r.pathname;
    }
  } catch {
    referrer = null;
  }

  return {
    utm_source: pick('utm_source'),
    utm_medium: pick('utm_medium'),
    utm_campaign: pick('utm_campaign'),
    utm_content: pick('utm_content'),
    referrer,
    landing_path: window.location.pathname,
  };
}

/**
 * Typed capture that also writes first-touch person properties. Same
 * event taxonomy as captureBrowser — this variant exists because
 * $set_once must ride on a real event to reach the person profile.
 */
export function captureWithFirstTouch<E extends EventProps>(e: E): void {
  const client = getPostHogBrowser();
  if (!client) return;
  const { event, ...props } = e as { event: string } & Record<string, unknown>;
  const c = campaignPropsFromLocation();
  const firstTouch: Record<string, string> = {};
  if (c.utm_source) firstTouch.first_utm_source = c.utm_source;
  if (c.utm_medium) firstTouch.first_utm_medium = c.utm_medium;
  if (c.utm_campaign) firstTouch.first_utm_campaign = c.utm_campaign;
  if (c.utm_content) firstTouch.first_utm_content = c.utm_content;
  if (c.referrer) firstTouch.first_referrer = c.referrer;
  if (c.landing_path) firstTouch.first_landing_path = c.landing_path;

  client.capture(event, {
    ...props,
    ...(Object.keys(firstTouch).length > 0 ? { $set_once: firstTouch } : {}),
  });
}
