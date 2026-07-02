import { createServerSupabase } from '@/lib/supabase-server';

// The query library for the Proactive Content Layer (build-prompt §7–9). Angles
// are specific, cross-feed analyst prompts stored in content_angles. This module
// owns: selection (format rotation + surprise + cross-feed + cooldown), the
// per-format analyst prompt, answer/hook splitting, and the anti-bait ending gate.

type SB = ReturnType<typeof createServerSupabase>;

export type ContentFormat =
  | 'analyst_query'
  | 'data_snapshot'
  | 'myth_check'
  | 'base_rate'
  | 'entity_deep_cut'
  | 'calibration_retro';

export interface Angle {
  id: string;
  format: ContentFormat;
  title: string;
  prompt: string;
  requiredFeeds: string[];
  weight: number;
  cooldownDays: number;
}

interface AngleRow {
  id: string;
  format: string;
  title: string;
  prompt: string;
  required_feeds: string[] | null;
  weight: number | string;
  cooldown_days: number | string;
  last_used_at: string | null;
}

// Lower-frequency formats the surprise budget biases toward, to break routine.
const RARE_FORMATS = new Set<ContentFormat>(['myth_check', 'entity_deep_cut']);

// Select the next angle: enabled, off cooldown, >=2 feeds (cross-domain hard
// rule); avoid the last-used format; weighted-random; with an occasional
// surprise toward a rarer format (§9). Null when nothing is eligible.
export async function selectAngle(supabase: SB, lastFormat: string | null): Promise<Angle | null> {
  const { data } = await supabase
    .from('content_angles')
    .select('id, format, title, prompt, required_feeds, weight, cooldown_days, last_used_at')
    .eq('enabled', true)
    .limit(200);
  const rows = (data as AngleRow[] | null) ?? [];
  const now = Date.now();

  const eligible: Angle[] = rows
    .filter((r) => (r.required_feeds ?? []).length >= 2) // cross-feed hard rule
    .filter((r) => {
      if (!r.last_used_at) return true;
      const days = (now - Date.parse(r.last_used_at)) / 86400_000;
      return days >= Number(r.cooldown_days);
    })
    .map((r) => ({
      id: r.id,
      format: r.format as ContentFormat,
      title: r.title,
      prompt: r.prompt,
      requiredFeeds: r.required_feeds ?? [],
      weight: Number(r.weight),
      cooldownDays: Number(r.cooldown_days),
    }));
  if (eligible.length === 0) return null;

  // Anti-repeat: drop the last-used format if alternatives exist.
  const notLast = eligible.filter((a) => a.format !== lastFormat);
  let pool = notLast.length > 0 ? notLast : eligible;

  // Surprise budget: ~1 in 5, bias toward a rarer format when present.
  const rare = pool.filter((a) => RARE_FORMATS.has(a.format));
  if (rare.length > 0 && Math.random() < 0.2) pool = rare;

  return weightedPick(pool);
}

function weightedPick(pool: Angle[]): Angle {
  const total = pool.reduce((s, a) => s + Math.max(1, a.weight), 0);
  let r = Math.random() * total;
  for (const a of pool) {
    r -= Math.max(1, a.weight);
    if (r <= 0) return a;
  }
  return pool[pool.length - 1];
}

export async function markAngleUsed(supabase: SB, id: string): Promise<void> {
  await supabase.from('content_angles').update({ last_used_at: new Date().toISOString() }).eq('id', id);
}

// Format-specific framing prepended to the angle prompt.
const FORMAT_FRAME: Record<ContentFormat, string> = {
  analyst_query: 'Answer this as a sharp analyst take.',
  data_snapshot: 'Give a crisp current-state reading from the live feeds.',
  myth_check: 'Test the claim against the live data and correct it if the data disagrees.',
  base_rate: 'Lead with the historical base rate, then place the present against it.',
  entity_deep_cut: 'Give a focused, specific read on the single entity named.',
  calibration_retro: 'State the prior call, its date, and how it resolved against outcomes.',
};

export function buildAnglePrompt(angle: Angle): string {
  const feeds = angle.requiredFeeds.join(', ');
  return (
    `${FORMAT_FRAME[angle.format]}\n\n${angle.prompt}\n\n` +
    `Requirements:\n` +
    `- Use your live-data tools and draw on at least these feeds: ${feeds}. Name the feed(s) you used.\n` +
    `- One or two dense sentences an analyst or macro trader would value; include a concrete figure.\n` +
    `- No emojis. No exclamation marks. No marketing language.\n` +
    `- Then add a FINAL line prefixed exactly "HOOK:" that invites genuine engagement — either a specific open question a knowledgeable reader could answer, or a falsifiable prediction with a rough timeframe. Do not use generic calls like "what do you think" or "comment below".\n` +
    `- If you lack the live data to support a real claim, reply exactly "insufficient live data" and nothing else.`
  );
}

// Split the analyst reply into the answer body and the HOOK ending.
export function splitAnswer(text: string): { body: string; hook: string } {
  const idx = text.lastIndexOf('HOOK:');
  if (idx === -1) return { body: text.trim(), hook: '' };
  return { body: text.slice(0, idx).trim(), hook: text.slice(idx + 5).trim() };
}

// Anti-bait: reject generic engagement CTAs (an empty hook also fails — a real
// engagement device is required).
const BAIT = [
  'comment below', 'what do you think', 'what are your thoughts', 'let me know',
  'drop a', 'like and share', 'thoughts?', 'agree?', 'retweet if', 'follow for', 'smash that',
];
export function endingIsBait(hook: string): boolean {
  const h = hook.toLowerCase().trim();
  if (!h) return true;
  return BAIT.some((b) => h.includes(b));
}
