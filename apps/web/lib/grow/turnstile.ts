/**
 * Cloudflare Turnstile verification helper for the /grow inbound
 * submission form. Spec §3.3 calls for a Turnstile or hCaptcha
 * challenge. Turnstile is the lighter integration (no script
 * licensing, generous free tier, lighter UX).
 *
 * If TURNSTILE_SECRET_KEY is unset, verifyTurnstileToken() returns
 * { ok: true, dev_skip: true } — the form remains unprotected in
 * dev. Production must set both TURNSTILE_SITE_KEY (public) and
 * TURNSTILE_SECRET_KEY (server) before merging the launch.
 */

export type TurnstileResult =
  | { ok: true; dev_skip?: boolean }
  | { ok: false; reason: string };

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstileToken(
  token: string | null | undefined,
  remoteIp: string | null,
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // Dev / preview fallback. Production deployment must set the
    // secret; the launch checklist item is unmet otherwise.
    return { ok: true, dev_skip: true };
  }
  if (!token) {
    return { ok: false, reason: 'missing_token' };
  }

  const form = new URLSearchParams();
  form.append('secret', secret);
  form.append('response', token);
  if (remoteIp) form.append('remoteip', remoteIp);

  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      body: form,
      cache: 'no-store',
    });
    if (!res.ok) {
      return { ok: false, reason: `verify_http_${res.status}` };
    }
    const body = (await res.json()) as { success?: boolean; ['error-codes']?: string[] };
    if (!body.success) {
      const code = body['error-codes']?.[0] ?? 'unknown';
      return { ok: false, reason: `verify_${code}` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? `verify_${err.message.slice(0, 40)}` : 'verify_throw',
    };
  }
}
