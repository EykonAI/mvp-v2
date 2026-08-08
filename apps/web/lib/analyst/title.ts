// ─── AI ANALYST v2 — session auto-title (brief §8.4) ─────────────
//
// After the first exchange, a cheap utility-model call names the
// session ("Hormuz tanker build-up, week of 14 Jul"). Utility calls
// use UTILITY_MODEL (Haiku), never the interactive model. Failures
// are logged and the session keeps its 'New session' default — the
// title is a nicety, never a blocker.

import { getAnthropic } from '@/lib/anthropic';
import { UTILITY_MODEL } from './model';
import { recordLlmTurn } from '@/lib/costs/meter';
import { setSessionTitle } from './store';

export async function autoTitleSession(opts: {
  sessionId: string;
  userText: string;
  assistantText: string;
  // Cost metering (migration 100). Haiku + 64 max_tokens makes this
  // negligible per call, but it is non-zero and it fires once per new
  // session — recorded so the ledger reconciles against the invoice.
  userId?: string | null;
}): Promise<void> {
  try {
    const anthropic = getAnthropic();
    const response = await anthropic.messages.create({
      model: UTILITY_MODEL,
      max_tokens: 64,
      system:
        'You name analyst chat sessions. Reply with ONLY the title: at most 8 words, ' +
        'specific (keep proper nouns, places, commodities), no quotes, no trailing period, ' +
        'founder/analyst register (no emojis, no exclamation marks).',
      messages: [
        {
          role: 'user',
          content: `Question: ${opts.userText.slice(0, 600)}\n\nAnswer (excerpt): ${opts.assistantText.slice(0, 600)}`,
        },
      ],
    });
    const u: any = (response as any).usage;
    await recordLlmTurn(
      { userId: opts.userId ?? null, feature: 'auto_title', sessionId: opts.sessionId },
      UTILITY_MODEL,
      {
        input_tokens: u?.input_tokens ?? 0,
        output_tokens: u?.output_tokens ?? 0,
        cache_write_tokens: u?.cache_creation_input_tokens ?? 0,
        cache_read_tokens: u?.cache_read_input_tokens ?? 0,
        legs: 1,
      },
    );

    const raw = response.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join(' ')
      .trim()
      .replace(/^["'\s]+|["'\s.]+$/g, '');
    if (raw) {
      await setSessionTitle(opts.sessionId, raw.slice(0, 120));
    }
  } catch (err: any) {
    console.error('[analyst] autoTitleSession failed:', err?.message);
  }
}
