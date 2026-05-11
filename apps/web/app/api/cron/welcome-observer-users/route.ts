import { NextResponse, type NextRequest } from 'next/server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { createServerSupabase } from '@/lib/supabase-server';
import { sendObserverWelcome } from '@/lib/email/send';
import {
  PERSONA_PHRASES,
} from '@/lib/email/templates/ObserverWelcome';
import { captureServer } from '@/lib/analytics/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Fires the Observer welcome email for newly-confirmed users.
 *
 * Trial-mechanism brief §5.6:
 *   • Trigger: auth.users.email_confirmed_at transition.
 *   • Delay: T+5 minutes after email confirmation, unless that lands in
 *     the 22:00–06:00 UTC quiet window — defer to the next 06:00 UTC so
 *     the email reaches business-hours inboxes.
 *   • Single-send guard: user_profiles.welcome_email_sent_at — when this
 *     column is non-null we never re-send.
 *
 * Recommended schedule on Railway: every 5 minutes
 * (* /5 * * * *). Authorisation header: `Bearer <CRON_SECRET>`.
 */

const T_PLUS_DELAY_MS = 5 * 60 * 1000;
const QUIET_START_UTC = 22; // inclusive
const QUIET_END_UTC = 6;    // exclusive

function scheduledSendTime(emailConfirmedAt: Date): Date {
  const proposed = new Date(emailConfirmedAt.getTime() + T_PLUS_DELAY_MS);
  const hour = proposed.getUTCHours();
  // In quiet window → push to next 06:00 UTC.
  if (hour >= QUIET_START_UTC || hour < QUIET_END_UTC) {
    const result = new Date(proposed);
    if (hour >= QUIET_START_UTC) {
      // Late evening — next calendar day's 06:00 UTC.
      result.setUTCDate(result.getUTCDate() + 1);
    }
    result.setUTCHours(QUIET_END_UTC, 0, 0, 0);
    return result;
  }
  return proposed;
}

function firstNameFromFull(full: string | null | undefined): string {
  if (!full) return '';
  const trimmed = full.trim();
  if (!trimmed) return '';
  const space = trimmed.search(/\s/);
  return (space === -1 ? trimmed : trimmed.slice(0, space)).slice(0, 60);
}

export async function POST(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const admin = createServerSupabase();

  // Candidates: confirmed email, no welcome sent yet. We pull a small
  // page of rows; the index added by migration 034 keeps this cheap.
  // Limit to 100 per run so a sudden burst of signups doesn't tip the
  // function over its time budget — the next run picks up the rest.
  const { data: candidates, error } = await admin
    .from('user_profiles')
    .select('id, email, full_name, persona')
    .is('welcome_email_sent_at', null)
    .limit(100);

  if (error) {
    return NextResponse.json(
      { error: 'candidates_query_failed', message: error.message },
      { status: 500 },
    );
  }

  const results = {
    candidates: candidates?.length ?? 0,
    sent: 0,
    deferred: 0,
    not_yet_confirmed: 0,
    failed: 0,
  };

  for (const profile of candidates ?? []) {
    // Pair with auth.users to read email_confirmed_at. Supabase admin
    // client can read this; service-role bypasses RLS.
    const { data: authUser } = await admin
      .schema('auth')
      .from('users')
      .select('email_confirmed_at, email')
      .eq('id', profile.id)
      .maybeSingle();

    const confirmedAt = authUser?.email_confirmed_at as string | null | undefined;
    if (!confirmedAt) {
      results.not_yet_confirmed++;
      continue;
    }

    const scheduled = scheduledSendTime(new Date(confirmedAt));
    if (Date.now() < scheduled.getTime()) {
      results.deferred++;
      continue;
    }

    const to = (profile.email as string | null) ?? (authUser?.email as string | null) ?? null;
    if (!to) {
      // Defensive — every confirmed user should have an email. Skip
      // rather than fail the run.
      results.failed++;
      continue;
    }

    const persona = (profile.persona as string | null) ?? '';
    const personaPhrase = PERSONA_PHRASES[persona] ?? '';
    const firstName = firstNameFromFull(profile.full_name as string | null);

    const send = await sendObserverWelcome({
      to,
      userId: profile.id as string,
      firstName,
      personaPhrase,
    });

    if (send.state === 'error') {
      results.failed++;
      continue;
    }

    // Mark sent so this user is never re-emailed. We update on both
    // 'sent' and 'dry_run' — the latter only happens in dev and we
    // don't want the cron to keep re-trying.
    await admin
      .from('user_profiles')
      .update({ welcome_email_sent_at: new Date().toISOString() })
      .eq('id', profile.id);

    // PostHog event — fires once per user lifetime by construction.
    void captureServer(profile.id as string, {
      event: 'welcome_email_sent',
      persona: persona || null,
      had_first_name: !!firstName,
      deferred_from_quiet_hours: false,
    });

    results.sent++;
  }

  return NextResponse.json(results);
}
