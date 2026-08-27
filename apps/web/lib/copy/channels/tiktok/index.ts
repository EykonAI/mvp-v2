// ─── TIKTOK WRITER — codex, prompts, craft lints (PR-2c) ─────────
//
// Fills the PR-2b stub. The artifact is a SCRIPT PACKAGE a human
// records, never a post a cron publishes — the Content Posting API is
// unaudited and SELF_ONLY, and duets/stitches/reply-videos are out of
// scope (inbound-reactive; this writer is write-only).
//
// The compose loop lives in shared/compose.ts and nowhere else; this
// file is data — a codex, two prompts, a forced-tool schema, an
// assembler and a lint. enabled() stays the per-channel kill switch,
// and every path through it while the flag is off is the deterministic
// template, unchanged from the stub.

import { TIKTOK_COPYWRITER_MODEL } from '@/lib/analyst/model';
import type { Evidence } from '@/lib/newsjack/template';
import type { ChannelArtifact, ChannelWriter } from '@/lib/copy/shared/types';
import { renderTikTok } from './template';
import { CODEX_VERSION, WRITE_TIKTOK_TOOL, systemPrompt, userPrompt } from './voice';
import { packageToLines, tiktokCraftLint, type TikTokBeat, type TikTokPackage } from './craft-lints';

const on = () => ['on', 'true', '1'].includes((process.env.NEWSJACK_COPYWRITER_TIKTOK ?? '').toLowerCase());

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

// Tool input → artifact, or null when the shape is unusable — the
// loop treats null as a normal failure (template), never an exception.
function assemble(input: unknown, refUrl: string): ChannelArtifact | null {
  if (typeof input !== 'object' || input === null) return null;
  const i = input as Record<string, unknown>;

  const hook = str(i.hook);
  const voiceover = str(i.voiceover);
  const caption = str(i.caption);
  const limitBeat = str(i.limitBeat);
  const lockupLowerThird = str(i.lockupLowerThird);
  const lockupEndCard = str(i.lockupEndCard);
  if (
    hook === null || voiceover === null || caption === null ||
    limitBeat === null || lockupLowerThird === null || lockupEndCard === null
  ) {
    return null;
  }

  if (!Array.isArray(i.beats)) return null;
  const beats: TikTokBeat[] = [];
  for (const b of i.beats) {
    if (typeof b !== 'object' || b === null) return null;
    const beat = b as Record<string, unknown>;
    const onScreen = str(beat.onScreen);
    const spoken = str(beat.spoken);
    const shot = str(beat.shot);
    if (onScreen === null || spoken === null || shot === null) return null;
    beats.push({ onScreen: onScreen.trim(), spoken: spoken.trim(), shot: shot.trim() });
  }

  const hashtags = Array.isArray(i.hashtags)
    ? i.hashtags.filter((h): h is string => typeof h === 'string').map((h) => h.trim()).filter(Boolean)
    : null;
  if (hashtags === null) return null;

  const pkg: TikTokPackage = {
    hook: hook.trim(),
    beats,
    voiceover: voiceover.trim(),
    caption: caption.trim(),
    hashtags,
    limitBeat: limitBeat.trim(),
    lockupLowerThird: lockupLowerThird.trim(),
    lockupEndCard: lockupEndCard.trim(),
  };

  const lines = packageToLines(pkg);
  return { body: lines.join('\n\n'), posts: lines, refUrl };
}

export const TIKTOK_WRITER: ChannelWriter = {
  channel: 'tiktok',
  utmSource: 'tiktok',
  utmMedium: 'social',
  codexVersion: CODEX_VERSION,
  enabled: on,
  model: () => TIKTOK_COPYWRITER_MODEL,
  defaultRegister: 'flat', // founder decision, PR-0 (2026-08-27): the format supplies the energy
  registerEnvVar: 'COPYWRITER_REGISTER_TIKTOK',
  template: renderTikTok,
  tool: WRITE_TIKTOK_TOOL,
  systemPrompt,
  userPrompt,
  assemble,
  craftLint: tiktokCraftLint,
  maxTokensOut: 3000,
};
