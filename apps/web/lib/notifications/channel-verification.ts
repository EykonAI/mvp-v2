// Shared helpers for the channel-verification flow.
//
// Verification mechanics:
//   • 6-digit numeric code (cryptographically random — 1 / 1,000,000
//     guess rate, expiring after 10 minutes).
//   • Code stored as plaintext in user_channels.verification_code; OK
//     for a 10-minute throwaway. We clear it on success.
//   • Email codes are sent via Resend.
//   • SMS codes are sent via Twilio's REST API (raw fetch — the broader
//     SMS adapter and SDK arrive in PR 9; PR 4 only needs the
//     verification path).
//   • WhatsApp is deferred to PR 10 (Twilio-enforced opt-in template).

import crypto from 'crypto';

import { getResendClient, getFromAddress, shouldActuallySend } from '@/lib/email/client';

export const VERIFICATION_TTL_MINUTES = 10;
const CODE_LENGTH = 6;

export type ChannelType = 'email' | 'sms' | 'whatsapp';

export function generateVerificationCode(): string {
  // crypto.randomInt is uniform across the range — much safer than
  // Math.random for anything that gates access.
  const n = crypto.randomInt(0, 10 ** CODE_LENGTH);
  return n.toString().padStart(CODE_LENGTH, '0');
}

export function verificationExpiresAt(): Date {
  return new Date(Date.now() + VERIFICATION_TTL_MINUTES * 60_000);
}

// ─── Senders ─────────────────────────────────────────────────────

export type VerificationSendResult =
  | { ok: true; provider: 'resend' | 'twilio' | 'dry_run' }
  | { ok: false; error: string };

export async function sendEmailVerificationCode(
  to: string,
  code: string,
): Promise<VerificationSendResult> {
  if (!shouldActuallySend()) {
    console.log(`[notif:verify:dry_run] email → ${to} · code ${code}`);
    return { ok: true, provider: 'dry_run' };
  }
  try {
    const resend = getResendClient();
    const html = renderEmailHtml(code);
    const { data, error } = await resend.emails.send({
      from: getFromAddress(),
      to,
      subject: 'Your eYKON notification channel code',
      html,
    });
    if (error || !data?.id) {
      return { ok: false, error: error?.message ?? 'no message id returned' };
    }
    return { ok: true, provider: 'resend' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown Resend error' };
  }
}

export async function sendSmsVerificationCode(
  to: string,
  code: string,
): Promise<VerificationSendResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_SMS_FROM;
  if (!sid || !token || !from) {
    if (!shouldActuallySend()) {
      console.log(`[notif:verify:dry_run] sms → ${to} · code ${code}`);
      return { ok: true, provider: 'dry_run' };
    }
    return { ok: false, error: 'TWILIO_* env vars not configured' };
  }
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
    const body = new URLSearchParams({
      From: from,
      To: to,
      Body: `eYKON: your verification code is ${code}. Expires in ${VERIFICATION_TTL_MINUTES} minutes.`,
    });
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      return { ok: false, error: `Twilio ${r.status}: ${detail.slice(0, 200)}` };
    }
    return { ok: true, provider: 'twilio' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown Twilio error' };
  }
}

/**
 * Send the verification code over WhatsApp via Twilio. Same wire shape
 * as the SMS path — the only difference is the `whatsapp:` prefix on
 * From and To, which Twilio uses to route through the WhatsApp Business
 * channel instead of SMS.
 *
 * Twilio enforces opt-in at the API layer:
 *   • Sandbox: the recipient must FIRST text "join <sandbox-code>" to
 *     the sandbox number (see TWILIO_WHATSAPP_FROM). Until they do,
 *     the API rejects the message with a 63007 / 21211-class error.
 *   • Production: only Meta-approved templates can be sent outside a
 *     24-h session window. v1 ships the opt-in copy verbatim from
 *     Twilio's recommended templates — see PR description for the
 *     exact body that legal must review.
 */
export async function sendWhatsAppVerificationCode(
  to: string,
  code: string,
): Promise<VerificationSendResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM; // e.g. "whatsapp:+14155238886"
  if (!sid || !token || !from) {
    if (!shouldActuallySend()) {
      console.log(`[notif:verify:dry_run] whatsapp → ${to} · code ${code}`);
      return { ok: true, provider: 'dry_run' };
    }
    return { ok: false, error: 'TWILIO_WHATSAPP_FROM not configured' };
  }
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
    // Twilio expects both From and To prefixed with `whatsapp:` for
    // the WhatsApp channel. We store the bare E.164 number on the row
    // and add the prefix here, so the channel handle stays portable.
    const whatsAppFrom = from.startsWith('whatsapp:') ? from : `whatsapp:${from}`;
    const whatsAppTo = `whatsapp:${to}`;
    const body = new URLSearchParams({
      From: whatsAppFrom,
      To: whatsAppTo,
      Body: `eYKON: your verification code is ${code}. Expires in ${VERIFICATION_TTL_MINUTES} minutes. Reply STOP to opt out.`,
    });
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      return { ok: false, error: `Twilio ${r.status}: ${detail.slice(0, 200)}` };
    }
    return { ok: true, provider: 'twilio' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown Twilio error' };
  }
}

// ─── Validators ──────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const E164_RE = /^\+[1-9]\d{6,14}$/;

export function isValidHandle(channelType: ChannelType, handle: string): boolean {
  const trimmed = handle.trim();
  if (channelType === 'email') return EMAIL_RE.test(trimmed);
  // SMS and WhatsApp both expect E.164. WhatsApp will additionally
  // require the Twilio opt-in flow; that lives in PR 10.
  return E164_RE.test(trimmed);
}

// ─── Email body ──────────────────────────────────────────────────

function renderEmailHtml(code: string): string {
  // Inline-styled because Resend renders into the recipient's inbox
  // and we don't want to ship an entire React Email template just for
  // a 6-digit code. The brand colours match var(--teal) / var(--ink).
  return `
<!DOCTYPE html>
<html>
  <body style="margin:0;padding:32px;background:#05080F;color:#E8EDF5;font-family:'IBM Plex Sans',sans-serif;">
    <div style="max-width:480px;margin:0 auto;padding:32px;background:#0F182A;border:1px solid #1E2C49;border-radius:6px;">
      <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#19D0B8;margin-bottom:20px;">
        eYKON · Notification channel
      </div>
      <h1 style="font-family:'Jura',sans-serif;font-size:22px;font-weight:500;margin:0 0 16px;color:#E8EDF5;">
        Your verification code
      </h1>
      <p style="margin:0 0 24px;color:#98A3B5;font-size:14px;line-height:1.5;">
        Enter this code on the eYKON Settings page to verify this channel.
        It expires in ${VERIFICATION_TTL_MINUTES} minutes.
      </p>
      <div style="font-family:'IBM Plex Mono',monospace;font-size:32px;letter-spacing:0.4em;color:#19D0B8;text-align:center;padding:20px;background:#0A1220;border:1px solid #1E2C49;border-radius:4px;">
        ${code}
      </div>
      <p style="margin:24px 0 0;color:#5A6478;font-size:12px;line-height:1.5;">
        Didn't request this? Ignore the email — the code expires automatically and no channel is added without verification.
      </p>
    </div>
  </body>
</html>
  `.trim();
}
