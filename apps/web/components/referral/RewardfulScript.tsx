'use client';
import Script from 'next/script';

// ── Typing for window.rewardful / window.Rewardful ────────────────
// Rewardful exposes two globals:
//   - `window.rewardful(...)` — queue function, usable even before script loads
//   - `window.Rewardful` — populated by the library after load; carries
//     the current affiliate referral id on `.referral` when the visitor
//     arrived via a ?via=<code> link.
declare global {
  interface Window {
    rewardful?: (...args: unknown[]) => void;
    _rwq?: string;
    Rewardful?: {
      referral?: string | null;
      affiliate?: { id: string; token: string; name?: string } | null;
      ready?: (callback: () => void) => void;
    };
  }
}

/**
 * Drops the Rewardful tracking script into the page. Designed to mount
 * inside layouts that wrap (a) the marketing surface the user lands on and
 * (b) the auth pages where signup happens — the cookie needs to be set
 * before Supabase signup, otherwise referrer attribution is lost.
 *
 * No-ops when NEXT_PUBLIC_REWARDFUL_API_KEY is unset, which keeps dev and
 * pre-activation builds silent.
 */
export function RewardfulScript() {
  const apiKey = process.env.NEXT_PUBLIC_REWARDFUL_API_KEY;
  if (!apiKey) return null;

  return (
    <>
      {/*
        Both scripts use `afterInteractive`. App Router only supports
        `beforeInteractive` in the root app/layout.tsx, and this component
        ships inside nested layouts ((marketing) + auth) — `afterInteractive`
        is the correct strategy for nested use, and Next.js guarantees the
        JSX order is preserved at DOM injection time, so the queue bootstrap
        lands before the external library loads.

        The queue is a trivial fn-and-array shim, so any rewardful(...) call
        that fires between injection + library hydration is just pushed to
        w._rwq and replayed once the library runs.
      */}
      <Script
        id="rewardful-queue"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html:
            "(function(w,r){w._rwq=r;w[r]=w[r]||function(){(w[r].q=w[r].q||[]).push(arguments)}})(window,'rewardful');",
        }}
      />
      <Script
        id="rewardful-library"
        src="https://r.wdfl.co/rw.js"
        strategy="afterInteractive"
        data-rewardful={apiKey}
      />
    </>
  );
}

/**
 * Reads the current Rewardful affiliate referral id from the global. Returns
 * null if Rewardful is not loaded (e.g. env var unset) or the current visitor
 * arrived without a ?via= code. Safe to call in any client component.
 */
export function getRewardfulReferral(): string | null {
  if (typeof window === 'undefined') return null;
  const r = window.Rewardful;
  if (!r) return null;
  return r.referral ?? r.affiliate?.id ?? null;
}
