'use client';

import Link from 'next/link';
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { captureBrowser } from '@/lib/analytics/client';
import { campaignPropsFromLocation, captureWithFirstTouch } from '@/lib/analytics/utm';

/**
 * Campaign instrumentation for the public landing surfaces (/c, /q, and
 * /start when it ships). Two pieces:
 *
 * - <CampaignPageView> fires content_page_viewed WITH the utm_* fields
 *   (the global page_viewed strips them by design) and writes first-touch
 *   person properties. Mount once per page.
 * - <TrackedCta> is a Link that fires cta_clicked before navigating, so
 *   the /c → signup and /c → week-pass hand-off rates become measurable.
 *   Until PR B, neither /c nor /q fired a single custom event.
 */

export function CampaignPageView({
  contentType,
  contentId,
}: {
  contentType: 'newsjack' | 'proactive';
  contentId: string;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; // once per mount, incl. React 18 dev double-invoke
    fired.current = true;
    captureWithFirstTouch({
      event: 'content_page_viewed',
      content_type: contentType,
      content_id: contentId,
      ...campaignPropsFromLocation(),
    });
  }, [contentType, contentId]);
  return null;
}

export function TrackedCta({
  href,
  source,
  contentId,
  style,
  children,
}: {
  href: string;
  source: 'newsjack' | 'proactive' | 'closing';
  contentId: string | null;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      style={style}
      onClick={() => {
        captureBrowser({
          event: 'cta_clicked',
          source,
          content_id: contentId,
          target: href.split('?')[0],
        });
      }}
    >
      {children}
    </Link>
  );
}
