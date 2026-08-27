// ─── THE COMPOSE LOOP — ONE COPY, EVERY CHANNEL ──────────────────
//
// The agent-first, template-always, never-throws loop, ported from
// x-composer.ts (where it shipped and was hardened through #415–#426)
// and parameterised by ChannelWriter. The behavioural contract it
// carries is the one proven on X:
//
//   · a writing failure never costs the engine a detected event —
//     every exit path returns a publishable artifact;
//   · one retry, with the violations fed back VERBATIM;
//   · firstAttemptViolations survives a successful retry;
//   · the harm register overrides every register setting;
//   · every call is metered via recordLlmTurn (platform overhead);
//   · the stamp (composer/model/codex/attempts/fallback) makes a
//     silent permanent fallback readable from the outside.

import type Anthropic from '@anthropic-ai/sdk';
import { getAnthropic } from '@/lib/anthropic';
import { recordLlmTurn } from '@/lib/costs/meter';
import { voiceLint, coverageLint } from '@/lib/newsjack/lints';
import type { Evidence } from '@/lib/newsjack/template';
import { harmRegisterForced } from '@/lib/copy/shared/harm';
import type {
  ChannelArtifact, ChannelWriter, ComposeMeta, ComposeOptions, ComposeResult, Register,
} from '@/lib/copy/shared/types';

export function currentRegisterFor(w: ChannelWriter): Register {
  const v = (process.env[w.registerEnvVar] ?? w.defaultRegister).toLowerCase();
  return v === 'flat' || v === 'dry' || v === 'open' ? (v as Register) : w.defaultRegister;
}

function templateResult(
  w: ChannelWriter,
  ev: Evidence,
  reason: string | null,
  attempts: number,
  firstViolations: string[] = [],
): ComposeResult {
  const artifact = w.template(ev);
  return {
    artifact,
    meta: {
      composer: 'template',
      model: null,
      codexVersion: w.codexVersion,
      register: 'n/a',
      attempts,
      fallbackReason: reason,
      craftWarnings: [],
      firstAttemptViolations: firstViolations,
    },
  };
}

export async function composeForChannel(
  w: ChannelWriter,
  ev: Evidence,
  recentLeads: string[] = [],
  opts: ComposeOptions = {},
): Promise<ComposeResult> {
  // The template computes the canonical tagged URL; the agent path
  // reuses it so the two can never attribute differently.
  const refUrl = w.template(ev).refUrl;

  if (!w.enabled() && !opts.force) {
    return templateResult(w, ev, null, 0);
  }

  const register = harmRegisterForced(ev) ? 'flat' : (opts.register ?? currentRegisterFor(w));
  let attempts = 0;
  let lastViolations: string[] = [];
  let firstAttemptViolations: string[] = [];
  const messages: Anthropic.Messages.MessageParam[] = [
    { role: 'user', content: w.userPrompt(ev, refUrl) },
  ];

  // One retry, not a loop — a model that failed the lint twice is not
  // going to pass on the fourth attempt, and the cron has a budget.
  for (let i = 0; i < 2; i++) {
    attempts++;
    let artifact: ChannelArtifact | null;
    try {
      artifact = await callWriter(w, messages, ev, register);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown';
      return templateResult(w, ev, `model call failed: ${msg}`, attempts, firstAttemptViolations);
    }
    if (!artifact || artifact.posts.length === 0) {
      return templateResult(w, ev, 'model returned no posts', attempts, firstAttemptViolations);
    }

    // Same honesty gates the template output passes. The agent is a
    // better writer, not a lighter gate.
    const voice = voiceLint(artifact.body);
    const coverage = coverageLint(artifact.body);
    const craft = w.craftLint(artifact, ev, refUrl, recentLeads);
    const violations = [...voice.violations, ...coverage.violations, ...craft.violations];

    if (violations.length === 0) {
      return {
        artifact,
        meta: {
          composer: 'agent',
          model: w.model(),
          codexVersion: w.codexVersion,
          register,
          attempts,
          fallbackReason: null,
          craftWarnings: craft.warnings,
          firstAttemptViolations,
        },
      };
    }

    lastViolations = violations;
    if (i === 0) {
      firstAttemptViolations = violations;
      messages.push({ role: 'assistant', content: JSON.stringify({ posts: artifact.posts }) });
      messages.push({
        role: 'user',
        content: [
          'That draft failed the linter. Fix every item and return the whole artifact again:',
          ...violations.map((v) => `  · ${v}`),
          '',
          'Do not argue with the linter and do not explain the fix. Return the corrected artifact.',
        ].join('\n'),
      });
    }
  }

  return templateResult(w, ev, `lint failed twice: ${lastViolations.join('; ')}`, attempts, firstAttemptViolations);
}

async function callWriter(
  w: ChannelWriter,
  messages: Anthropic.Messages.MessageParam[],
  ev: Evidence,
  register: Register,
): Promise<ChannelArtifact | null> {
  const anthropic = getAnthropic();
  const requestBody = {
    model: w.model(),
    max_tokens: w.maxTokensOut,
    system: [{ type: 'text', text: w.systemPrompt(ev, register) }],
    tools: [w.tool],
    tool_choice: { type: 'tool', name: w.tool.name },
    messages,
    // Thinking cannot combine with a FORCED tool_choice — leaving it on
    // would 400 every composition (analyst-engine lesson, brief §7.2).
    thinking: { type: 'disabled' },
  };

  const response = await anthropic.messages.create(
    requestBody as unknown as Anthropic.Messages.MessageCreateParamsNonStreaming,
  );

  // Platform overhead: never charged to a wallet, always recorded — or
  // the ledger undercounts against the Anthropic invoice and the gap
  // reads as efficiency rather than a missing feed.
  const u = response.usage as unknown as Record<string, number | undefined>;
  await recordLlmTurn({ userId: null, feature: 'newsjack' }, w.model(), {
    input_tokens: u?.input_tokens ?? 0,
    output_tokens: u?.output_tokens ?? 0,
    cache_write_tokens: u?.cache_creation_input_tokens ?? 0,
    cache_read_tokens: u?.cache_read_input_tokens ?? 0,
    legs: 1,
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
  );
  if (!toolUse || toolUse.name !== w.tool.name) return null;

  const refUrl = w.template(ev).refUrl;
  return w.assemble(toolUse.input, refUrl);
}
