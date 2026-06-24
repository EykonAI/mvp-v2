import * as Sentry from '@sentry/nextjs';

// Browser (client) Sentry init. Uses the public DSN so it is exposed to the
// client bundle; build/runtime are safe when it is absent.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  // Performance tracing: full in dev, light in prod to control event volume/cost.
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
  // Session Replay intentionally omitted (privacy / DPA decision).
  sendDefaultPii: false,
});
