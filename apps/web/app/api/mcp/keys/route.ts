// /api/mcp/keys — list and mint API keys for the MCP server.
//
//   GET  -> 200 { keys: [...], limit, tier }   metadata only, never a secret
//   POST -> 201 { key: "eyk_...", ... }        the ONLY time the secret exists
//
// Tier gate: MEMBER and above. MCP is a paid feature (citizen has a 0
// daily allowance), so minting a citizen key would hand someone a
// credential that is refused on every call — a worse experience than
// being told plainly that the plan does not include it.
//
// That gate is also the abuse control. /api/waitlist shipped without
// one and was farmed until 22 of its 25 rows were bots; requiring a
// paid account makes key minting expensive to abuse without adding a
// CAPTCHA to a surface that is already behind a login.

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { getCurrentTier } from '@/lib/subscription';
import { tierAtLeast } from '@/lib/analyst/access';
import { createApiKey, listApiKeys } from '@/lib/mcp/auth';
import { dailyLimitFor } from '@/lib/mcp/limits';
import { safeError } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * Ceiling on live keys per user. Not a security boundary — a paid
 * account could still rotate through them — but it bounds the blast
 * radius of a scripted loop and keeps the management list readable.
 * Revoked keys do not count: revocation must always be the cheap,
 * obvious action, never something a quota discourages.
 */
const MAX_ACTIVE_KEYS = 10;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  try {
    const tier = await getCurrentTier();
    const keys = await listApiKeys(user.id);
    return NextResponse.json(
      {
        // listApiKeys selects metadata only — key_hash is never in the
        // projection, so a secret cannot reach the client even by
        // accident.
        keys,
        tier,
        daily_limit: dailyLimitFor(tier),
        max_active_keys: MAX_ACTIVE_KEYS,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    safeError('[api/mcp/keys] list failed', err);
    return NextResponse.json({ error: 'Could not list API keys.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const tier = await getCurrentTier();
  if (!tierAtLeast(tier, 'member')) {
    return NextResponse.json(
      {
        error: 'MCP access is included on paid plans.',
        tier,
        required_tier: 'member',
        upgrade_url: '/pricing?from=mcp_keys',
      },
      { status: 403 },
    );
  }

  let label = '';
  try {
    const body = await req.json();
    label = typeof body?.label === 'string' ? body.label.trim() : '';
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  // A label is required, not cosmetic: it is how someone identifies
  // which integration to revoke months later without guessing from a
  // prefix. The migration enforces 1..80 chars; refuse here too so the
  // caller gets a readable message instead of a constraint violation.
  if (label.length < 1 || label.length > 80) {
    return NextResponse.json(
      { error: 'A label of 1–80 characters is required, e.g. "Claude Desktop — laptop".' },
      { status: 400 },
    );
  }

  try {
    const existing = await listApiKeys(user.id);
    const active = existing.filter((k: { revoked_at: string | null }) => !k.revoked_at);
    if (active.length >= MAX_ACTIVE_KEYS) {
      return NextResponse.json(
        {
          error: `You already have ${MAX_ACTIVE_KEYS} active keys. Revoke one before creating another.`,
          max_active_keys: MAX_ACTIVE_KEYS,
        },
        { status: 409 },
      );
    }

    const created = await createApiKey(user.id, label);

    // The plaintext is returned HERE and nowhere else, ever. It is not
    // stored, not logged, and not recoverable — only its sha256 is in
    // the table. The client is responsible for showing it once.
    return NextResponse.json(
      {
        key: created.plaintext,
        id: created.id,
        key_prefix: created.keyPrefix,
        label,
        daily_limit: dailyLimitFor(tier),
        endpoint: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://eykon.ai'}/api/mcp`,
      },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    safeError('[api/mcp/keys] create failed', err);
    return NextResponse.json({ error: 'Could not create the API key.' }, { status: 500 });
  }
}
