import { createServerSupabase } from '@/lib/supabase-server';
import { runAnalyst } from '@/lib/intelligence-analyst/run';
import { framingFor } from '@/lib/newsjack/coverage';
import { voiceLint, coverageLint } from '@/lib/newsjack/lints';
import type { Evidence } from '@/lib/newsjack/template';
import { threadToBody } from '@/lib/newsjack/template';
import { CHANNEL_WRITERS } from '@/lib/copy/register';
import { composeForChannel } from '@/lib/copy/shared/compose';
import { composeXThread } from '@/lib/copy/x-composer';
import { insertEvent, insertDraft, recentLeads as fetchRecentLeads } from '@/lib/newsjack/store';
import { notifyFounder } from '@/lib/newsjack/notify';
import { selectAngle, markAngleUsed, buildAnglePrompt, splitAnswer, endingIsBait } from '@/lib/content/library';

// The daily proactive tick (build-prompt §10). Reuses the newsjack pipeline:
// runAnalyst → gates (voice/coverage + anti-bait) → newsjack_events/drafts
// (source='proactive') → Discord alert → /admin/newsjack. Publishing + the X
// API path are the same as newsjack (the shared X draft). NEVER publishes here.

type SB = ReturnType<typeof createServerSupabase>;
const PUBLIC_BASE = (process.env.NEXT_PUBLIC_SITE_URL || 'https://eykon.ai').replace(/\/+$/, '');

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
    // Platform overhead — see process-anomaly-flags.
    const out = await runAnalyst({
      prompt: buildAnglePrompt(angle),
      tier: 'pro',
      meter: { userId: null, feature: 'content_daily' },
    });
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

  // ── PR-5: the proactive layer drafts through the SAME registry as
  // newsjack. The evidence package carries the answer as the analyst
  // line and the raw /q URL as the replay target; each writer's own
  // template applies its channel utm tag (the engine never pre-tags).
  // The framing verdict is computed from the angle title, not assumed:
  // an angle ABOUT Hormuz must be framed analytically here exactly as a
  // detected event there would be.
  const evidence: Evidence = {
    domain: angle.format,
    region: angle.title,
    severity: null,
    headline: hook || angle.title,
    analystLine: body,
    sources,
    replayUrl: `${PUBLIC_BASE}/q/${eventId}`,
    framing: framingFor(angle.title),
    seatsRemaining: null,
  };

  let recentLeads: string[] = [];
  try {
    recentLeads = await fetchRecentLeads(supabase, 10);
  } catch {
    recentLeads = [];
  }

  // X decides `blocked`, exactly as in the newsjack engine — one
  // channel's craft must not suppress the event, and the proactive
  // anti-bait check stays: it is this layer's own honesty rule.
  const x = await composeXThread(evidence, recentLeads);
  const threadBody = threadToBody(x.posts);
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
    posts: x.posts,
    ref_url: x.refUrl,
    lints: { voice, coverage, bait, firstAttempt: x.meta.firstAttemptViolations },
    value_pass: !blocked,
    status: 'draft',
    composer: x.meta.composer,
    composer_model: x.meta.model,
    codex_version: x.meta.codexVersion,
    compose_attempts: x.meta.attempts,
    fallback_reason: x.meta.fallbackReason,
    craft_warnings: x.meta.craftWarnings,
  });

  if (blocked) return { outcome: 'blocked', angle: angle.title, format: angle.format, note: reasons.join('; ') };

  for (const w of CHANNEL_WRITERS) {
    if (w.channel === 'x') continue;
    const r = await composeForChannel(w, evidence, recentLeads);
    const v = voiceLint(r.artifact.body);
    const c = coverageLint(r.artifact.body);
    await insertDraft(supabase, {
      event_id: eventId,
      channel: w.channel,
      body: r.artifact.body,
      posts: r.artifact.posts,
      ref_url: r.artifact.refUrl,
      lints: { voice: v, coverage: c, firstAttempt: r.meta.firstAttemptViolations },
      value_pass: v.ok && c.ok,
      status: 'draft',
      composer: r.meta.composer,
      composer_model: r.meta.model,
      codex_version: r.meta.codexVersion,
      compose_attempts: r.meta.attempts,
      fallback_reason: r.meta.fallbackReason,
      craft_warnings: r.meta.craftWarnings,
    });
  }
  const posts = x.posts;

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

// The bespoke X renderer that lived here was retired in PR-5: the
// registry's writers (agent-first, template-always) draft every channel
// now, and the X template already keeps the URL post un-clipped — the
// UUID-truncation lesson that renderer carried is enforced there.
function extractSources(text: string): string[] {
  const feeds = ['GDELT', 'AIS', 'ADS-B', 'ADSB', 'EIA', 'ACLED', 'OFAC', 'ENTSO-E', 'GEM', 'Polymarket'];
  const found = new Set<string>();
  for (const f of feeds) {
    if (new RegExp(`\\b${f.replace(/[-]/g, '\\-')}\\b`, 'i').test(text)) found.add(f === 'ADSB' ? 'ADS-B' : f);
  }
  return Array.from(found);
}
