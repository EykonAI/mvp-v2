// ─── TIKTOK DETERMINISTIC TEMPLATE — THE FALLBACK ────────────────
//
// The artifact is a SCRIPT PACKAGE a human records, never a post a
// cron publishes (Content Posting API unaudited; posts would be
// SELF_ONLY). The caption carries NO clickable URL by rule — the CTA
// is the spoken/on-screen path, which survives the privacy browsers
// that strip utm parameters. ref_url still stores the tagged replay
// URL for provenance; it appears nowhere in the caption.
//
// The lockup is a hard requirement (§11.2 furniture invariant): the
// video IS the asset, so wordmark + feed + observation UTC + state are
// burned into the frame, and a script without them is not recordable
// as specified.

import { withChannel } from '@/lib/attribution/channels';
import type { Evidence } from '@/lib/newsjack/template';
import type { ChannelArtifact } from '@/lib/copy/shared/types';

const CTA_PATH = 'eykon.ai/start/tiktok';

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
}

export function renderTikTok(ev: Evidence): ChannelArtifact {
  const refUrl = withChannel(ev.replayUrl, 'tiktok', { campaign: 'newsjack', medium: 'social' });
  const where = ev.region ?? 'a monitored theatre';
  const feeds = ev.sources.slice(0, 3).join(' + ') || 'live feeds';

  const hook = clip(`Something moved at ${where}. Here is what the instruments saw.`, 90);
  const beats = [
    `THE SIGNAL · "${clip(ev.analystLine, 220)}" · SHOT: the /c convergence page for this event`,
    `THE INSTRUMENTS · "Named sources: ${feeds}." · SHOT: GLOBE, relevant layer over ${where}`,
    `NOT CONFIRMED (limitBeat) · "A detection is an instrument reading, not an event. Nothing here is confirmed." · SHOT: the evidence panel`,
    `WATCH IT RESOLVE · "Track it live at ${CTA_PATH.replace(/\./g, ' dot ').replace(/\//g, ' slash ')}." · SHOT: /start`,
  ];
  const caption = clip(
    `${ev.headline} Sources: ${feeds}. Not confirmed, and we say so. ${CTA_PATH}`,
    2200,
  );
  const lockup = `LOWER THIRD: eYKON · ${feeds} · drafted from the newsjack queue · UNCONFIRMED — END CARD: ${CTA_PATH}`;

  const lines = [
    `HOOK: ${hook}`,
    ...beats.map((b, i) => `BEAT ${i + 1}: ${b}`),
    'SOUND: spoken voiceover only; burned-in subtitles, two lines max.',
    `CAPTION: ${caption}`,
    'HASHTAGS: #OSINT #satellite',
    `LOCKUP: ${lockup}`,
  ];

  return { body: lines.join('\n\n'), posts: lines, refUrl };
}
