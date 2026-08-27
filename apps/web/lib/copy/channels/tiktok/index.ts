// ─── TIKTOK WRITER — TEMPLATE-ONLY STUB (PR-2c builds the agent) ─
//
// enabled() is a real kill switch wired now so PR-2c is content, not
// plumbing. Until it ships, every path through this writer is the
// deterministic template: prompts/tool/craftLint below are the minimal
// honest stubs the contract requires and are unreachable while
// enabled() is false and nothing passes force.

import { TIKTOK_COPYWRITER_MODEL } from '@/lib/analyst/model';
import type { Evidence } from '@/lib/newsjack/template';
import type { ChannelWriter } from '@/lib/copy/shared/types';
import { renderTikTok } from './template';

const on = () => ['on', 'true', '1'].includes((process.env.NEWSJACK_COPYWRITER_TIKTOK ?? '').toLowerCase());

export const TIKTOK_WRITER: ChannelWriter = {
  channel: 'tiktok',
  utmSource: 'tiktok',
  utmMedium: 'social',
  codexVersion: null, // PR-2c ships the codex; null matches template-only rows
  enabled: on,
  model: () => TIKTOK_COPYWRITER_MODEL,
  defaultRegister: 'flat', // founder decision, PR-0 (2026-08-27)
  registerEnvVar: 'COPYWRITER_REGISTER_TIKTOK',
  template: renderTikTok,
  tool: {
    name: 'write_tiktok_script',
    description: 'PR-2c replaces this stub with the real schema (hook, beats with shots, voiceover, sound, caption, hashtags, limitBeat, lockup — each with its own budget).',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  systemPrompt: () => 'stub — the tiktok copywriter ships in PR-2c; this path is unreachable while the flag is off',
  userPrompt: (_ev: Evidence, refUrl: string) => `stub — ${refUrl}`,
  assemble: () => null, // any forced call degrades to the template, never throws
  craftLint: () => ({ ok: true, violations: [], warnings: [] }),
  maxTokensOut: 2000,
};
