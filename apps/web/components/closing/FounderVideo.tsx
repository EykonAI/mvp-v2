'use client';

import { useRef, useState } from 'react';
import { captureBrowser } from '@/lib/analytics/client';

/**
 * Screen 2 — the founder video slot (brief v1.3 §4.2).
 *
 * Until PR F drops the real recording into /public/start/, `src` is null
 * and this renders the styled slot with the founder line — deliberately
 * NOT an empty <video> element, which reads as a bug. When the file
 * lands, page.tsx passes the src and this becomes a click-to-play player:
 * self-hosted, no third-party embed chrome, no autoplay, poster frame.
 *
 * video_played fires on first play; video_progress at 25/50/75/100 —
 * where the script loses people is the single most actionable signal for
 * a v2 recut.
 */
const MILESTONES = [25, 50, 75, 100] as const;

export function FounderVideo({ src, poster }: { src: string | null; poster: string | null }) {
  const fired = useRef<Set<number>>(new Set());
  const [played, setPlayed] = useState(false);

  function onPlay() {
    if (!played) {
      setPlayed(true);
      captureBrowser({ event: 'video_played' });
    }
  }

  function onTimeUpdate(e: React.SyntheticEvent<HTMLVideoElement>) {
    const v = e.currentTarget;
    if (!v.duration) return;
    const pct = (v.currentTime / v.duration) * 100;
    for (const m of MILESTONES) {
      if (pct >= m && !fired.current.has(m)) {
        fired.current.add(m);
        captureBrowser({ event: 'video_progress', pct: m });
      }
    }
  }

  return (
    <section className="cs-section" id="video">
      <div className="cs-kicker">·· The founder ··</div>
      <h2 className="cs-h2">Why I built this.</h2>
      {src ? (
        <div className="cs-vid" style={{ padding: 0, border: '1px solid var(--teal)' }}>
          {/* Captions are burned into the recording (brief §4.2) — Reddit
              and Discord audiences watch sound-off. */}
          <video
            src={src}
            poster={poster ?? undefined}
            controls
            playsInline
            preload="metadata"
            onPlay={onPlay}
            onTimeUpdate={onTimeUpdate}
          />
        </div>
      ) : (
        <div className="cs-vid">
          <div className="cs-play">▶</div>
          <div className="cs-vlabel">FOUNDER — 2 MINUTES</div>
          <div className="cs-vsub">
            &ldquo;Every forecast we publish is hashed before the outcome, and the bad ones
            stay up. You are buying the finished platform at the unfinished price.&rdquo;
            <br />
            Recording lands here this week — the words above are the short version.
          </div>
        </div>
      )}
    </section>
  );
}
