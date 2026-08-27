// ─── REDDIT DETERMINISTIC TEMPLATE — THE FALLBACK ────────────────
//
// Foundation deliverable: composeForChannel's never-throws guarantee is
// only as real as this function, so it exists BEFORE the agent does
// (PR-2a). Mechanical, honest, and it must keep working after the
// agent ships — it is what writes when the flag is off or the model
// fails twice.
//
// The target subreddit is deliberately UNASSIGNED here: the allowlist
// ships empty, the template may not invent a destination, and a draft
// whose target reads UNASSIGNED is visibly not postable — which is the
// correct state, not a defect (docs/copywriters/subreddit-allowlist.md).

import { withChannel } from '@/lib/attribution/channels';
import type { Evidence } from '@/lib/newsjack/template';
import type { ChannelArtifact } from '@/lib/copy/shared/types';

const TITLE_MAX = 300;

function clipTitle(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= TITLE_MAX ? t : `${t.slice(0, TITLE_MAX - 1).trimEnd()}…`;
}

export function renderReddit(ev: Evidence): ChannelArtifact {
  const refUrl = withChannel(ev.replayUrl, 'reddit', { campaign: 'newsjack', medium: 'community' });
  const verb = ev.framing === 'live' ? 'Live on eYKON' : 'Analysis on eYKON';
  const src = ev.sources.length ? `Sources: ${ev.sources.slice(0, 4).join(', ')}.` : '';

  const title = clipTitle(ev.headline);
  const body = [
    `${verb}: ${ev.analystLine}`,
    src,
    'What this does not establish: no cause is confirmed and no ground truth exists yet. A detection is an instrument reading, not an event.',
    'Disclosure: posted by eYKON, the platform that produced this detection.',
    `Live view, with the sensor series: ${refUrl}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    body: `r/UNASSIGNED — pick from the allowlist before posting\n\n# ${title}\n\n${body}`,
    posts: ['UNASSIGNED', title, body],
    refUrl,
  };
}
