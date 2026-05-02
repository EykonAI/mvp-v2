import { render } from '@react-email/render';
import {
  getResendClient,
  getFromAddress,
  shouldActuallySend,
} from '@/lib/email/client';
import {
  NotificationFired,
  type NotificationFiredProps,
} from '@/lib/email/templates/NotificationFired';
import { NotifCapWarning } from '@/lib/email/templates/NotifCapWarning';

// Per-channel dispatcher. Email and SMS paths are live; WhatsApp
// arrives in PR 10. The shape returned here is what the cron writes
// into user_notification_log.delivery_status, keyed by channel id.

export interface VerifiedChannel {
  id: string;
  channel_type: 'email' | 'sms' | 'whatsapp';
  handle: string;
  label: string | null;
  active: boolean;
}

export type DispatchOutcome =
  | { ok: true; provider_id?: string; provider: 'resend' | 'twilio' | 'dry_run' }
  | { ok: false; error: string; suppressed_reason?: string };

export type FirePayload = NotificationFiredProps;

export async function dispatchToChannel(
  channel: VerifiedChannel,
  payload: FirePayload,
): Promise<DispatchOutcome> {
  switch (channel.channel_type) {
    case 'email':
      return dispatchEmail(channel, payload);
    case 'sms':
      return dispatchSms(channel, payload);
    case 'whatsapp':
      // PR 10 lights this up after the legal-review gate.
      return {
        ok: false,
        error: 'whatsapp_adapter_not_implemented',
        suppressed_reason: 'whatsapp_adapter_pending_pr10',
      };
  }
}

async function dispatchEmail(
  channel: VerifiedChannel,
  payload: FirePayload,
): Promise<DispatchOutcome> {
  if (!shouldActuallySend()) {
    console.log(
      `[notif:fire:dry_run] email → ${channel.handle} · ${payload.ruleName}`,
    );
    return { ok: true, provider: 'dry_run' };
  }
  try {
    const html = await render(<NotificationFired {...payload} />);
    const subject = `[eYKON] ${payload.ruleName}`;
    const resend = getResendClient();
    const { data, error } = await resend.emails.send({
      from: getFromAddress(),
      to: channel.handle,
      subject,
      html,
    });
    if (error || !data?.id) {
      return { ok: false, error: error?.message ?? 'no message id returned' };
    }
    return { ok: true, provider: 'resend', provider_id: data.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown Resend error' };
  }
}

// ─── SMS (Twilio Programmable Messaging) ─────────────────────────

const SMS_BODY_MAX_CHARS = 320; // ~2 SMS segments

async function dispatchSms(
  channel: VerifiedChannel,
  payload: FirePayload,
): Promise<DispatchOutcome> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_SMS_FROM;
  if (!sid || !token || !from) {
    if (!shouldActuallySend()) {
      console.log(
        `[notif:fire:dry_run] sms → ${channel.handle} · ${payload.ruleName}`,
      );
      return { ok: true, provider: 'dry_run' };
    }
    return {
      ok: false,
      error: 'twilio_not_configured',
      suppressed_reason: 'twilio_env_missing',
    };
  }
  const body = composeSmsBody(payload);
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
    const params = new URLSearchParams({
      From: from,
      To: channel.handle,
      Body: body,
    });
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      return { ok: false, error: `Twilio ${r.status}: ${detail.slice(0, 200)}` };
    }
    const data = (await r.json().catch(() => null)) as { sid?: string } | null;
    return { ok: true, provider: 'twilio', provider_id: data?.sid };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown Twilio error' };
  }
}

function composeSmsBody(payload: FirePayload): string {
  const head = `[eYKON] ${payload.ruleName}`;
  const summary = payload.summary?.replace(/\s+/g, ' ').trim() ?? '';
  const link = 'https://eykon.ai/notif?filter=recent';
  // 4-char overhead for spacing + "…" if truncation occurs.
  const remaining = SMS_BODY_MAX_CHARS - head.length - link.length - 4;
  const summaryFit = summary.length > remaining ? `${summary.slice(0, Math.max(0, remaining - 1))}…` : summary;
  return `${head}. ${summaryFit} ${link}`.slice(0, SMS_BODY_MAX_CHARS);
}

// ─── Soft-warn email (cap at 80 %) ───────────────────────────────

/**
 * Send the once-per-month cap-approaching warning. Idempotency is
 * enforced by the caller via wasWarnedThisPeriod / markWarned in
 * lib/notifications/cap.ts.
 */
export async function sendCapWarningEmail(
  to: string,
  args: { tierLabel: string; count: number; cap: number; periodYm: string },
): Promise<DispatchOutcome> {
  if (!shouldActuallySend()) {
    console.log(
      `[notif:cap_warn:dry_run] email → ${to} · ${args.count}/${args.cap} for ${args.periodYm}`,
    );
    return { ok: true, provider: 'dry_run' };
  }
  try {
    const html = await render(<NotifCapWarning {...args} />);
    const subject = `eYKON · ${args.count}/${args.cap} SMS/WhatsApp this month`;
    const resend = getResendClient();
    const { data, error } = await resend.emails.send({
      from: getFromAddress(),
      to,
      subject,
      html,
    });
    if (error || !data?.id) {
      return { ok: false, error: error?.message ?? 'no message id returned' };
    }
    return { ok: true, provider: 'resend', provider_id: data.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown Resend error' };
  }
}
