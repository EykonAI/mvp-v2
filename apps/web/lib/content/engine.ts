import { createServerSupabase } from '@/lib/supabase-server';
import { runAnalyst } from '@/lib/intelligence-analyst/run';
import { withChannel } from '@/lib/attribution/channels';
import { voiceLint, coverageLint } from '@/lib/newsjack/lints';
import { insertEvent, insertDraft } from '@/lib/newsjack/store';
import { notifyFounder } from '@/lib/newsjack/notify';
import { selectAngle, markAngleUsed, buildAnglePrompt, splitAnswer, endingIsBait } from '@/lib/content/library';

// The daily proactive tick (build-prompt §10). Reuses the newsjack pipeline:
// runAnalyst → gates (voice/coverage + anti-bait) → newsjack_events/drafts
// (source='proactive') → Discord alert → /admin/newsjack. Publishing + the X
// API path are the same as newsjack (the shared X draft). NEVER publishes here.

type SB = ReturnType<typeof createServerSupabase>;
const PUBLIC_BASE = (process.env.NEXT_PUBLIC_SITE_URL || 'https://eykon.ai').replace(/\/+$/, '');
const MAX_POST = 270;

export interface ProactiveResult {
  outcome: 'drafted' | 'blocked' | 'skipped_no_data' | 'no_eligible_angle' | 'analyst_error' | 'insert_failed';
  angle?: string;
  format?: string;
  note?: string;
}

export async function runProactiveTick(supabase: SB): Promise<ProactiveResult> {
  // Last proactive format (anti-repeat) — format is stored in `domain`.
  const { data: lastRow } = await supabase
    .from('newsjack_events')
    .select('domain')
    .eq('source', 'proactive')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastFormat = (lastRow as { domain: string | null } | null)?.domain ?? null;

  const angle = await selectAngle(supabase, lastFormat);
  if (!angle) return { outcome: 'no_eligible_angle' };

  let text = '';
  let toolCalls = 0;
  try {
    const out = await runAnalyst({ prompt: buildAnglePrompt(angle), tier: 'pro' });
    text = out.text.trim();
    toolCalls = out.toolCalls;
  } catch (err) {
    return { outcome: 'analyst_error', angle: angle.title, note: err instanceof Error ? err.message : 'unknown' };
  }
  await markAngleUsed(supabase, angle.id); // cooldown applies whether or not it drafts

  const noData = /insufficient (live )?data/i.test(text) || text.length === 0 || toolCalls === 0;
  if (noData) return { outcome: 'skipped_no_data', angle: angle.title, format: angle.format };

  const { body, hook } = splitAnswer(text);
  const sources = extractSources(text);
  const day = new Date().toISOString().slice(0, 10);

  const eventId = await insertEvent(supabase, {
    source: 'proactive',
    source_ref: null,
    event_key: `proactive:${angle.id}:${day}`, // one per angle per day
    domain: angle.format, // used for the anti-repeat lookup above
    region: angle.title,
    severity: null,
    covered: true,
    status: 'drafted',
    blocked_reason: null,
    evidence: {
      angleId: angle.id, format: angle.format, title: angle.title,
      question: angle.prompt, answer: body, hook, sources, feeds: angle.requiredFeeds,
    },
  });
  if (!eventId) return { outcome: 'insert_failed', angle: angle.title };

  const qUrl = withChannel(`${PUBLIC_BASE}/q/${eventId}`, 'x', { campaign: 'newsjack', medium: 'social' });
  const posts = renderThread(body, hook, sources, qUrl);
  const threadBody = posts.join('\n\n—\n\n');

  const voice = voiceLint(threadBody);
  const coverage = coverageLint(threadBody);
  const bait = endingIsBait(hook);
  const reasons = [...voice.violations, ...coverage.violations, ...(bait ? ['ending is engagement-bait or missing'] : [])];
  const blocked = reasons.length > 0;

  if (blocked) {
    await supabase.from('newsjack_events').update({ status: 'blocked', blocked_reason: reasons.join('; ') }).eq('id', eventId);
  }
  await insertDraft(supabase, {
    event_id: eventId,
    channel: 'x',
    body: threadBody,
    posts,
    ref_url: qUrl,
    lints: { voice, coverage, bait },
    value_pass: !blocked,
    status: 'draft',
  });

  if (blocked) return { outcome: 'blocked', angle: angle.title, format: angle.format, note: reasons.join('; ') };

  await notifyFounder({
    domain: `proactive/${angle.format}`,
    region: angle.title,
    severity: null,
    lead: posts[0] ?? '',
    adminUrl: `${PUBLIC_BASE}/admin/newsjack`,
  });
  return { outcome: 'drafted', angle: angle.title, format: angle.format };
}

// ── helpers ─────────────────────────────────────────────────────

function clip(s: string, n = MAX_POST): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
}

// Lead with the sourced answer (punchy), then sources, then the engagement hook
// + the public /q link. The full question+answer lives on the /q page.
function renderThread(body: string, hook: string, sources: string[], qUrl: string): string[] {
  const posts: string[] = [clip(body)];
  if (sources.length) posts.push(clip(`Sources: ${sources.slice(0, 3).join(' · ')}`));
  posts.push(clip(`${hook ? `${hook} ` : ''}Full read: ${qUrl}`));
  return posts;
}

function extractSources(text: string): string[] {
  const feeds = ['GDELT', 'AIS', 'ADS-B', 'ADSB', 'EIA', 'ACLED', 'OFAC', 'ENTSO-E', 'GEM', 'Polymarket'];
  const found = new Set<string>();
  for (const f of feeds) {
    if (new RegExp(`\\b${f.replace(/[-]/g, '\\-')}\\b`, 'i').test(text)) found.add(f === 'ADSB' ? 'ADS-B' : f);
  }
  return Array.from(found);
}
