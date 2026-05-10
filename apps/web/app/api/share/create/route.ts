import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getServerSupabase } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase-server';
import { checkUserShareRate, retryAfterSeconds } from '@/lib/rate-limit';
import {
  buildShareUrl,
  generateShareToken,
  isShareKind,
  SHARE_KIND_TABLE,
  type ShareKind,
} from '@/lib/share';

// POST /api/share/create
// Owner-only. Generates an opaque share_token for one of the
// shareable artifacts and returns the public URL with ?ref=
// attribution baked in.
//
// Body: { kind: 'analyst' | 'notification', id: <uuid> }
// Response: { url: string, share_token: string }
//
// Idempotent: if the row already has a share_token (the owner
// previously shared it), the existing token is reused — the URL
// stays stable across re-clicks of the Share button.
//
// Ownership is enforced via RLS: the user-scoped client can only
// SELECT/UPDATE rows where user_id = auth.uid(). A request for an
// id the caller does not own yields PGRST116 (no row), which we
// translate to 404.
//
// PR-S2 adds a per-user rate limit on NEW shares (30 per rolling
// hour, summed across analyst + notification artifacts). The limit
// only fires on the create-token path; idempotent re-clicks on an
// already-shared row bypass it.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_TOKEN_RETRIES = 5;

// Per-user rate limit (PR-S2). Counts rows in user_queries +
// user_notification_log where shared_at > now() - window. Sized for
// legitimate sharing burst (~one share per minute over an hour) while
// stopping a compromised client from spraying tokens to fill the
// share_token namespace.
const SHARE_RATE_WINDOW_SECONDS = 3600;
const SHARE_RATE_MAX = 30;

type CreateBody = {
  kind?: string;
  id?: string;
};

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (!isShareKind(body.kind) || typeof body.id !== 'string' || !body.id) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const kind: ShareKind = body.kind;
  const table = SHARE_KIND_TABLE[kind];

  const supabase = getServerSupabase();

  // RLS-guarded SELECT: returns the row only if the caller owns it.
  const { data: existing, error: selectErr } = await supabase
    .from(table)
    .select('id, share_token')
    .eq('id', body.id)
    .maybeSingle();

  if (selectErr) {
    return NextResponse.json({ error: selectErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Reuse existing token (idempotent re-click). The rate limit only
  // fires on the create path below — re-clicks are free.
  let token: string | null = (existing as { share_token: string | null }).share_token;

  if (!token) {
    // Per-user rate limit on new shares. Counted across both shareable
    // tables; idempotent re-clicks above don't reach this point.
    const limit = await checkUserShareRate({
      userId: user.id,
      windowSeconds: SHARE_RATE_WINDOW_SECONDS,
      max: SHARE_RATE_MAX,
    });
    if (limit.exceeded) {
      const retryAfter = retryAfterSeconds(SHARE_RATE_WINDOW_SECONDS);
      return NextResponse.json(
        { error: 'rate_limited', retry_after: retryAfter },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } },
      );
    }

    // Generate, write, retry on UNIQUE collision (vanishingly rare
    // at 64 bits but the constraint is the safety net).
    //
    // `.select('id')` is load-bearing — without it, an RLS-denied
    // UPDATE returns no error AND no row count, leaving us unable to
    // distinguish "wrote 1 row" from "wrote 0 rows". When 0 rows are
    // affected we MUST NOT return a token that was never persisted
    // (caused a 404 on the public page; fixed in migration 029 by
    // adding the missing self-update RLS policy on
    // user_notification_log).
    for (let attempt = 0; attempt < MAX_TOKEN_RETRIES; attempt++) {
      const candidate = generateShareToken();
      const { data: updatedRows, error: updateErr } = await supabase
        .from(table)
        .update({ share_token: candidate, shared_at: new Date().toISOString() })
        .eq('id', body.id)
        .is('share_token', null)
        .select('id');

      if (!updateErr) {
        if (updatedRows && updatedRows.length > 0) {
          token = candidate;
          break;
        }
        // No error but 0 rows changed — RLS, missing row, or the
        // row gained a share_token between SELECT and UPDATE. Either
        // way, the candidate did NOT persist; do not return it.
        return NextResponse.json({ error: 'share_write_failed' }, { status: 500 });
      }
      // 23505 = unique_violation. Anything else aborts.
      if (!updateErr.code || updateErr.code !== '23505') {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }
    }
    if (!token) {
      return NextResponse.json({ error: 'token_collision' }, { status: 500 });
    }
  }

  // Read the owner's public_id with the service-role client. We
  // don't want a user_profiles RLS policy to gate this read — the
  // caller's public_id is theirs to embed in their own share URLs.
  const admin = createServerSupabase();
  const { data: profile } = await admin
    .from('user_profiles')
    .select('public_id')
    .eq('id', user.id)
    .maybeSingle();
  const ownerPublicId = (profile as { public_id: string } | null)?.public_id ?? null;

  const origin = (process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin).replace(/\/$/, '');
  const url = buildShareUrl(origin, kind, token, ownerPublicId);

  return NextResponse.json({ url, share_token: token });
}
