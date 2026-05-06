import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { EYKON_REF_COOKIE } from '@/lib/referral/attribution';
import { captureAttribution } from '@/lib/referral/capture';

// POST /api/attribution/capture
// Called by <AttributionCapture> on public artifact pages (PRs 4–5).
// Reads the eykon_ref cookie set by middleware on first ?ref=u_… visit,
// records the event in attribution_events, and finalises
// referred_by_pending on free-tier authenticated recipients.
//
// Always returns 204 — attribution is silent (spec §1.3). The caller
// should fire-and-forget; success/failure is not observable client-side.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type CaptureBody = {
  artifact_type?: string;
  artifact_id?: string;
};

const NO_CONTENT = new NextResponse(null, { status: 204 });

export async function POST(req: NextRequest) {
  let body: CaptureBody = {};
  try {
    body = (await req.json()) as CaptureBody;
  } catch {
    return NO_CONTENT;
  }

  const ref = req.cookies.get(EYKON_REF_COOKIE)?.value ?? null;
  if (!ref) return NO_CONTENT;

  const user = await getCurrentUser();
  const recipientUserId = user?.id ?? null;
  const sessionId = req.cookies.get('eykon_session')?.value ?? null;
  const rawIp = extractClientIp(req);

  try {
    await captureAttribution({
      ref,
      artifactType: body.artifact_type ?? null,
      artifactId: body.artifact_id ?? null,
      recipientUserId,
      recipientSessionId: sessionId,
      rawIp,
    });
  } catch (err) {
    // Silent failure — log server-side, never surface. Attribution must
    // never disrupt the user-facing artifact view.
    console.error('[attribution.capture] failed', err);
  }

  return NO_CONTENT;
}

function extractClientIp(req: NextRequest): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    // x-forwarded-for can be a comma-separated chain; the leftmost
    // entry is the original client.
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  return null;
}
