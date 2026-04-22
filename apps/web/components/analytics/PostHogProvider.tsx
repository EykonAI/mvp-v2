'use client';
import { Suspense, useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { captureBrowser, initPostHogBrowser } from '@/lib/analytics/client';

/**
 * Mounts PostHog client-side and captures `page_viewed` on every route
 * change. No-ops silently when NEXT_PUBLIC_POSTHOG_KEY is unset, so dev and
 * pre-activation traffic don't fire noise into the dashboard.
 *
 * Query strings are deliberately NOT included in page_viewed props — the
 * product surface has intent-carrying params on /pricing and /auth
 * (?plan=, ?next=) that we don't want leaking through URL strings. The
 * downstream events (plan_selected, checkout_started) carry that data
 * with explicit typed shape.
 *
 * The route-change tracker is rendered inside a Suspense boundary because
 * useSearchParams() forces the closest Suspense parent into a client bailout
 * — isolating it here keeps the rest of the tree free to prerender.
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initPostHogBrowser();
  }, []);

  return (
    <>
      <Suspense fallback={null}>
        <PageViewTracker />
      </Suspense>
      {children}
    </>
  );
}

function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  useEffect(() => {
    if (!pathname) return;
    captureBrowser({ event: 'page_viewed', path: pathname });
    // searchParams included so client-side nav that only changes the query
    // string still re-fires page_viewed (otherwise PostHog misses the
    // billing-toggle-induced nav on /pricing).
  }, [pathname, searchParams]);
  return null;
}
