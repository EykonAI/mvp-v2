import { RewardfulScript } from '@/components/referral/RewardfulScript';

// Marketing route group layout — intentionally minimal.
//
// The landing page (/) brings its own nav, footer, and modal. Legal pages
// (/terms, /privacy, etc.) render LegalPageShell which includes its own
// tabbed legal nav. Keeping this layout as a pass-through means the two
// surfaces don't fight over sticky positioning or visual chrome.
//
// Rewardful is mounted here so the tracking cookie is set as soon as a
// referred visitor hits any marketing page — before they click through to
// /auth/signup, where the cookie is read and forwarded into Supabase
// user_metadata.
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <RewardfulScript />
      {children}
    </>
  );
}
