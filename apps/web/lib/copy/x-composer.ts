// ─── THE COMPOSER ────────────────────────────────────────────────
//
// Agent-first, template-always. This function is the only thing the
// newsjack engine calls to get an X thread, and it NEVER THROWS.
//
// A writing failure must never cost the engine a detected event. The
// newsjack window is 15–60 minutes; losing a draft because a model
// had a bad turn is a worse outcome than publishing the plainer
// template version. Every exit path returns a publishable thread.
//
// It also stamps HOW the thread was produced onto the result, so a
// silent permanent fallback is visible from the outside — the same
// echo-your-inputs habit that exposed six days of merges that never
// deployed (brief §17.3). Without the stamp, an agent that is failing
// every single run looks exactly like an agent that is working.

import type Anthropic from '@anthropic-ai/sdk';
import { getAnthropic } from '@/lib/anthropic';
import { COPYWRITER_MODEL } from '@/lib/analyst/model';
import { recordLlmTurn } from '@/lib/costs/meter';
import { renderXThread, type Evidence } from '@/lib/newsjack/template';
import { voiceLint, coverageLint } from '@/lib/newsjack/lints';
import { craftLint } from '@/lib/copy/x-craft-lints';
import {
  CODEX_VERSION,
  WRITE_THREAD_TOOL,
  copywriterEnabled,
  currentRegister,
  harmRegisterForced,
  systemPrompt,
  userPrompt,
  type Register,
} from '@/lib/copy/x-voice';

export interface ComposeMeta {
  composer: 'agent' | 'template';
  model: string | null;
  codexVersion: string;
  register: string;
  attempts: number;
  fallbackReason: string | null;
  craftWarnings: string[];
}

export interface ComposeResult {
  posts: string[];
  refUrl: string;
  meta: ComposeMeta;
}

const MAX_TOKENS_OUT = 1400;

function templateResult(ev: Evidence, reason: string | null, attempts: number): ComposeResult {
  const t = renderXThread(ev);
  return {
    posts: t.posts,
    refUrl: t.refUrl,
    meta: {
      composer: 'template',
      model: null,
      codexVersion: CODEX_VERSION,
      register: 'n/a',
      attempts,
      fallbackReason: reason,
      craftWarnings: [],
    },
  };
}

export interface ComposeOptions {
  /** Compose even when NEWSJACK_COPYWRITER is off. ONLY for the founder-gated
   *  dry-run recompose: without it that tool is inert precisely when it is
   *  most useful — before the flag has ever been switched on. The engine never
   *  passes this, so the kill switch remains absolute on the publishing path. */
  force?: boolean;
  /** Compose at a specific register regardless of COPYWRITER_REGISTER, so all
   *  three can be compared on the same evidence. The harm rule still wins. */
  register?: Register;
}

export async function composeXThread(
  ev: Evidence,
  recentLeads: string[] = [],
  opts: ComposeOptions = {},
): Promise<ComposeResult> {
  // The template computes the canonical ref URL (with the channel utm
  // tag). We reuse ITS url rather than recomputing, so the agent path
  // and the fallback path can never attribute differently.
  const base = renderXThread(ev);
  const refUrl = base.refUrl;

  if (!copywriterEnabled() && !opts.force) {
    return templateResult(ev, null, 0);
  }

  const register = harmRegisterForced(ev) ? 'flat' : (opts.register ?? currentRegister());
  let attempts = 0;
  let lastViolations: string[] = [];
  const messages: Anthropic.Messages.MessageParam[] = [
    { role: 'user', content: userPrompt(ev, refUrl) },
  ];

  // One retry, not a loop. A model that has failed the voice lint
  // twice is not going to pass on the fourth attempt, and the cron has
  // a budget.
  for (let i = 0; i < 2; i++) {
    attempts++;
    let posts: string[];
    try {
      posts = await callWriter(messages, ev, opts.register);
    } catch (err: any) {
      return templateResult(ev, `model call failed: ${err?.message ?? 'unknown'}`, attempts);
    }
    if (!posts.length) {
      return templateResult(ev, 'model returned no posts', attempts);
    }

    // Same honesty gates the template output passes. The agent is a
    // better writer, not a lighter gate.
    const body = posts.join('\n\n—\n\n');
    const voice = voiceLint(body);
    const coverage = coverageLint(body);
    const craft = craftLint(posts, ev, refUrl, recentLeads);

    const violations = [...voice.violations, ...coverage.violations, ...craft.violations];
    if (violations.length === 0) {
      return {
        posts,
        refUrl,
        meta: {
          composer: 'agent',
          model: COPYWRITER_MODEL,
          codexVersion: CODEX_VERSION,
          register,
          attempts,
          fallbackReason: null,
          craftWarnings: craft.warnings,
        },
      };
    }

    lastViolations = violations;
    if (i === 0) {
      // Feed the violations back verbatim. Telling the model what a
      // linter said is far more reliable than re-describing the rule.
      messages.push({ role: 'assistant', content: JSON.stringify({ posts }) });
      messages.push({
        role: 'user',
        content: [
          'That thread failed the linter. Fix every item and return the whole thread again:',
          ...violations.map((v) => `  · ${v}`),
          '',
          'Do not argue with the linter and do not explain the fix. Return the corrected thread.',
        ].join('\n'),
      });
    }
  }

  return templateResult(ev, `lint failed twice: ${lastViolations.join('; ')}`, attempts);
}

async function callWriter(
  messages: Anthropic.Messages.MessageParam[],
  ev: Evidence,
  register?: Register,
): Promise<string[]> {
  const anthropic = getAnthropic();
  const requestBody = {
    model: COPYWRITER_MODEL,
    max_tokens: MAX_TOKENS_OUT,
    system: [{ type: 'text', text: systemPrompt(ev, register) }],
    tools: [WRITE_THREAD_TOOL],
    tool_choice: { type: 'tool', name: 'write_thread' },
    messages,
    // Thinking cannot be combined with a FORCED tool_choice, and this
    // call forces write_thread — leaving it on would 400 every
    // composition. Same disable the analyst engine and the NOTIF
    // evaluator apply, for the same reason.
    thinking: { type: 'disabled' },
  };

  const response = await anthropic.messages.create(
    requestBody as unknown as Anthropic.Messages.MessageCreateParamsNonStreaming,
  );

  // Platform overhead: this costs the same with zero users, so it is
  // never charged to a wallet — but it IS recorded, or the ledger
  // undercounts against the Anthropic invoice and the gap reads as
  // efficiency rather than a missing feed.
  const u: any = response.usage;
  await recordLlmTurn({ userId: null, feature: 'newsjack' }, COPYWRITER_MODEL, {
    input_tokens: u?.input_tokens ?? 0,
    output_tokens: u?.output_tokens ?? 0,
    cache_write_tokens: u?.cache_creation_input_tokens ?? 0,
    cache_read_tokens: u?.cache_read_input_tokens ?? 0,
    legs: 1,
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
  );
  if (!toolUse || toolUse.name !== 'write_thread') return [];

  const input = toolUse.input as { posts?: unknown };
  if (!Array.isArray(input.posts)) return [];
  return input.posts
    .filter((p): p is string => typeof p === 'string')
    .map((p) => p.trim())
    .filter(Boolean);
}
