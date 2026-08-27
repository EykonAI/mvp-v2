// ─── DISCORD WRITER — TEMPLATE-ONLY STUB (PR-2b builds the agent) ─
//
// enabled() is a real kill switch wired now so PR-2b is content, not
// plumbing. Until it ships, every path through this writer is the
// deterministic template: prompts/tool/craftLint below are the minimal
// honest stubs the contract requires and are unreachable while
// enabled() is false and nothing passes force.

import { DISCORD_COPYWRITER_MODEL } from '@/lib/analyst/model';
import type { Evidence } from '@/lib/newsjack/template';
import type { ChannelWriter } from '@/lib/copy/shared/types';
import { renderDiscord } from './template';

const on = () => ['on', 'true', '1'].includes((process.env.NEWSJACK_COPYWRITER_DISCORD ?? '').toLowerCase());

export const DISCORD_WRITER: ChannelWriter = {
  channel: 'discord',
  utmSource: 'discord',
  utmMedium: 'community',
  codexVersion: null, // PR-2b ships the codex; null matches template-only rows
  enabled: on,
  model: () => DISCORD_COPYWRITER_MODEL,
  defaultRegister: 'dry', // founder decision, PR-0 (2026-08-27)
  registerEnvVar: 'COPYWRITER_REGISTER_DISCORD',
  template: renderDiscord,
  tool: {
    name: 'write_discord_message',
    description: 'PR-2b replaces this stub with the real schema (message, embed title, embed description, embed fields, limit field — each with its own budget).',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  systemPrompt: () => 'stub — the discord copywriter ships in PR-2b; this path is unreachable while the flag is off',
  userPrompt: (_ev: Evidence, refUrl: string) => `stub — ${refUrl}`,
  assemble: () => null, // any forced call degrades to the template, never throws
  craftLint: () => ({ ok: true, violations: [], warnings: [] }),
  maxTokensOut: 2000,
};
