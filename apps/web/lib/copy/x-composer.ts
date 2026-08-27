// ─── THE X COMPOSER — NOW A CHANNELWRITER ────────────────────────
//
// The loop this file used to carry (agent-first, template-always,
// never-throws, one retry with verbatim violations, the provenance
// stamp) moved VERBATIM in behaviour to lib/copy/shared/compose.ts in
// the multi-channel foundation, and X became the first ChannelWriter
// on it. The exported surface is unchanged: composeXThread keeps its
// signature and its result shape, so the engine seam and the dry-run
// recompose did not move.
//
// Byte-equivalence notes, checked at refactor time (2026-08-27):
//   · flag off  → renderXThread, meta identical (register 'n/a').
//   · agent path → same prompt assembly (x-voice), same forced tool,
//     same retry wording, same lint set, same meta fields.
//   · the one deliberate difference: the retry preamble now says
//     "draft/artifact" instead of "thread" — channel-neutral, and the
//     violations themselves are what the model acts on.

import { COPYWRITER_MODEL } from '@/lib/analyst/model';
import { renderXThread, threadToBody, type Evidence } from '@/lib/newsjack/template';
import { craftLint } from '@/lib/copy/x-craft-lints';
import { composeForChannel } from '@/lib/copy/shared/compose';
import type { ChannelArtifact, ChannelWriter, ComposeOptions, Register } from '@/lib/copy/shared/types';
import {
  CODEX_VERSION,
  WRITE_THREAD_TOOL,
  copywriterEnabled,
  systemPrompt,
  userPrompt,
} from '@/lib/copy/x-voice';

export type { ComposeOptions, Register };

export interface ComposeMeta {
  composer: 'agent' | 'template';
  model: string | null;
  codexVersion: string;
  register: string;
  attempts: number;
  fallbackReason: string | null;
  craftWarnings: string[];
  firstAttemptViolations: string[];
}

export interface ComposeResult {
  posts: string[];
  refUrl: string;
  meta: ComposeMeta;
}

function toArtifact(t: { posts: string[]; refUrl: string }): ChannelArtifact {
  return { body: threadToBody(t.posts), posts: t.posts, refUrl: t.refUrl };
}

export const X_WRITER: ChannelWriter = {
  channel: 'x',
  utmSource: 'x',
  utmMedium: 'social',
  codexVersion: CODEX_VERSION,
  enabled: copywriterEnabled,
  model: () => COPYWRITER_MODEL,
  defaultRegister: 'dry',
  registerEnvVar: 'COPYWRITER_REGISTER',
  template: (ev: Evidence) => toArtifact(renderXThread(ev)),
  tool: WRITE_THREAD_TOOL,
  systemPrompt,
  userPrompt,
  // The tool takes the lead as its own field so its budget binds at
  // generation (#426); `posts` is still accepted so an old-shape answer
  // degrades to a lint failure and a retry, never a silent fallback.
  assemble(input: unknown, refUrl: string): ChannelArtifact | null {
    const i = input as { lead?: unknown; rest?: unknown; posts?: unknown };
    const raw: unknown[] =
      typeof i.lead === 'string' && Array.isArray(i.rest)
        ? [i.lead, ...i.rest]
        : Array.isArray(i.posts)
          ? i.posts
          : [];
    const posts = raw
      .filter((p): p is string => typeof p === 'string')
      .map((p) => p.trim())
      .filter(Boolean);
    return { body: threadToBody(posts), posts, refUrl };
  },
  craftLint: (a, ev, refUrl, recent) => craftLint(a.posts, ev, refUrl, recent),
  maxTokensOut: 1400,
};

export async function composeXThread(
  ev: Evidence,
  recentLeads: string[] = [],
  opts: ComposeOptions = {},
): Promise<ComposeResult> {
  const r = await composeForChannel(X_WRITER, ev, recentLeads, opts);
  return {
    posts: r.artifact.posts,
    refUrl: r.artifact.refUrl,
    meta: { ...r.meta, codexVersion: r.meta.codexVersion ?? CODEX_VERSION },
  };
}
