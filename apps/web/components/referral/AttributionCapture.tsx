'use client';

import { useEffect } from 'react';
import type { ArtifactType } from '@/lib/referral/attribution';

type AttributionCaptureProps = {
  artifactType: ArtifactType;
  artifactId: string;
};

/**
 * Drop-in client component for public artifact pages (PRs 4–5). Fires
 * a single fire-and-forget POST to /api/attribution/capture on mount.
 *
 * The eykon_ref cookie has already been written by middleware on the
 * first visit carrying ?ref=u_…; the API reads the cookie server-side
 * and looks up the referrer. The artifact_type / artifact_id this
 * component sends tell the API which artifact was viewed.
 *
 * Renders nothing. Idempotent within a session via sessionStorage —
 * a soft-refresh of the page does not log a duplicate event.
 */
export function AttributionCapture({ artifactType, artifactId }: AttributionCaptureProps) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const dedupeKey = `eykon_attr_${artifactType}_${artifactId}`;
    if (window.sessionStorage.getItem(dedupeKey)) return;
    window.sessionStorage.setItem(dedupeKey, '1');

    fetch('/api/attribution/capture', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        artifact_type: artifactType,
        artifact_id: artifactId,
      }),
      keepalive: true,
    }).catch(() => {
      // Silent — attribution must never disrupt the page.
    });
  }, [artifactType, artifactId]);

  return null;
}
