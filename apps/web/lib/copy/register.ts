// ─── THE CHANNEL REGISTRY ────────────────────────────────────────
//
// The engine iterates this; it does not know Reddit exists. Adding a
// channel is a directory plus a line here — removing one is deleting
// the line, which is a deploy, which is the correct weight for that
// decision. The per-channel kill switches (NEWSJACK_COPYWRITER_*)
// turn the WRITER off; the template still drafts.
//
// LinkedIn and Substack are template-only entries wrapping the exact
// renderers that have always written them, so their output is
// byte-identical through the registry — that is the refactor's
// regression test.

import { COPYWRITER_MODEL } from '@/lib/analyst/model';
import { renderLinkedIn, renderSubstack, type Evidence } from '@/lib/newsjack/template';
import type { ChannelArtifact, ChannelWriter } from '@/lib/copy/shared/types';
import { X_WRITER } from '@/lib/copy/x-composer';
import { REDDIT_WRITER } from '@/lib/copy/channels/reddit';
import { DISCORD_WRITER } from '@/lib/copy/channels/discord';
import { TIKTOK_WRITER } from '@/lib/copy/channels/tiktok';

function templateOnly(
  channel: 'linkedin' | 'substack',
  utmSource: string,
  utmMedium: ChannelWriter['utmMedium'],
  render: (ev: Evidence) => { body: string; refUrl: string },
): ChannelWriter {
  const template = (ev: Evidence): ChannelArtifact => {
    const r = render(ev);
    return { body: r.body, posts: [r.body], refUrl: r.refUrl };
  };
  return {
    channel,
    utmSource,
    utmMedium,
    codexVersion: null,
    enabled: () => false, // no agent exists or is planned; template is the writer
    model: () => COPYWRITER_MODEL,
    defaultRegister: 'flat',
    registerEnvVar: 'COPYWRITER_REGISTER',
    template,
    tool: { name: 'unused', description: 'template-only channel', input_schema: { type: 'object', properties: {} } },
    systemPrompt: () => 'template-only channel',
    userPrompt: () => 'template-only channel',
    assemble: () => null,
    craftLint: () => ({ ok: true, violations: [], warnings: [] }),
    maxTokensOut: 0,
  };
}

export const CHANNEL_WRITERS: ChannelWriter[] = [
  X_WRITER,
  templateOnly('linkedin', 'linkedin', 'social', renderLinkedIn),
  templateOnly('substack', 'newsletter', 'email', renderSubstack),
  REDDIT_WRITER,
  DISCORD_WRITER,
  TIKTOK_WRITER,
];
