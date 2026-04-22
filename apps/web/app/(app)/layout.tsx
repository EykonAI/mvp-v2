import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

// The (app) route group wraps the authenticated product surfaces:
//   /app        — the 3D globe
//   /intel/*    — the Intelligence Center workspaces
//   /dashboard  — (Phase 2+)
//   /settings   — (Phase 2+)
//   /billing    — (Phase 10)
//
// Auth enforcement is gated behind NEXT_PUBLIC_AUTH_ENABLED so that Phase 1
// (this route restructure) can ship before Phase 2 (Supabase Auth). When the
// flag flips to 'true' in Phase 2, unauthed users are redirected to /auth/signin.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const authEnabled = process.env.NEXT_PUBLIC_AUTH_ENABLED === 'true';

  if (authEnabled) {
    const cookieStore = cookies();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (supabaseUrl && supabaseAnon) {
      const supabase = createServerClient(supabaseUrl, supabaseAnon, {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          // Layouts cannot mutate cookies; middleware handles session refresh.
          setAll() {},
        },
      });

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) redirect('/auth/signin');
    }
  }

  return <>{children}</>;
}
