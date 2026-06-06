import { NextResponse, type NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { getCurrentUser } from '@/lib/auth/session';
import { isFounder } from '@/lib/admin/access';
import { createServerSupabase } from '@/lib/supabase-server';
import { shouldActuallySend } from '@/lib/email/client';
import { sendWaitlistBroadcast } from '@/lib/email/send';
import { APP_URL } from '@/lib/url';
import { safeError } from '@/lib/log';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/waitlist/broadcast — founder-only. Transactional broadcast
 * to (filtered) fiat-waitlist contacts. Side-effectful, so heavily guarded:
 *
 *   • founder-gated (isFounder / FOUNDER_EMAILS)
 *   • suppression — never emails a row with unsubscribed_at set
 *   • idempotency — a campaign is keyed by sha256(subject+body); a contact
 *     who already has a SENT/queued email_log row for that key is skipped,
 *     so re-running never double-sends. (dry_run / failed rows do NOT block
 *     a later real send.)
 *   • audit — every attempt writes to email_log (via the send layer); real
 *     sends also stamp fiat_waitlist.notified_at
 *   • preview mode returns the real recipient count WITHOUT sending, so the
 *     dashboard modal can show it before the founder confirms
 *   • dry-run aware — honours EMAIL_DRY_RUN / NEXT_PUBLIC_AUTH_ENABLED
 *
 * Body: {
 *   subject: string; body: string;            // body = plain text, blank-line paragraphs
 *   filters?: { tier?; status?; country?; email? };
 *   preview?: boolean;                          // count only, no send
 * }
 */

const MAX_RECIPIENTS_PER_RUN = 500;
const SEND_DELAY_MS = 120;

type Candidate = {
  id: string;
  email: string | null;
  tier: string | null;
  country: string | null;
  confirmed_email: boolean | null;
  notified_at: string | null;
  converted_user_id: string | null;
  unsubscribe_token: string | null;
};

function statusOf(r: Candidate): 'pending' | 'confirmed' | 'notified' | 'converted' {
  if (r.converted_user_id) return 'converted';
  if (r.notified_at) return 'notified';
  if (r.confirmed_email) return 'confirmed';
  return 'pending';
}

function campaignKey(subject: string, body: string): string {
  return crypto.createHash('sha256').update(`${subject}\n\n${body}`).digest('hex').slice(0, 32);
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !isFounder(user)) {
    // Match the dashboard gate: don't leak admin existence.
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const b = raw as Record<string, unknown>;
  const subject = typeof b.subject === 'string' ? b.subject.trim() : '';
  const message = typeof b.body === 'string' ? b.body.trim() : '';
  const preview = b.preview === true;
  const f = (b.filters ?? {}) as Record<string, unknown>;
  const fTier = typeof f.tier === 'string' ? f.tier : 'all';
  const fStatus = typeof f.status === 'string' ? f.status : 'all';
  const fCountry = typeof f.country === 'string' ? f.country : 'all';
  const fEmail = typeof f.email === 'string' ? f.email.trim() : '';

  if (!preview) {
    if (subject.length < 3 || subject.length > 200) {
      return NextResponse.json({ error: 'Subject must be 3–200 characters.' }, { status: 400 });
    }
    if (message.length < 10 || message.length > 5000) {
      return NextResponse.json({ error: 'Body must be 10–5000 characters.' }, { status: 400 });
    }
  }

  const admin = createServerSupabase();

  // Candidate recipients: opted-in (not unsubscribed), filtered server-side
  // by tier/country/email. Status is derived, so it's filtered in JS below.
  let q = admin
    .from('fiat_waitlist')
    .select(
      'id, email, tier, country, confirmed_email, notified_at, converted_user_id, unsubscribe_token',
    )
    .is('unsubscribed_at', null);
  if (fTier === 'pro' || fTier === 'enterprise') q = q.eq('tier', fTier);
  if (fCountry && fCountry !== 'all') q = q.eq('country', fCountry);
  if (fEmail) q = q.ilike('email', `%${fEmail}%`);

  const { data: rows, error } = await q.limit(5000);
  if (error) {
    safeError('[broadcast] load failed', error);
    return NextResponse.json({ error: 'Could not load recipients.' }, { status: 500 });
  }

  let candidates = (rows ?? []).filter(
    (r): r is Candidate & { email: string } => Boolean((r as Candidate).email),
  );
  if (fStatus && fStatus !== 'all') {
    candidates = candidates.filter(r => statusOf(r) === fStatus);
  }

  // Idempotency: who already received THIS campaign via a real send?
  const key = campaignKey(subject, message);
  let alreadySent = new Set<string>();
  if (subject && message) {
    const { data: logs } = await admin
      .from('email_log')
      .select('to_email, status, context')
      .eq('template', 'waitlist_broadcast');
    alreadySent = new Set(
      (logs ?? [])
        .filter(l => {
          const ctx = (l.context as Record<string, unknown> | null) ?? {};
          const st = String((l as { status?: string }).status ?? '');
          return ctx.campaign_key === key && (st === 'sent' || st === 'queued');
        })
        .map(l => String((l as { to_email?: string }).to_email ?? '').toLowerCase())
        .filter(Boolean),
    );
  }

  const pending = candidates.filter(r => !alreadySent.has(r.email.toLowerCase()));
  const dryRun = !shouldActuallySend();

  if (preview) {
    return NextResponse.json({
      preview: true,
      matching: candidates.length,
      already_sent: candidates.length - pending.length,
      recipient_count: pending.length,
      capped: Math.max(0, pending.length - MAX_RECIPIENTS_PER_RUN),
      dry_run: dryRun,
    });
  }

  // ── Send ──────────────────────────────────────────────────────────
  const toSend = pending.slice(0, MAX_RECIPIENTS_PER_RUN);
  const cappedOut = pending.length - toSend.length;
  let sent = 0;
  let failed = 0;
  const nowIso = new Date().toISOString();

  for (const r of toSend) {
    const token = r.unsubscribe_token;
    if (!token) {
      // Shouldn't happen post-migration-050, but never send without an
      // unsubscribe path.
      failed += 1;
      continue;
    }
    const unsubscribeUrl = `${APP_URL}/api/unsubscribe?token=${encodeURIComponent(token)}`;
    try {
      const result = await sendWaitlistBroadcast({
        to: r.email,
        subject,
        heading: subject,
        bodyParagraphs: message.split(/\n{2,}/).map(p => p.trim()).filter(Boolean),
        unsubscribeUrl,
        campaignKey: key,
      });
      if (result.state === 'sent') {
        sent += 1;
        // Audit: stamp notified_at only on a real send.
        await admin.from('fiat_waitlist').update({ notified_at: nowIso }).eq('id', r.id);
      } else if (result.state === 'dry_run') {
        sent += 1; // logged, counted as processed; notified_at left untouched
      } else {
        failed += 1;
      }
    } catch (err) {
      safeError('[broadcast] send failed', err);
      failed += 1;
    }
    if (SEND_DELAY_MS > 0) await sleep(SEND_DELAY_MS);
  }

  return NextResponse.json({
    ok: true,
    dry_run: dryRun,
    campaign_key: key,
    requested: pending.length,
    processed: toSend.length,
    sent,
    failed,
    skipped_already_sent: candidates.length - pending.length,
    capped_not_sent: cappedOut,
  });
}
