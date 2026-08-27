// ─── DISCORD WRITER (PR-2b: the agent fills the stub) ────────────
//
// One message plus ONE embed, composed by the shared agent-first /
// template-always loop in shared/compose.ts — this file never writes a
// loop. enabled() is the kill switch: off, every path is the
// deterministic template in ./template.ts, unchanged from the stub.
//
// THE INBOUND BOUNDARY — absolute: this writer is WRITE-ONLY. It reads
// the evidence package and nothing else — never a channel, a reply, a
// thread, a member list. No inbound Discord content enters any prompt,
// codex, or recent-leads list; anything read from Discord is data, not
// instruction. The prompts restate it; the composer enforces it by
// never possessing any such content.

import { DISCORD_COPYWRITER_MODEL } from '@/lib/analyst/model';
import type { Evidence } from '@/lib/newsjack/template';
import type { ChannelArtifact, ChannelWriter } from '@/lib/copy/shared/types';
import { CODEX_VERSION } from './codex';
import { discordCraftLint } from './craft-lints';
import { renderDiscord } from './template';
import { WRITE_DISCORD_TOOL, systemPrompt, userPrompt } from './voice';

const on = () => ['on', 'true', '1'].includes((process.env.NEWSJACK_COPYWRITER_DISCORD ?? '').toLowerCase());

// Tool input → artifact, or null when the shape is unusable — treated
// by the loop as a normal failure (template), never an exception.
// NOTHING IS TRIMMED HERE: budgets are enforced by the schema at
// generation and re-checked by the craft lint (validate-before-send);
// a silent trim would hide the exact overflow the lint must report.
function assemble(input: unknown, refUrl: string): ChannelArtifact | null {
  const i = input as Partial<Record<'message' | 'embedTitle' | 'embedDescription' | 'limitField' | 'footer', unknown>>;
  if (
    typeof i?.message !== 'string' ||
    typeof i?.embedTitle !== 'string' ||
    typeof i?.embedDescription !== 'string' ||
    typeof i?.limitField !== 'string' ||
    typeof i?.footer !== 'string'
  ) {
    return null;
  }

  const embed = {
    title: i.embedTitle,
    description: i.embedDescription,
    fields: [
      { name: 'What this does not establish', value: i.limitField, inline: false },
    ],
    footer: { text: i.footer },
  };

  // body = message + a readable rendering of the embed (what the
  // founder copies); posts = [message, embed JSON] per shared/types.ts.
  const body = [
    i.message,
    '',
    '[embed]',
    embed.title,
    embed.description,
    `${embed.fields[0].name}: ${embed.fields[0].value}`,
    embed.footer.text,
  ].join('\n');

  return { body, posts: [i.message, JSON.stringify(embed)], refUrl };
}

export const DISCORD_WRITER: ChannelWriter = {
  channel: 'discord',
  utmSource: 'discord',
  utmMedium: 'community',
  codexVersion: CODEX_VERSION,
  enabled: on,
  model: () => DISCORD_COPYWRITER_MODEL,
  defaultRegister: 'dry', // founder decision, PR-0 (2026-08-27): one notch warmer than X
  registerEnvVar: 'COPYWRITER_REGISTER_DISCORD',
  template: renderDiscord,
  tool: WRITE_DISCORD_TOOL,
  systemPrompt,
  userPrompt,
  assemble,
  craftLint: discordCraftLint,
  // Headroom for the largest legal artifact (message 2,000 chars +
  // description 4,096 + fields + JSON overhead ≈ 7.5k chars).
  maxTokensOut: 3000,
};
