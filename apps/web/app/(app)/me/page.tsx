import { getCurrentUser } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase-server';
import { ClientRedirect } from '@/components/ClientRedirect';

export const dynamic = 'force-dynamic';

// Resolves "me" → the signed-in user's own public profile (/u/<handle>, or
// /u/<public_id> if no handle is set). The COMM menu's "Profile" link points
// here so the nav never needs the user's slug client-side.
//
// IMPORTANT — why this RENDERS a client redirect instead of calling the server
// redirect(): a Server Component redirect() can drop the Set-Cookie that
// middleware just used to refresh+rotate the Supabase session, silently logging
// the user out on the next request (the "logged out when I press Profile" bug;
// the other COMM links were unaffected because they render rather than
// redirect). Returning a normal render response preserves the refreshed cookie;
// the client then navigates. The slug lookup stays here on the service-role
// client (reliable, no RLS surprise).
export default async function MePage() {
  const user = await getCurrentUser();
  if (!user) return <ClientRedirect dest="/auth/signin?next=/me" label="Redirecting…" />;

  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('user_profiles')
    .select('handle, public_id')
    .eq('id', user.id)
    .maybeSingle();

  const slug = (data?.handle as string | null) || (data?.public_id as string | null);
  return <ClientRedirect dest={slug ? `/u/${slug}` : '/settings/profile'} label="Loading your profile…" />;
}
