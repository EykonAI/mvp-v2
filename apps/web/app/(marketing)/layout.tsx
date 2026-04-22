// Marketing route group layout — intentionally minimal.
//
// The landing page (/) brings its own nav, footer, and modal. Legal pages
// (/terms, /privacy, etc.) render LegalPageShell which includes its own
// tabbed legal nav. Keeping this layout as a pass-through means the two
// surfaces don't fight over sticky positioning or visual chrome.
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
