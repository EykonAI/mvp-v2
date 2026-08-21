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

/**
 * Start session replay for the CURRENT page only.
 *
 * Replay is disabled globally in init() and that stays true: the product
 * surfaces are an intelligence tool where analysts type queries that are
 * nobody's business but theirs, and a recording of /intel or /analyst is a
 * recording of what someone is investigating. The closing page is the one
 * place where the visitor is anonymous, the content is a public sales page,
 * and watching where people hesitate is the whole point.
 *
 * TWO KEYS ARE REQUIRED, on purpose:
 *   1. this call (scope — code decides WHICH pages may record), and
 *   2. "Record user sessions" enabled in the PostHog project settings
 *      (master switch — can be pulled without a deploy).
 * Neither alone records anything. If replay must be killed in a hurry, use
 * the dashboard: it takes effect immediately.
 *
 * Input masking from init() still applies — maskAllInputs plus an explicit
 * selector covering input/textarea/[data-ph-no-capture] — so the email and
 * free-text fields in the qualification form are redacted in the recording.
 */
export function startSessionReplayHere(): void {
  const client = getPostHogBrowser();
  if (!client) return;
  try {
    client.startSessionRecording();
  } catch {
    // Never let an analytics opt-in break the page it is measuring.
  }
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
