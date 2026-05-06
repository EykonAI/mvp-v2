import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { verifyTurnstileToken } from '@/lib/grow/turnstile';
import { detectSpam } from '@/lib/grow/spam-check';
import { getCurrentUser } from '@/lib/auth/session';
import { getFounderEmails } from '@/lib/admin/access';
import {
  sendAdvocateSubmissionConfirmation,
  sendAdvocateSubmissionFounderNotification,
} from '@/lib/email/send';

// POST /api/grow/submissions
// Inbound advocate-program submission. Spec §3.3.
//
// Validates the form, runs Turnstile, applies the per-IP / per-email
// rate limits, persists to advocate_submissions (RLS-bypassed via
// the service role since anonymous submitters have no auth.uid()),
// fires confirmation + founder-notification emails.
//
// Returns 200 on success with { ok: true }, 4xx with { error: string }
// on validation / rate-limit failures. Never leaks DB internals.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_FIELD_BYTES = 4096;
const PER_IP_24H_LIMIT = 3;
const PER_EMAIL_30D_DAYS = 30;

const FIELD_LIMITS = {
  full_name: { min: 2, max: 100 },
  primary_handle: { min: 2, max: 200 },
  professional_context: { min: 2, max: 200 },
  network_description: { min: 100, max: 1000 },
  why_eykon: { min: 100, max: 800 },
  preferred_contact_email: { min: 5, max: 200 },
} as const;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Body = Partial<Record<keyof typeof FIELD_LIMITS, string>> & {
  turnstile_token?: string;
};

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const fields: Record<keyof typeof FIELD_LIMITS, string> = {
    full_name: trim(body.full_name),
    primary_handle: trim(body.primary_handle),
    professional_context: trim(body.professional_context),
    network_description: trim(body.network_description),
    why_eykon: trim(body.why_eykon),
    preferred_contact_email: trim(body.preferred_contact_email).toLowerCase(),
  };

  for (const [key, limits] of Object.entries(FIELD_LIMITS) as Array<[
    keyof typeof FIELD_LIMITS,
    { min: number; max: number },
  ]>) {
    const value = fields[key];
    if (value.length < limits.min || value.length > limits.max) {
      return NextResponse.json(
        { error: `field_length:${key}` },
        { status: 400 },
      );
    }
    if (Buffer.byteLength(value, 'utf8') > MAX_FIELD_BYTES) {
      return NextResponse.json({ error: `field_bytes:${key}` }, { status: 400 });
    }
  }
  if (!EMAIL_REGEX.test(fields.preferred_contact_email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  }

  const ip = extractClientIp(req);
  const userAgent = req.headers.get('user-agent')?.slice(0, 400) ?? null;

  const turnstile = await verifyTurnstileToken(body.turnstile_token, ip);
  if (!turnstile.ok) {
    return NextResponse.json({ error: turnstile.reason }, { status: 400 });
  }

  const admin = createServerSupabase();

  // Rate limits — both checked before any side effect fires.
  if (ip) {
    const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    const { count } = await admin
      .from('advocate_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('submitted_from_ip', ip)
      .gte('created_at', since);
    if ((count ?? 0) >= PER_IP_24H_LIMIT) {
      return NextResponse.json({ error: 'rate_limit_ip' }, { status: 429 });
    }
  }
  {
    const since = new Date(Date.now() - PER_EMAIL_30D_DAYS * 24 * 60 * 60_000).toISOString();
    const { count } = await admin
      .from('advocate_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('preferred_contact_email', fields.preferred_contact_email)
      .gte('created_at', since);
    if ((count ?? 0) >= 1) {
      return NextResponse.json({ error: 'rate_limit_email' }, { status: 429 });
    }
  }

  const spamReason = detectSpam(fields);

  // If the submitter is logged in, attach their auth user id so the
  // founder can see they have an existing account.
  const submitter = await getCurrentUser();

  const { data: inserted, error: insertErr } = await admin
    .from('advocate_submissions')
    .insert({
      full_name: fields.full_name,
      primary_handle: fields.primary_handle,
      professional_context: fields.professional_context,
      network_description: fields.network_description,
      why_eykon: fields.why_eykon,
      preferred_contact_email: fields.preferred_contact_email,
      submitting_user_id: submitter?.id ?? null,
      status: 'pending',
      spam_flagged: spamReason !== null,
      spam_reason: spamReason,
      submitted_from_ip: ip,
      user_agent: userAgent,
    })
    .select('id')
    .single();

  if (insertErr || !inserted) {
    return NextResponse.json(
      { error: insertErr?.message ?? 'insert_failed' },
      { status: 500 },
    );
  }

  const submissionId = (inserted as { id: string }).id;

  // Fire-and-forget the two emails. Don't block on them — the
  // founder will still see the submission in the admin panel even
  // if Resend is down.
  sendAdvocateSubmissionConfirmation({
    to: fields.preferred_contact_email,
    userId: submitter?.id ?? null,
    fullName: fields.full_name,
  }).catch((err) => console.error('[grow.confirm.email]', err));

  for (const founderEmail of getFounderEmails()) {
    sendAdvocateSubmissionFounderNotification({
      to: founderEmail,
      userId: null,
      submissionId,
      fullName: fields.full_name,
      primaryHandle: fields.primary_handle,
      professionalContext: fields.professional_context,
      networkDescription: fields.network_description,
      whyEykon: fields.why_eykon,
      preferredContactEmail: fields.preferred_contact_email,
      spamFlagged: spamReason !== null,
      spamReason,
    }).catch((err) => console.error('[grow.founder.email]', err));
  }

  return NextResponse.json({ ok: true });
}

function trim(value: string | undefined): string {
  return (value ?? '').trim();
}

function extractClientIp(req: NextRequest): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  return null;
}
