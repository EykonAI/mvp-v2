// ─── REDDIT WRITER — TEMPLATE-ONLY STUB (PR-2a builds the agent) ─
//
// enabled() is a real kill switch wired now so PR-2a is content, not
// plumbing. Until it ships, every path through this writer is the
// deterministic template: prompts/tool/craftLint below are the minimal
// honest stubs the contract requires and are unreachable while
// enabled() is false and nothing passes force.

import { REDDIT_COPYWRITER_MODEL } from '@/lib/analyst/model';
import type { Evidence } from '@/lib/newsjack/template';
import type { ChannelWriter } from '@/lib/copy/shared/types';
import { renderReddit } from './template';

const on = () => ['on', 'true', '1'].includes((process.env.NEWSJACK_COPYWRITER_REDDIT ?? '').toLowerCase());

export const REDDIT_WRITER: ChannelWriter = {
  channel: 'reddit',
  utmSource: 'reddit',
  utmMedium: 'community',
  codexVersion: null, // PR-2a ships the codex; null matches template-only rows
  enabled: on,
  model: () => REDDIT_COPYWRITER_MODEL,
  defaultRegister: 'dry', // founder decision, PR-0 (2026-08-27)
  registerEnvVar: 'COPYWRITER_REGISTER_REDDIT',
  template: renderReddit,
  tool: {
    name: 'write_reddit_post',
    description: 'PR-2a replaces this stub with the real schema (subreddit, title, body, disclosure, limitParagraph — each with its own budget).',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  systemPrompt: () => 'stub — the reddit copywriter ships in PR-2a; this path is unreachable while the flag is off',
  userPrompt: (_ev: Evidence, refUrl: string) => `stub — ${refUrl}`,
  assemble: () => null, // any forced call degrades to the template, never throws
  craftLint: () => ({ ok: true, violations: [], warnings: [] }),
  maxTokensOut: 2000,
};
