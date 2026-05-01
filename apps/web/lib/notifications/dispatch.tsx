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

// Per-channel dispatcher. PR 6 wires the email path; SMS and
// WhatsApp adapters arrive in PR 9 and PR 10. The shape returned
// here is what the cron writes into user_notification_log.delivery_status,
// keyed by channel id.

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
      // PR 9 lights this path up. Until then we record a suppression
      // so the user can see in the log that the SMS leg didn't go.
      return {
        ok: false,
        error: 'sms_adapter_not_implemented',
        suppressed_reason: 'sms_adapter_pending_pr9',
      };
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
