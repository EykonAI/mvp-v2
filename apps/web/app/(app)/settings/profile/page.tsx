import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import TopNav from '@/components/TopNav';
import { getCurrentUser } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase-server';
import { commProfilesEnabled } from '@/lib/flags';
import { ProfileEditForm } from '@/components/settings/ProfileEditForm';

export const metadata: Metadata = {
  title: 'Your profile — eYKON.ai',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

export default async function ProfileSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/signin');

  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('user_profiles')
    .select(
      'handle, display_name, avatar_url, cover_url, bio, links, profile_visibility, reputation_opt_in, public_id',
    )
    .eq('id', user.id)
    .maybeSingle();

  const flagOn = commProfilesEnabled();
  const handle = (data?.handle as string | null) ?? '';
  const publicId = (data?.public_id as string | null) ?? '';
  const slug = handle || publicId;

  return (
    <>
      <TopNav />
      <section style={{ maxWidth: 760, margin: '0 auto', padding: '56px 32px 120px', color: 'var(--ink)' }}>
        <div
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 11,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: 'var(--teal)',
            marginBottom: 10,
          }}
        >
          ·· Profile ··
        </div>
        <h1
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: 36,
            fontWeight: 600,
            letterSpacing: '-0.5px',
            color: 'var(--ink)',
            marginBottom: 12,
          }}
        >
          Your public profile
        </h1>
        <p style={{ color: 'var(--ink-dim)', fontSize: 14, marginBottom: 28, lineHeight: 1.6 }}>
          Your public, pseudonymous COMM profile — handle, bio, links, and the home of your Calibration
          Passport. Real name is optional.
          {flagOn && slug ? (
            <>
              {' '}
              View it at{' '}
              <Link href={`/u/${slug}`} style={{ color: 'var(--teal)' }} prefetch={false}>
                /u/{slug}
              </Link>
              .
            </>
          ) : (
            <> It goes live when COMM is enabled.</>
          )}
        </p>

        <ProfileEditForm
          initial={{
            handle,
            display_name: (data?.display_name as string | null) ?? '',
            bio: (data?.bio as string | null) ?? '',
            avatar_url: (data?.avatar_url as string | null) ?? '',
            cover_url: (data?.cover_url as string | null) ?? '',
            links: Array.isArray(data?.links) ? (data?.links as { label?: string; url?: string }[]) : [],
            profile_visibility: (data?.profile_visibility as string | null) ?? 'public',
            reputation_opt_in: (data?.reputation_opt_in as boolean | null) ?? true,
          }}
          publicId={publicId}
        />
      </section>
    </>
  );
}
