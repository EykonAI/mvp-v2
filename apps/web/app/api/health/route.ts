import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
// Keep the probe quick — Railway alerting fires if a health check returns
// non-200 for >2 min, so we want fast results even when one downstream is
// flaking.
export const maxDuration = 10;

type DependencyStatus = {
  ok: boolean;
  latency_ms: number;
  detail?: string;
};

type HealthBody = {
  status: 'ok' | 'degraded' | 'down';
  service: 'eykon-web';
  timestamp: string;
  version: string;
  dependencies: {
    supabase: DependencyStatus;
    anthropic: DependencyStatus;
  };
};

async function checkSupabase(): Promise<DependencyStatus> {
  const start = Date.now();
  try {
    const admin = createServerSupabase();
    // Cheap probe: select count on user_profiles (small table) with a
    // hard limit so we never block on a slow query.
    const { error } = await admin
      .from('user_profiles')
      .select('id', { count: 'exact', head: true })
      .limit(1);
    if (error) {
      return { ok: false, latency_ms: Date.now() - start, detail: error.message };
    }
    return { ok: true, latency_ms: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      latency_ms: Date.now() - start,
      detail: err instanceof Error ? err.message : 'unknown',
    };
  }
}

async function checkAnthropic(): Promise<DependencyStatus> {
  const start = Date.now();
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return { ok: false, latency_ms: 0, detail: 'ANTHROPIC_API_KEY not set' };
  }
  try {
    // HEAD to the public docs origin — we don't want to spend an actual
    // model token on every health check. This still tells us whether the
    // outbound network can reach Anthropic.
    const res = await fetch('https://api.anthropic.com/v1/models', {
      method: 'GET',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok && res.status !== 401 && res.status !== 403) {
      return {
        ok: false,
        latency_ms: Date.now() - start,
        detail: `HTTP ${res.status}`,
      };
    }
    // 401/403 still mean we reached the API — auth might be misconfigured
    // but the dependency itself is reachable. Surface as ok with a note.
    return {
      ok: true,
      latency_ms: Date.now() - start,
      detail: res.status === 200 ? undefined : `auth: HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      latency_ms: Date.now() - start,
      detail: err instanceof Error ? err.message : 'unknown',
    };
  }
}

/**
 * GET /api/health
 *
 * Probes both Supabase (DB writes / reads) and the Anthropic API
 * (outbound reachability). Returns 200 when both ok, 503 when any
 * critical dependency is down. Railway alerting picks up the 503; the
 * `dependencies` payload tells the on-call which leg failed.
 *
 * For load testing or status-page polling (Phase 14 deferred) you can
 * skip the deep check by hitting `/api/health?shallow=1`, which returns
 * immediately with status='ok' and no downstream calls.
 */
export async function GET(request: NextRequest) {
  const shallow = request.nextUrl.searchParams.get('shallow') === '1';
  const timestamp = new Date().toISOString();
  const version = '2.0.0';

  if (shallow) {
    return NextResponse.json({
      status: 'ok',
      service: 'eykon-web',
      timestamp,
      version,
      dependencies: {},
    });
  }

  const [supabase, anthropic] = await Promise.all([checkSupabase(), checkAnthropic()]);
  const status: HealthBody['status'] =
    supabase.ok && anthropic.ok
      ? 'ok'
      : !supabase.ok && !anthropic.ok
      ? 'down'
      : 'degraded';

  const body: HealthBody = {
    status,
    service: 'eykon-web',
    timestamp,
    version,
    dependencies: { supabase, anthropic },
  };

  return NextResponse.json(body, {
    status: status === 'ok' ? 200 : 503,
  });
}
