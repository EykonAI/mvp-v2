import { render } from '@react-email/render';
import { createServerSupabase } from '@/lib/supabase-server';
import {
  getResendClient,
  getFromAddress,
  shouldActuallySend,
} from './client';
import {
  WaitlistConfirmation,
  type WaitlistConfirmationProps,
} from './templates/WaitlistConfirmation';
import {
  ReceiptCrypto,
  type ReceiptCryptoProps,
} from './templates/ReceiptCrypto';
import {
  CryptoRenewalReminder,
  type CryptoRenewalReminderProps,
} from './templates/CryptoRenewalReminder';
import {
  AdvocateInvitation,
  type AdvocateInvitationProps,
} from './templates/AdvocateInvitation';
import {
  AdvocateWelcome,
  type AdvocateWelcomeProps,
} from './templates/AdvocateWelcome';

type TemplateId =
  | 'waitlist_confirmation'
  | 'receipt_crypto'
  | 'crypto_renewal_reminder'
  | 'advocate_invitation'
  | 'advocate_welcome';

type SendResult =
  | { state: 'sent'; resendMessageId: string; logId: string }
  | { state: 'dry_run'; logId: string }
  | { state: 'error'; error: string };

type BaseSendInput = {
  to: string;
  userId?: string | null;
  notificationQueueId?: string | null;
};

async function writeLog(
  to: string,
  subject: string,
  template: TemplateId,
  context: Record<string, unknown>,
  userId: string | null | undefined,
  notificationQueueId: string | null | undefined,
  initialStatus: 'queued' | 'dry_run',
): Promise<string | null> {
  const admin = createServerSupabase();
  const { data, error } = await admin
    .from('email_log')
    .insert({
      user_id: userId ?? null,
      to_email: to,
      from_email: getFromAddress(),
      subject,
      template,
      context,
      status: initialStatus,
      notification_queue_id: notificationQueueId ?? null,
    })
    .select('id')
    .single();
  if (error || !data) {
    console.error('[email:log] insert failed', error?.message);
    return null;
  }
  return data.id;
}

async function markSent(
  logId: string,
  resendMessageId: string,
): Promise<void> {
  const admin = createServerSupabase();
  await admin
    .from('email_log')
    .update({
      status: 'sent',
      resend_message_id: resendMessageId,
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', logId);
}

async function markFailed(logId: string, error: string): Promise<void> {
  const admin = createServerSupabase();
  await admin
    .from('email_log')
    .update({
      status: 'failed',
      error_message: error.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq('id', logId);
}

async function deliver(
  to: string,
  subject: string,
  html: string,
  template: TemplateId,
  context: Record<string, unknown>,
  userId: string | null | undefined,
  notificationQueueId: string | null | undefined,
): Promise<SendResult> {
  const send = shouldActuallySend();
  const initialStatus: 'queued' | 'dry_run' = send ? 'queued' : 'dry_run';
  const logId = await writeLog(
    to,
    subject,
    template,
    context,
    userId,
    notificationQueueId,
    initialStatus,
  );

  if (!send) {
    console.log(`[email:dry_run] ${template} → ${to} · ${subject}`);
    return { state: 'dry_run', logId: logId ?? '' };
  }

  try {
    const resend = getResendClient();
    const { data, error } = await resend.emails.send({
      from: getFromAddress(),
      to,
      subject,
      html,
    });
    if (error || !data?.id) {
      const msg = error?.message ?? 'no message id returned';
      if (logId) await markFailed(logId, msg);
      return { state: 'error', error: msg };
    }
    if (logId) await markSent(logId, data.id);
    return { state: 'sent', resendMessageId: data.id, logId: logId ?? '' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown Resend error';
    if (logId) await markFailed(logId, msg);
    return { state: 'error', error: msg };
  }
}

// ─── Typed senders ─────────────────────────────────────────────────

export async function sendWaitlistConfirmation(
  input: BaseSendInput & WaitlistConfirmationProps,
): Promise<SendResult> {
  const html = await render(<WaitlistConfirmation {...input} />);
  const subject =
    input.tier === 'pro'
      ? 'You are on the eYKON Pro fiat waitlist'
      : 'You are on the eYKON Enterprise fiat waitlist';
  return deliver(
    input.to,
    subject,
    html,
    'waitlist_confirmation',
    { email: input.email, tier: input.tier, position: input.position ?? null },
    input.userId,
    input.notificationQueueId,
  );
}

export async function sendReceiptCrypto(
  input: BaseSendInput & ReceiptCryptoProps,
): Promise<SendResult> {
  const html = await render(<ReceiptCrypto {...input} />);
  const subject = `Payment confirmed — eYKON ${input.tierLabel}`;
  return deliver(
    input.to,
    subject,
    html,
    'receipt_crypto',
    {
      tierLabel: input.tierLabel,
      variantId: input.variantId,
      amountUsd: input.amountUsd,
      payCurrency: input.payCurrency,
      txHash: input.txHash ?? null,
      grantedFounding: input.grantedFounding,
    },
    input.userId,
    input.notificationQueueId,
  );
}

export async function sendCryptoRenewalReminder(
  input: BaseSendInput & CryptoRenewalReminderProps,
): Promise<SendResult> {
  const html = await render(<CryptoRenewalReminder {...input} />);
  const subject =
    input.daysUntilRenewal <= 1
      ? 'Your eYKON subscription ends tomorrow'
      : `${input.daysUntilRenewal} days left on your eYKON subscription`;
  return deliver(
    input.to,
    subject,
    html,
    'crypto_renewal_reminder',
    {
      tierLabel: input.tierLabel,
      daysUntilRenewal: input.daysUntilRenewal,
      currentPeriodEndIso: input.currentPeriodEndIso,
      renewalCheckoutUrl: input.renewalCheckoutUrl,
      amountUsd: input.amountUsd,
    },
    input.userId,
    input.notificationQueueId,
  );
}

export async function sendAdvocateInvitation(
  input: BaseSendInput & AdvocateInvitationProps,
): Promise<SendResult> {
  const html = await render(<AdvocateInvitation {...input} />);
  const subject = 'An invitation to the eYKON founder advocate program';
  return deliver(
    input.to,
    subject,
    html,
    'advocate_invitation',
    {
      displayName: input.displayName,
      partnershipDocUrl: input.partnershipDocUrl,
    },
    input.userId,
    input.notificationQueueId,
  );
}

export async function sendAdvocateWelcome(
  input: BaseSendInput & AdvocateWelcomeProps,
): Promise<SendResult> {
  const html = await render(<AdvocateWelcome {...input} />);
  const subject = 'Welcome to the eYKON founder advocate program';
  return deliver(
    input.to,
    subject,
    html,
    'advocate_welcome',
    {
      displayName: input.displayName,
      rewardfulPayoutSetupUrl: input.rewardfulPayoutSetupUrl,
      channelUrl: input.channelUrl,
    },
    input.userId,
    input.notificationQueueId,
  );
}
