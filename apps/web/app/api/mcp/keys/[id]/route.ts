// /api/mcp/keys/[id] — revoke one key.
//
//   DELETE -> 200 { revoked: true }
//
// Revocation is a timestamp, not a row delete (migration 117): a
// deleted row loses the audit trail of a key that may have leaked, and
// "when did we cut this off" is exactly the question asked after an
// incident.
//
// Deliberately NOT tier-gated. Someone whose plan lapsed to citizen
// must still be able to revoke a key they issued while paying —
// tying the off switch to an active subscription would strand a
// credential in the field.

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { revokeApiKey } from '@/lib/mcp/auth';
import { safeError } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const id = params.id;
  // Reject anything that is not a uuid before it reaches Postgres — an
  // invalid uuid raises 22P02 there, which would surface as a 500 and
  // read as an outage rather than a bad request.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'Not a valid key id.' }, { status: 400 });
  }

  try {
    // revokeApiKey scopes on user_id as well as id, so guessing another
    // user's key id revokes nothing. The 404 below is therefore the
    // same answer for "does not exist", "belongs to someone else" and
    // "already revoked" — it deliberately does not confirm that a key
    // id exists for anyone else.
    const revoked = await revokeApiKey(user.id, id);
    if (!revoked) {
      return NextResponse.json(
        { error: 'No active key with that id.' },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { revoked: true, id },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    safeError('[api/mcp/keys] revoke failed', err);
    return NextResponse.json({ error: 'Could not revoke the key.' }, { status: 500 });
  }
}
