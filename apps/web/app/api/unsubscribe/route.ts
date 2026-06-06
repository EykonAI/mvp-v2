import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { safeError } from '@/lib/log';

export const dynamic = 'force-dynamic';

/**
 * Public unsubscribe endpoint for waitlist broadcasts.
 *   • GET  /api/unsubscribe?token=… — human click from the email body link;
 *     records the opt-out and returns a small confirmation page.
 *   • POST /api/unsubscribe?token=… — RFC 8058 one-click (List-Unsubscribe-Post);
 *     records the opt-out and returns 200 with no body.
 *
 * Idempotent: a second hit on an already-unsubscribed token is a no-op.
 * The broadcast route filters on `unsubscribed_at IS NULL`, so opting out
 * here suppresses all future sends.
 */

type Result = 'ok' | 'already' | 'notfound';

async function applyUnsubscribe(token: string): Promise<Result> {
  // Tokens are 32 hex chars (replace(gen_random_uuid()::text,'-','')); be lenient.
  if (!token || !/^[a-f0-9]{16,64}$/i.test(token)) return 'notfound';
  const admin = createServerSupabase();
  const { data, error } = await admin
    .from('fiat_waitlist')
    .select('id, unsubscribed_at')
    .eq('unsubscribe_token', token)
    .maybeSingle();
  if (error || !data) return 'notfound';
  if (data.unsubscribed_at) return 'already';
  const { error: upErr } = await admin
    .from('fiat_waitlist')
    .update({ unsubscribed_at: new Date().toISOString() })
    .eq('id', data.id);
  if (upErr) {
    safeError('[unsubscribe] update failed', upErr);
    return 'notfound';
  }
  return 'ok';
}

function page(title: string, message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} — eYKON.ai</title>
<style>
  body{margin:0;background:#0A1020;color:#E6EDF7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center}
  .card{max-width:460px;padding:36px 32px;background:#0F1829;border:1px solid #1F2E48;border-radius:8px;text-align:center}
  .brand{font-size:14px;font-weight:600;letter-spacing:3px;text-transform:uppercase;margin:0 0 18px}
  .dot{color:#19D0B8}
  h1{font-size:20px;margin:0 0 10px}
  p{font-size:14px;line-height:1.6;color:#8BA3B8;margin:0}
  a{color:#19D0B8;text-decoration:none}
</style></head><body><div class="card">
<p class="brand">eYKON<span class="dot">.ai</span></p>
<h1>${title}</h1><p>${message}</p>
</div></body></html>`;
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? '';
  const result = await applyUnsubscribe(token).catch(err => {
    safeError('[unsubscribe] GET error', err);
    return 'notfound' as Result;
  });
  const body =
    result === 'notfound'
      ? page('Link not recognised', 'This unsubscribe link is invalid or has expired.')
      : page(
          'Unsubscribed',
          "You've been removed from eYKON fiat-waitlist emails. You won't receive further messages about your seat.",
        );
  return new NextResponse(body, {
    status: result === 'notfound' ? 404 : 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? '';
  const result = await applyUnsubscribe(token).catch(err => {
    safeError('[unsubscribe] POST error', err);
    return 'notfound' as Result;
  });
  return new NextResponse(null, { status: result === 'notfound' ? 404 : 200 });
}
