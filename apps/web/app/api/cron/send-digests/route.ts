import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { isValidPersona } from '@/lib/intelligence-analyst/personas';
import {
  fetchDigestSources,
  composeDigest,
  type DigestCadence,
  type DigestData,
  type DigestPersona,
  type DigestSources,
} from '@/lib/notifications/digest';
import { sendPersonaDigest } from '@/lib/email/send';
import { APP_URL } from '@/lib/url';

// send-digests · daily cron (Railway: 0 7 * * * — 07:00 UTC, outside
// the 22:00–06:00 quiet window, so no in-route deferral is needed).
//
// The zero-config persona digest (PR 3 of 3). For every user with
// email_enabled and not digest_opted_out, sends the daily digest; on
// Mondays, users whose notification_preferences.digest_frequency is
// 'weekly' get the 7-day digest instead. Persona comes from
// user_profiles.preferred_persona (migration 052) and falls back to
// 'generalist' — a missing persona never blocks.
//
// Cost shape: the global streams are fetched ONCE per cadence window
// and composed ONCE per (persona, cadence) — user count only adds
// renders + sends, not queries.
//
// Empty-window policy (founder decision): daily digests are SKIPPED
// when the persona's window has no events (no "nothing happened"
// email every day); weekly digests always send, with quiet-period copy.
//
// Idempotency: last_digest_sent_at is stamped after a successful send
// (or dry-run) and the due-check requires it to be older than 20h
// (daily) / 6d (weekly), so a re-run within the same day sends 0.
//
// Auth: Bearer <CRON_SECRET> via requireCronSecret (header only).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const USER_BATCH_LIMIT = 500; // 23 users today; revisit pagination beyond this
const DAILY_MIN_GAP_HOURS = 20;
const WEEKLY_MIN_GAP_HOURS = 6 * 24;

interface CandidateRow {
  id: string;
  email: string | null;
  preferred_persona: string | null;
  notification_preferences: Record<string, unknown> | null;
  last_digest_sent_at: string | null;
  digest_unsubscribe_token: string | null;
}

export async function POST(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const supabase = createServerSupabase();
  const now = new Date();
  const isMondayUtc = now.getUTCDay() === 1;

  const { data, error } = await supabase
    .from('user_profiles')
    .select(
      'id, email, preferred_persona, notification_preferences, last_digest_sent_at, digest_unsubscribe_token',
    )
    .not('email', 'is', null)
    .limit(USER_BATCH_LIMIT);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  const users = (data as CandidateRow[] | null) ?? [];

  const counts = {
    candidates: users.length,
    sent: 0,
    dry_run: 0,
    skipped_email_disabled: 0,
    skipped_opted_out: 0,
    skipped_not_due: 0,
    skipped_empty: 0,
    skipped_no_token: 0,
    failed: 0,
  };
  const sourceErrors: string[] = [];

  // Lazily fetch each cadence window's sources at most once.
  const sourcesByCadence = new Map<DigestCadence, DigestSources>();
  async function getSources(cadence: DigestCadence): Promise<DigestSources> {
    const existing = sourcesByCadence.get(cadence);
    if (existing) return existing;
    const fetched = await fetchDigestSources(supabase, cadence === 'daily' ? 24 : 168);
    for (const e of fetched.errors) sourceErrors.push(`${cadence}: ${e}`);
    sourcesByCadence.set(cadence, fetched);
    return fetched;
  }

  // Compose at most once per (persona, cadence).
  const digestMemo = new Map<string, DigestData>();
  async function getDigest(persona: DigestPersona, cadence: DigestCadence): Promise<DigestData> {
    const key = `${persona}:${cadence}`;
    const existing = digestMemo.get(key);
    if (existing) return existing;
    const composed = composeDigest(await getSources(cadence), persona, cadence);
    digestMemo.set(key, composed);
    return composed;
  }

  for (const user of users) {
    const prefs = user.notification_preferences ?? {};

    if (prefs.email_enabled === false) {
      counts.skipped_email_disabled += 1;
      continue;
    }
    if (prefs.digest_opted_out === true) {
      counts.skipped_opted_out += 1;
      continue;
    }
    if (!user.digest_unsubscribe_token) {
      // Defensive: migration 052 backfills + defaults the token, so this
      // should never trigger — but we refuse to send bulk mail without a
      // working unsubscribe URL.
      counts.skipped_no_token += 1;
      continue;
    }

    const cadence: DigestCadence =
      prefs.digest_frequency === 'weekly' ? 'weekly' : 'daily';

    const lastMs = user.last_digest_sent_at ? Date.parse(user.last_digest_sent_at) : null;
    const gapHours = cadence === 'daily' ? DAILY_MIN_GAP_HOURS : WEEKLY_MIN_GAP_HOURS;
    const due =
      (cadence === 'daily' || isMondayUtc) &&
      (lastMs === null || now.getTime() - lastMs > gapHours * 3600_000);
    if (!due) {
      counts.skipped_not_due += 1;
      continue;
    }

    const persona: DigestPersona = isValidPersona(user.preferred_persona)
      ? user.preferred_persona
      : 'generalist';

    try {
      const digest = await getDigest(persona, cadence);

      if (digest.isEmpty && cadence === 'daily') {
        counts.skipped_empty += 1;
        continue;
      }

      const result = await sendPersonaDigest({
        to: user.email as string,
        userId: user.id,
        data: digest,
        unsubscribeUrl: `${APP_URL}/api/digest/unsubscribe/${user.digest_unsubscribe_token}`,
      });

      if (result.state === 'error') {
        counts.failed += 1;
        continue;
      }
      if (result.state === 'dry_run') counts.dry_run += 1;
      else counts.sent += 1;

      await supabase
        .from('user_profiles')
        .update({ last_digest_sent_at: now.toISOString() })
        .eq('id', user.id);
    } catch (err) {
      console.error(
        `[send-digests] user ${user.id}:`,
        err instanceof Error ? err.message : 'unknown',
      );
      counts.failed += 1;
    }
  }

  return NextResponse.json({
    tickStartedAt: now.toISOString(),
    monday_utc: isMondayUtc,
    ...counts,
    source_errors: sourceErrors,
  });
}
