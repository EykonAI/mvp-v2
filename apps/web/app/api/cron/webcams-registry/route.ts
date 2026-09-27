import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { MissingKeyError, PROVIDERS, type ProviderId } from '@/lib/webcams/providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 300;

/**
 * Webcam registry refresh · daily (Imagery Layer IMG-5, mig 187).
 *
 * For each wave-1 provider: fetch its camera list and hand it to
 * webcams_upsert(), which derives opaque ids, links the nearest AOI within
 * 5 km, and retires cameras the provider no longer lists. New cameras start
 * NOT live — only the liveness cron makes a camera live.
 *
 * Wave 2 (IMG-9, mig 192): a provider is fetched ONLY when its licence row
 * is 'ok' — nothing is requested from an operator whose terms are not
 * cleared — and only when its API key is set. Both are reported as
 * 'skipped' with the reason, not as failures.
 *
 * Fails loud: any provider failing (or returning zero cameras, which the
 * database refuses so as not to retire a whole provider) → 502.
 * ?provider=<id> refreshes one provider.
 */
const VERSION = 'webcams-registry-v2';

async function handle(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;
  const only = req.nextUrl.searchParams.get('provider') as ProviderId | null;
  const ids = (Object.keys(PROVIDERS) as ProviderId[]).filter(p => !only || p === only);
  if (ids.length === 0) return NextResponse.json({ ok: false, version: VERSION, error: `unknown provider ${only}` }, { status: 400 });

  const supabase = createServerSupabase();
  const results: Array<Record<string, unknown>> = [];
  const errors: string[] = [];
  const skipped: Array<{ provider: string; reason: string }> = [];
  const startedAt = Date.now();

  const { data: lic, error: licErr } = await supabase.from('imagery_licences').select('provider_id, commercial_status').in('provider_id', ids);
  if (licErr) return NextResponse.json({ ok: false, version: VERSION, error: `imagery_licences: ${licErr.message}` }, { status: 502 });
  const status = new Map((lic ?? []).map(r => [r.provider_id as string, r.commercial_status as string]));

  for (const provider of ids) {
    const st = status.get(provider) ?? 'no licence row';
    if (st !== 'ok') {
      skipped.push({ provider, reason: `licence ${st}` });
      continue;
    }
    try {
      const rows = await PROVIDERS[provider]();
      const { data, error } = await supabase.rpc('webcams_upsert', { p_provider: provider, p_rows: rows });
      if (error) throw new Error(`webcams_upsert: ${error.message}`);
      results.push({ provider, listed: rows.length, ...((data as any[])?.[0] ?? {}) });
    } catch (err) {
      if (err instanceof MissingKeyError) skipped.push({ provider, reason: `${err.envVar} not set` });
      else errors.push(`${provider}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const ok = errors.length === 0;
  return NextResponse.json(
    { ok, version: VERSION, providers: ids, results, skipped, errors, elapsed_ms: Date.now() - startedAt },
    { status: ok ? 200 : 502 },
  );
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
