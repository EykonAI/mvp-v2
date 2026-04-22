import { PostHog } from 'posthog-node';
import type { EventProps } from './events';

// Server-side PostHog client. Used for capture from route handlers (payment
// webhooks, /api/chat rate-limit branch, etc.) where a Next.js server
// component can't reach the browser client. Also used for identify() on
// /auth/callback so signup attribution survives even if the browser never
// loaded posthog-js (e.g. the user signed up via a magic link in a new
// private-mode window).

let client: PostHog | null = null;

function getClient(): PostHog | null {
  if (client) return client;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  if (!key || !host) return null;
  client = new PostHog(key, {
    host,
    // posthog-node batches events in memory and ships them periodically.
    // Railway functions are short-lived per request; flushing sync-ish keeps
    // latency low and prevents event loss on cold starts.
    flushAt: 1,
    flushInterval: 0,
  });
  return client;
}

export async function captureServer<E extends EventProps>(
  distinctId: string,
  event: E,
): Promise<void> {
  const c = getClient();
  if (!c) return;
  const { event: name, ...props } = event as { event: string } & Record<string, unknown>;
  c.capture({
    distinctId,
    event: name,
    properties: props,
  });
  // Fire-and-forget flush so the event ships before the function returns.
  await c.flush().catch((err) => {
    console.warn('[posthog:server] flush failed', err);
  });
}

export async function identifyServer(
  distinctId: string,
  traits: Record<string, unknown>,
): Promise<void> {
  const c = getClient();
  if (!c) return;
  c.identify({ distinctId, properties: traits });
  await c.flush().catch(() => undefined);
}
