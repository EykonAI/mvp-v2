import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAccess, tierAtLeast } from '@/lib/analyst/access';
import { listSessions, createSession } from '@/lib/analyst/store';
import { allowedSessionModels, DEEP_ANALYSIS_MODEL } from '@/lib/analyst/model';
import { isValidPersona } from '@/lib/intelligence-analyst/personas';

// /api/analyst/sessions — list + create (Member+, brief §9.6:
// sessions/history are the continuity that reaches Member).

export async function GET() {
  const caller = await requireSessionAccess('member');
  if (caller instanceof NextResponse) return caller;
  try {
    const sessions = await listSessions(caller.userId);
    return NextResponse.json({ sessions });
  } catch (err: any) {
    console.error('[analyst/sessions] GET failed:', err?.message);
    return NextResponse.json({ error: 'failed to list sessions' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const caller = await requireSessionAccess('member');
  if (caller instanceof NextResponse) return caller;

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine — all fields optional
  }

  const persona =
    typeof body.persona === 'string' && isValidPersona(body.persona) ? body.persona : null;

  const origin =
    body.origin === 'inline' || body.origin === 'comm' ? body.origin : 'workspace';

  // Model: only ids from the configured set are accepted; the Deep
  // Analysis model is Pro+ leverage (§9.6). Omitted → engine default.
  let model: string | null = null;
  if (typeof body.model === 'string' && body.model) {
    if (!allowedSessionModels().includes(body.model)) {
      return NextResponse.json({ error: 'unknown model' }, { status: 400 });
    }
    if (body.model === DEEP_ANALYSIS_MODEL && !tierAtLeast(caller.tier, 'pro')) {
      return NextResponse.json(
        {
          error: 'Deep Analysis is available on Pro and above.',
          required_tier: 'pro',
          upgrade_url: '/pricing?from=analyst_deep',
        },
        { status: 403 },
      );
    }
    model = body.model;
  }

  try {
    const session = await createSession({
      userId: caller.userId,
      persona,
      model,
      origin,
      viewport: body.viewport ?? null,
    });
    return NextResponse.json({ session }, { status: 201 });
  } catch (err: any) {
    console.error('[analyst/sessions] POST failed:', err?.message);
    return NextResponse.json({ error: 'failed to create session' }, { status: 500 });
  }
}
