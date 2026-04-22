import { NextResponse, type NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { createServerSupabase } from '@/lib/supabase-server';
import {
  recordWebhookReceipt,
  markWebhookProcessed,
  markWebhookFailed,
} from '@/lib/payments/idempotency';

export const dynamic = 'force-dynamic';

/**
 * Resend event webhook handler. Receives delivery / open / click / bounce /
 * complaint events and rolls them into email_log so we have a single source
 * of truth per message. Uses the shared webhook_events idempotency table
 * (provider='resend') so duplicate deliveries short-circuit.
 *
 * Signature verification uses Svix-style HMAC-SHA256 over the raw body with
 * the RESEND_WEBHOOK_SECRET from the Resend dashboard. If the secret is not
 * configured we still accept + process events (for sandbox/dev), but log
 * a warning on every request so ops notices.
 */

type ResendEvent = {
  type: string;                         // 'email.sent' | 'email.delivered' | 'email.opened' | ...
  created_at: string;
  data: {
    email_id?: string;
    to?: string[] | string;
    subject?: string;
    [k: string]: unknown;
  };
};

function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  const calc = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(calc, 'hex'), Buffer.from(header.trim(), 'hex'));
  } catch {
    return false;
  }
}

function statusFromEventType(eventType: string):
  | 'sent'
  | 'delivered'
  | 'opened'
  | 'clicked'
  | 'bounced'
  | 'complained'
  | null {
  switch (eventType) {
    case 'email.sent':
      return 'sent';
    case 'email.delivered':
    case 'email.delivery_delayed':
      return 'delivered';
    case 'email.opened':
      return 'opened';
    case 'email.clicked':
      return 'clicked';
    case 'email.bounced':
      return 'bounced';
    case 'email.complained':
      return 'complained';
    default:
      return null;
  }
}

function timestampColumnForStatus(status: string): string | null {
  switch (status) {
    case 'sent':
      return 'sent_at';
    case 'delivered':
      return 'delivered_at';
    case 'opened':
      return 'opened_at';
    case 'clicked':
      return 'clicked_at';
    case 'bounced':
      return 'bounced_at';
    case 'complained':
      return 'complained_at';
    default:
      return null;
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const sig = request.headers.get('svix-signature') ?? request.headers.get('resend-signature');

  if (secret) {
    if (!verifySignature(rawBody, sig, secret)) {
      return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
    }
  } else {
    console.warn('[resend-webhook] RESEND_WEBHOOK_SECRET not set — accepting unsigned delivery');
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const eventId =
    (typeof event.data?.email_id === 'string' ? event.data.email_id : '') +
    ':' +
    (event.type ?? '') +
    ':' +
    (event.created_at ?? '');

  const admin = createServerSupabase();

  let webhookRowId: string;
  try {
    const receipt = await recordWebhookReceipt(
      admin,
      'resend',
      eventId,
      event.type ?? null,
      event,
    );
    if (receipt.state === 'duplicate') {
      return NextResponse.json({ status: 'duplicate' });
    }
    webhookRowId = receipt.rowId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'idempotency failure';
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const newStatus = statusFromEventType(event.type);
  const messageId = typeof event.data?.email_id === 'string' ? event.data.email_id : null;

  if (!newStatus || !messageId) {
    await markWebhookProcessed(admin, webhookRowId);
    return NextResponse.json({ status: 'ignored', event_type: event.type });
  }

  const timestampCol = timestampColumnForStatus(newStatus);
  const update: Record<string, unknown> = {
    status: newStatus,
    updated_at: new Date().toISOString(),
  };
  if (timestampCol) update[timestampCol] = new Date().toISOString();

  const { error: updateError } = await admin
    .from('email_log')
    .update(update)
    .eq('resend_message_id', messageId);

  if (updateError) {
    await markWebhookFailed(admin, webhookRowId, updateError.message);
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await markWebhookProcessed(admin, webhookRowId);
  return NextResponse.json({ status: 'recorded', event_type: event.type });
}
