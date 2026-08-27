// ─── DISCORD DETERMINISTIC TEMPLATE — THE FALLBACK ───────────────
//
// Budgets are enforced HERE, before any payload exists: an over-budget
// embed errors a whole webhook send, so the fallback writer may never
// produce one. Message ≤2,000; embed title ≤256, description ≤4,096
// (our budgets — platform figures are secondary, being conservative
// costs nothing).

import { withChannel } from '@/lib/attribution/channels';
import type { Evidence } from '@/lib/newsjack/template';
import type { ChannelArtifact } from '@/lib/copy/shared/types';

const MSG_MAX = 2000;
const EMBED_TITLE_MAX = 256;
const EMBED_DESC_MAX = 4096;

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
}

export function renderDiscord(ev: Evidence): ChannelArtifact {
  const refUrl = withChannel(ev.replayUrl, 'discord', { campaign: 'newsjack', medium: 'community' });
  const verb = ev.framing === 'live' ? 'Live on eYKON' : 'Analysis on eYKON';

  // The URL must survive the clip, so the prose is clipped around it.
  const head = clip(ev.headline, 300);
  const line = clip(`${verb}: ${ev.analystLine}`, MSG_MAX - head.length - refUrl.length - 8);
  const message = `${head}\n${line}\n${refUrl}`;

  const embed = {
    title: clip(ev.headline, EMBED_TITLE_MAX),
    description: clip(ev.analystLine, EMBED_DESC_MAX),
    fields: [
      ...(ev.sources.length
        ? [{ name: 'Sources', value: clip(ev.sources.slice(0, 6).join(' · '), 1024), inline: false }]
        : []),
      {
        name: 'What this does not establish',
        value: 'No cause confirmed, no ground truth yet. A detection is an instrument reading, not an event.',
        inline: false,
      },
    ],
    footer: { text: `eYKON · ${ev.sources.slice(0, 3).join(' + ') || 'live feeds'} · drafted from the newsjack queue` },
  };

  return {
    body: `${message}\n\n[embed]\n${embed.title}\n${embed.description}\n${embed.fields.map((f) => `${f.name}: ${f.value}`).join('\n')}`,
    posts: [message, JSON.stringify(embed)],
    refUrl,
  };
}
