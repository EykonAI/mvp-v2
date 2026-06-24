import * as Sentry from '@sentry/nextjs';

// Runs once per server/edge runtime on boot (Next.js instrumentation hook).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Captures errors thrown inside nested React Server Components.
// Active on Next.js 15+; a harmless no-op export on Next.js 14.
export const onRequestError = Sentry.captureRequestError;
