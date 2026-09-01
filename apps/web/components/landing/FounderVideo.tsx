'use client';

// FOUNDER VIDEO — landing-page slot (LP v2, PR-C).
//
// Sits directly below the hero and above "The platform." The hero answers
// what this is; the pillars answer what is in it; the question between them is
// who is behind this. Lower down, near pricing, it would become a closing
// device — which is /start's job, not this page's.
//
// A landing-scoped component rather than a reuse of components/closing/
// FounderVideo: that one is styled with .cs-* classes from the closing page's
// stylesheet and would render unstyled here, since this page runs on
// landing.css under .eykon-landing. The behaviour rules are identical and are
// restated below so they cannot quietly diverge.
//
// Rules, none of which are style choices:
//   - Poster frame, click to play. NEVER autoplay, never with sound.
//   - Runtime visible before the click. An unlabelled video is a cost nobody
//     accepts blind.
//   - With no asset the slot renders a styled fallback carrying the argument
//     in text — not a broken player and not an empty box.
//   - NOTHING LOAD-BEARING LIVES ONLY IN THE VIDEO. A visitor who never
//     presses play loses no claim, no number and no caveat.
//   - Self-hosted, no third-party embed chrome. This audience blocks those
//     players, and a blocked embed is an empty rectangle where the founder
//     should be.

import { useRef, useState } from 'react';
import { captureBrowser } from '@/lib/analytics/client';
import {
  FOUNDER_VIDEO_SRC,
  FOUNDER_VIDEO_POSTER,
  FOUNDER_VIDEO_RUNTIME,
} from '@/lib/marketing/founder-video';

const MILESTONES = [25, 50, 75, 100] as const;

export function FounderVideo() {
  const fired = useRef<Set<number>>(new Set());
  const [played, setPlayed] = useState(false);

  function onPlay() {
    if (played) return;
    setPlayed(true);
    captureBrowser({ event: 'video_played', surface: 'landing' });
  }

  // Where the script loses people is the most actionable signal for a recut,
  // so quartiles are recorded rather than a single play count.
  function onTimeUpdate(e: React.SyntheticEvent<HTMLVideoElement>) {
    const v = e.currentTarget;
    if (!v.duration) return;
    const pct = (v.currentTime / v.duration) * 100;
    for (const m of MILESTONES) {
      if (pct >= m && !fired.current.has(m)) {
        fired.current.add(m);
        captureBrowser({ event: 'video_progress', pct: m, surface: 'landing' });
      }
    }
  }

  return (
    <section className="section fv-section" id="founder">
      <div className="fv-grid">
        <div className="fv-media">
          {FOUNDER_VIDEO_SRC ? (
            <div className="fv-frame has-video">
              {/* Captions are burned into the recording — this audience
                  watches sound-off — and the transcript is linked below for
                  anyone who would rather read it. */}
              <video
                src={FOUNDER_VIDEO_SRC}
                poster={FOUNDER_VIDEO_POSTER ?? undefined}
                controls
                playsInline
                preload="metadata"
                onPlay={onPlay}
                onTimeUpdate={onTimeUpdate}
              />
            </div>
          ) : (
            <div className="fv-frame" aria-hidden="true">
              <span className="fv-play">▶</span>
              <span className="fv-runtime">{FOUNDER_VIDEO_RUNTIME}</span>
            </div>
          )}
        </div>

        <div className="fv-copy">
          <span className="eyebrow">·· Why we built it ··</span>
          <h2 className="fv-h2">Built by people who got tired of guessing.</h2>
          <p className="fv-body">
            What eYKON measures, what it deliberately refuses to claim, and why the track
            record is published even when it is unflattering.
          </p>
          <p className="fv-body">
            Every forecast is hashed before the outcome is known, and the ones we get
            wrong stay up. Nothing on this page depends on watching it.
          </p>
          <p className="fv-fine">
            {FOUNDER_VIDEO_SRC
              ? 'Captions included · transcript below · nothing here exists only in the video.'
              : 'Recording in production. Captions and a full transcript ship with it.'}
          </p>
        </div>
      </div>
    </section>
  );
}
