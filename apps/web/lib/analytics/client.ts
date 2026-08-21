'use client';
import posthog, { type PostHog } from 'posthog-js';
import type { EventProps } from './events';

// Singleton browser client. Lazy-initialised because the key and host come
// from NEXT_PUBLIC_* env vars — when they're unset in dev we no-op instead
// of failing so the app stays useful before PostHog is provisioned.

let initialised = false;
let enabled = false;

export function initPostHogBrowser(): PostHog | null {
  if (typeof window === 'undefined') return null;
  if (initialised) return enabled ? posthog : null;
  initialised = true;

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  if (!key || !host) {
    console.info('[posthog] NEXT_PUBLIC_POSTHOG_KEY or _HOST not set — analytics disabled');
    return null;
  }

  posthog.init(key, {
    api_host: host,
    // We fire page_viewed ourselves on route changes (in PostHogProvider).
    // Disabling the default autocapture + pageview keeps our event volume
    // predictable and avoids double-counting on client nav.
    capture_pageview: false,
    capture_pageleave: true,
    autocapture: false,
    // Session replay is OFF for launch — defensible privacy posture for
    // an intelligence product. Can be re-enabled project-wide or per-page
    // post-launch after a privacy review.
    disable_session_recording: true,
    // Mask inputs as a belt even if someone re-enables recording from the
    // PostHog dashboard.
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: '[data-ph-no-capture], input, textarea',
    },
    persistence: 'localStorage+cookie',
    loaded: () => {
      enabled = true;
    },
  });

  enabled = true;
  return posthog;
}

export function getPostHogBrowser(): PostHog | null {
  if (!initialised) return initPostHogBrowser();
  return enabled ? posthog : null;
}

/**
 * Typed capture helper. Keeps event names + prop shape in sync via EventProps.
 */
export function captureBrowser<E extends EventProps>(e: E): void {
  const client = getPostHogBrowser();
  if (!client) return;
  const { event, ...props } = e as { event: string } & Record<string, unknown>;
  client.capture(event, props);
}

/**
 * The browser's current PostHog distinct_id, or null.
 *
 * Sent to server routes that capture events on this visitor's behalf, so
 * those events land on the SAME person as the browser-side ones. Without
 * it a server capture invents a second identity and every funnel spanning
 * the two reads 0% conversion forever — see the note in
 * /api/closing/lead.
 */
export function getBrowserDistinctId(): string | null {
  const client = getPostHogBrowser();
  if (!client) return null;
  try {
    return client.get_distinct_id() || null;
  } catch {
    return null;
  }
}

export function identifyBrowser(
  userId: string,
  traits: Record<string, unknown> = {},
): void {
  const client = getPostHogBrowser();
  if (!client) return;
  client.identify(userId, traits);
}

export function resetPostHogBrowser(): void {
  const client = getPostHogBrowser();
  if (!client) return;
  client.reset();
}
