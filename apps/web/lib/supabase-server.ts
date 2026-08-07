import { createClient } from '@supabase/supabase-js';

// Next 14 stores supabase-js GET responses in the Data Cache keyed by PostgREST URL,
// even under `export const dynamic = 'force-dynamic'` — the first post-deploy response
// is then replayed byte-for-byte until the next deploy (regime-shifts incident, PR #339).
// Forcing cache: 'no-store' on every supabase fetch opts the whole client out.
const noStoreFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, cache: 'no-store' });

// Server-side Supabase client (uses service role key for admin operations)
export function createServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: noStoreFetch },
  });
}

// Server-side client with user's auth context
export function createServerSupabaseWithAuth(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Missing Supabase env vars');
  }
  return createClient(url, anonKey, {
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
      fetch: noStoreFetch,
    },
  });
}
