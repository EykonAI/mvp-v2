'use client';
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

// @supabase/ssr's createBrowserClient writes the session cookie in the same
// format that createServerClient (middleware + server helpers) reads. Using
// the plain @supabase/supabase-js createClient here would store the session
// in localStorage only and middleware would never see it.
let client: SupabaseClient | null = null;

export function getSupabaseBrowser(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }
  client = createBrowserClient(url, key);
  return client;
}
