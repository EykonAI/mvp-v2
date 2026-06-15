import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

// Resolves "me" → the signed-in user's own public profile (/u/<handle>,
// or /u/<public_id> if no handle is set). The COMM menu's "Profile" link
// points here so the nav never needs the user's slug client-side.
export default async function MePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/signin?next=/me');

  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('user_profiles')
    .select('handle, public_id')
    .eq('id', user.id)
    .maybeSingle();

  const slug = (data?.handle as string | null) || (data?.public_id as string | null);
  redirect(slug ? `/u/${slug}` : '/settings/profile');
}
