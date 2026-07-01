import { withChannel } from '@/lib/attribution/channels';

// Render the X thread from an evidence package (Newsjacking SOP §7). Voice:
// dense, sourced, no emojis, no exclamation marks. The lead hooks the event;
// the body carries the sourced analyst line + citations; the close carries the
// replay link (the conversion mechanism) and the founding-seat scarcity.

export interface Evidence {
  domain: string | null;
  region: string | null;
  severity: string | null;
  headline: string; // plain-English event line
  analystLine: string; // sourced one-liner from runAnalyst
  sources: string[]; // citation labels (feed names / urls)
  replayUrl: string; // platform view URL (no utm yet)
  framing: 'live' | 'analytical';
  seatsRemaining?: number | null;
}

const MAX_POST = 270;

function clip(s: string, n = MAX_POST): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
}

export function renderXThread(ev: Evidence): { posts: string[]; refUrl: string } {
  const refUrl = withChannel(ev.replayUrl, 'x', { campaign: 'newsjack', medium: 'social' });
  // "Live" only when the region is actually covered; otherwise frame analytically.
  const verb = ev.framing === 'live' ? 'Live on eYKON' : 'Analysis on eYKON';
  const posts: string[] = [];

  posts.push(clip(ev.headline));
  posts.push(clip(`${verb}: ${ev.analystLine}`));
  if (ev.sources.length) posts.push(clip(`Sources: ${ev.sources.slice(0, 3).join(' · ')}`));
  const seats = ev.seatsRemaining != null ? ` Founding seats remaining: ${ev.seatsRemaining}/1,000.` : '';
  posts.push(clip(`Open the live view: ${refUrl}.${seats}`));

  return { posts, refUrl };
}

// A single display body for the admin queue (posts separated by a rule).
export function threadToBody(posts: string[]): string {
  return posts.join('\n\n—\n\n');
}

// Channel → canonical PAMS utm_source. Substack maps to the owned 'newsletter'
// tag (there is no 'substack' channel in the taxonomy).
const CHANNEL_UTM: Record<'x' | 'linkedin' | 'substack', string> = {
  x: 'x',
  linkedin: 'linkedin',
  substack: 'newsletter',
};

// LinkedIn variant — same evidence, a corporate-risk framing, one post. These
// are draft-only (LinkedIn/Substack have no practical auto-post): the founder
// copies and posts. Same voice + coverage rules apply, so they are linted too.
export function renderLinkedIn(ev: Evidence): { body: string; refUrl: string } {
  const refUrl = withChannel(ev.replayUrl, CHANNEL_UTM.linkedin, { campaign: 'newsjack', medium: 'social' });
  const verb = ev.framing === 'live' ? 'Live on eYKON' : 'Analysis on eYKON';
  const src = ev.sources.length ? `Sources: ${ev.sources.slice(0, 4).join(', ')}.` : '';
  return {
    body: [ev.headline, '', `${verb}: ${ev.analystLine}`, src, '', `The operational view: ${refUrl}`]
      .filter((l) => l !== '')
      .join('\n')
      .replace(/\n{3,}/g, '\n\n'),
    refUrl,
  };
}

// Substack variant — an opening lede that leads into the resolving call.
export function renderSubstack(ev: Evidence): { body: string; refUrl: string } {
  const refUrl = withChannel(ev.replayUrl, CHANNEL_UTM.substack, { campaign: 'newsjack', medium: 'email' });
  const src = ev.sources.length ? `Sourced from ${ev.sources.slice(0, 5).join(', ')}.` : '';
  return {
    body: [ev.headline, '', ev.analystLine, src, '', `Follow the live view and the resolving call: ${refUrl}`]
      .filter((l) => l !== '')
      .join('\n')
      .replace(/\n{3,}/g, '\n\n'),
    refUrl,
  };
}
