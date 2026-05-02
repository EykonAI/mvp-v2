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
      return dispatchWhatsApp(channel, payload);
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

// ─── WhatsApp (Twilio WhatsApp Business API) ─────────────────────
//
// Twilio enforces opt-in at the API layer. Two modes:
//   • Sandbox  — recipient must first text "join <code>" to the
//                Twilio sandbox number. Free, dev-only.
//   • Business — Meta-approved templates required outside a 24-h
//                session window. Production-only.
//
// v1 ships the sandbox path with the body templates documented in
// the PR description. Legal-review is a launch-blocker per brief
// §10 — flip the WHATSAPP_LEGAL_REVIEW_PASSED flag below to true
// only after legal sign-off on the production templates.

// Mandatory STOP language for both v1 (sandbox) and v2 (production
// templates pending legal review). This is the only string we vary
// per fire — the rest of the body is the rule's summary.
const WHATSAPP_STOP_FOOTER = 'Reply STOP to opt out.';
// 1024 chars is WhatsApp's per-message ceiling; we cap conservatively
// to leave headroom for emoji, links, and the STOP footer.
const WHATSAPP_BODY_MAX_CHARS = 900;

async function dispatchWhatsApp(
  channel: VerifiedChannel,
  payload: FirePayload,
): Promise<DispatchOutcome> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!sid || !token || !from) {
    if (!shouldActuallySend()) {
      console.log(
        `[notif:fire:dry_run] whatsapp → ${channel.handle} · ${payload.ruleName}`,
      );
      return { ok: true, provider: 'dry_run' };
    }
    return {
      ok: false,
      error: 'twilio_whatsapp_not_configured',
      suppressed_reason: 'whatsapp_env_missing',
    };
  }
  const body = composeWhatsAppBody(payload);
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
    const whatsAppFrom = from.startsWith('whatsapp:') ? from : `whatsapp:${from}`;
    const whatsAppTo = `whatsapp:${channel.handle}`;
    const params = new URLSearchParams({
      From: whatsAppFrom,
      To: whatsAppTo,
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
      // Twilio surfaces 63007 (recipient not opted in) and 21211
      // (invalid To) here — same handling, recorded raw so the
      // operator can inspect.
      return { ok: false, error: `Twilio ${r.status}: ${detail.slice(0, 200)}` };
    }
    const data = (await r.json().catch(() => null)) as { sid?: string } | null;
    return { ok: true, provider: 'twilio', provider_id: data?.sid };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown Twilio error' };
  }
}

function composeWhatsAppBody(payload: FirePayload): string {
  // Heading + summary + recent-fires link + STOP footer. Same shape
  // as the SMS body but with the larger WhatsApp cap, so the summary
  // can carry more context.
  const head = `*[eYKON] ${payload.ruleName}*`;
  const summary = payload.summary?.replace(/\s+/g, ' ').trim() ?? '';
  const rationale = payload.rationale ? `\n_Why:_ ${payload.rationale}` : '';
  const link = '\nOpen: https://eykon.ai/notif?filter=recent';
  const footer = `\n\n${WHATSAPP_STOP_FOOTER}`;
  const fixed = head.length + rationale.length + link.length + footer.length + 2;
  const remaining = WHATSAPP_BODY_MAX_CHARS - fixed;
  const summaryFit =
    summary.length > remaining ? `${summary.slice(0, Math.max(0, remaining - 1))}…` : summary;
  return `${head}\n${summaryFit}${rationale}${link}${footer}`.slice(0, WHATSAPP_BODY_MAX_CHARS);
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
