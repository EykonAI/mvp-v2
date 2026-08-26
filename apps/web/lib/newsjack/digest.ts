import { createServerSupabase } from '@/lib/supabase-server';

// Measurement digest (Newsjacking SOP layer 6). Summarises the pipeline over a
// window: what was detected / drafted / blocked / published, the top block
// reasons, and the real conversion signal from PAMS (channel_touchpoints tagged
// utm_campaign=newsjack). Delivered to a webhook. No silent caps — the block
// reasons show exactly what was suppressed and why.

type SB = ReturnType<typeof createServerSupabase>;

export interface Digest {
  windowDays: number;
  counts: Record<string, number>;
  topBlockReasons: Array<{ reason: string; n: number }>;
  attribution: { touches: number; signups: number };
  composer: { agent: number; template: number; fallbacks: number };
  retries: { needed: number; topFirstAttemptViolations: Array<{ reason: string; n: number }> };
  text: string;
}

export async function buildDigest(supabase: SB, windowDays = 7): Promise<Digest> {
  const sinceIso = new Date(Date.now() - windowDays * 86400_000).toISOString();

  const { data: evData } = await supabase
    .from('newsjack_events')
    .select('status, blocked_reason')
    .gte('created_at', sinceIso)
    .limit(2000);
  const events = (evData as Array<{ status: string; blocked_reason: string | null }> | null) ?? [];

  const counts: Record<string, number> = { detected: 0, drafted: 0, blocked: 0, approved: 0, published: 0, rejected: 0 };
  const reasonTally = new Map<string, number>();
  for (const e of events) {
    counts[e.status] = (counts[e.status] ?? 0) + 1;
    if (e.status === 'blocked' && e.blocked_reason) {
      // tally by the first (primary) reason
      const primary = e.blocked_reason.split(';')[0].trim().slice(0, 80);
      reasonTally.set(primary, (reasonTally.get(primary) ?? 0) + 1);
    }
  }
  const topBlockReasons = Array.from(reasonTally.entries())
    .map(([reason, n]) => ({ reason, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 3);

  // Attribution: touches tagged newsjack, and how many became known users.
  const { count: touches } = await supabase
    .from('channel_touchpoints')
    .select('id', { count: 'exact', head: true })
    .eq('utm_campaign', 'newsjack')
    .gte('created_at', sinceIso);
  const { data: convData } = await supabase
    .from('channel_touchpoints')
    .select('user_id')
    .eq('utm_campaign', 'newsjack')
    .not('user_id', 'is', null)
    .gte('created_at', sinceIso)
    .limit(5000);
  const signups = new Set(((convData as Array<{ user_id: string | null }> | null) ?? []).map((r) => r.user_id).filter(Boolean)).size;

  const attribution = { touches: touches ?? 0, signups };

  // Which writer produced this week's X drafts, and how often the
  // copywriter fell back. A silent permanent fallback is the failure
  // mode the whole composer design is built to make visible, so it
  // gets a line in the digest rather than living only in the queue.
  const { data: compData } = await supabase
    .from('newsjack_drafts')
    .select('composer, fallback_reason, compose_attempts, lints')
    .eq('channel', 'x')
    .gte('created_at', sinceIso)
    .limit(2000);
  const comps =
    (compData as Array<{
      composer: string | null;
      fallback_reason: string | null;
      compose_attempts: number | null;
      lints: Record<string, unknown> | null;
    }> | null) ?? [];
  const composer = {
    agent: comps.filter((c) => c.composer === 'agent').length,
    template: comps.filter((c) => c.composer !== 'agent').length,
    fallbacks: comps.filter((c) => c.fallback_reason).length,
  };

  // WHY the retries were needed, tallied. A retry that always succeeds still
  // costs a model call and still says the prompt is missing something
  // systematically — but only if the reason survives the retry. It is stored
  // on lints.firstAttempt precisely so this tally is possible.
  const retryTally = new Map<string, number>();
  for (const c of comps) {
    const fa = c.lints && typeof c.lints === 'object' ? (c.lints as any).firstAttempt : null;
    if (!Array.isArray(fa)) continue;
    for (const v of fa) {
      if (typeof v !== 'string') continue;
      // Strip the row-specific numbers so "post 2 is 281 chars" and
      // "post 4 is 274 chars" tally as one recurring cause, not two.
      const key = v.replace(/\b\d+\b/g, 'N').slice(0, 90);
      retryTally.set(key, (retryTally.get(key) ?? 0) + 1);
    }
  }
  const retries = {
    needed: comps.filter((c) => (c.compose_attempts ?? 0) > 1).length,
    topFirstAttemptViolations: Array.from(retryTally.entries())
      .map(([reason, n]) => ({ reason, n }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 3),
  };

  const lines = [
    `Newsjack digest — last ${windowDays} days`,
    `detected ${counts.detected} · drafted ${counts.drafted} · blocked ${counts.blocked} · approved ${counts.approved} · published ${counts.published} · rejected ${counts.rejected}`,
    `attribution: ${attribution.touches} tagged visits, ${attribution.signups} signups`,
    `X copy: ${composer.agent} by the copywriter, ${composer.template} by the template` +
      (composer.fallbacks ? ` (${composer.fallbacks} fell back — check /admin/newsjack)` : ''),
  ];
  if (retries.needed) {
    lines.push(`retries: ${retries.needed} of ${composer.agent} agent drafts needed a second attempt`);
    for (const r of retries.topFirstAttemptViolations) lines.push(`  ${r.n}x ${r.reason}`);
  }
  if (topBlockReasons.length) {
    lines.push('top block reasons:');
    for (const r of topBlockReasons) lines.push(`  ${r.n}x ${r.reason}`);
  }
  const text = lines.join('\n');

  return { windowDays, counts, topBlockReasons, attribution, composer, retries, text };
}

export async function deliverDigest(text: string): Promise<boolean> {
  const url = process.env.NEWSJACK_DIGEST_WEBHOOK ?? process.env.NEWSJACK_ALERT_WEBHOOK;
  if (!url) return false;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, content: text }),
    });
    return r.ok;
  } catch {
    return false;
  }
}
