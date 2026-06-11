import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

// One-click digest unsubscribe. The token is the per-user opaque
// digest_unsubscribe_token from migration 052 — possession of the link
// IS the authorization (standard for email unsubscribe; no login, or
// the inbox provider's automated click would fail).
//
//   POST — RFC 8058 one-click target (List-Unsubscribe-Post header).
//   GET  — the human-readable link in the email body; returns a tiny
//          confirmation page.
//
// Both set notification_preferences.digest_opted_out = true (the
// send-digests cron skips those users). Idempotent: unsubscribing twice
// is a no-op. Other transactional email is unaffected.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function optOut(token: string): Promise<'ok' | 'not_found' | 'error'> {
  if (!/^d_[a-f0-9]{16}$/.test(token)) return 'not_found';
  const supabase = createServerSupabase();

  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, notification_preferences')
    .eq('digest_unsubscribe_token', token)
    .maybeSingle();
  if (error) return 'error';
  if (!data) return 'not_found';

  const prefs = (data.notification_preferences as Record<string, unknown> | null) ?? {};
  if (prefs.digest_opted_out === true) return 'ok'; // already out — idempotent

  const { error: updateErr } = await supabase
    .from('user_profiles')
    .update({ notification_preferences: { ...prefs, digest_opted_out: true } })
    .eq('id', data.id);
  return updateErr ? 'error' : 'ok';
}

function page(title: string, body: string, status: number): NextResponse {
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · eYKON</title>
<style>body{background:#0A1020;color:#E6EDF7;font-family:-apple-system,Segoe UI,Roboto,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
main{max-width:420px;padding:32px;background:#0F1829;border:1px solid #1F2E48;border-radius:8px;text-align:center}
h1{font-size:18px;margin:0 0 10px}p{font-size:14px;line-height:1.6;color:#C6D1E0;margin:0 0 6px}
a{color:#19D0B8;text-decoration:none}</style></head>
<body><main><h1>${title}</h1><p>${body}</p><p><a href="/settings">Manage preferences</a></p></main></body></html>`;
  return new NextResponse(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { token: string } },
) {
  const result = await optOut(params.token);
  if (result === 'ok') return NextResponse.json({ ok: true });
  if (result === 'not_found') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ error: 'internal' }, { status: 500 });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } },
) {
  const result = await optOut(params.token);
  if (result === 'ok') {
    return page(
      'You are unsubscribed',
      'You will no longer receive eYKON digest emails. Transactional emails (receipts, alerts from your own rules) are unaffected. You can re-enable digests any time from Settings.',
      200,
    );
  }
  if (result === 'not_found') {
    return page('Link not recognised', 'This unsubscribe link is invalid or has been rotated.', 404);
  }
  return page('Something went wrong', 'Please try again in a moment, or manage digests from Settings.', 500);
}
