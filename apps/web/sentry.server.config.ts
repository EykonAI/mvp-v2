import * as Sentry from '@sentry/nextjs';

// Server (Node.js runtime) Sentry init. DSN is read from the environment so the
// build is safe when it is absent — Sentry is simply disabled in that case.
const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  // Performance tracing: full in dev, light in prod to control event volume/cost.
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
  // Do not send IP / request headers — respects our Privacy/DPA posture.
  sendDefaultPii: false,
});
