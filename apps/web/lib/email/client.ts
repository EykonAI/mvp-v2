import { Resend } from 'resend';

// Single Resend client instance. Created lazily so missing env vars at
// build-time (placeholder API key in .env.example) don't break the bundle.
let client: Resend | null = null;

export function getResendClient(): Resend {
  if (client) return client;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not set');
  }
  client = new Resend(apiKey);
  return client;
}

export function getFromAddress(): string {
  return (
    process.env.RESEND_FROM_EMAIL?.trim() || 'eYKON.ai <no-reply@eykon.ai>'
  );
}

/**
 * Controls whether sends actually hit Resend. Coupled to the Phase-2 auth
 * flag by default: when NEXT_PUBLIC_AUTH_ENABLED=false (dev / pre-activation),
 * emails are logged instead of sent so dev sessions don't spam the verified
 * domain. EMAIL_DRY_RUN=true forces log-only even in production (useful for
 * staging or when replaying notification_queue after a migration).
 */
export function shouldActuallySend(): boolean {
  if (process.env.EMAIL_DRY_RUN === 'true') return false;
  if (process.env.NEXT_PUBLIC_AUTH_ENABLED !== 'true') return false;
  return true;
}
