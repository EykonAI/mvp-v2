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

  const lines = [
    `Newsjack digest — last ${windowDays} days`,
    `detected ${counts.detected} · drafted ${counts.drafted} · blocked ${counts.blocked} · approved ${counts.approved} · published ${counts.published} · rejected ${counts.rejected}`,
    `attribution: ${attribution.touches} tagged visits, ${attribution.signups} signups`,
  ];
  if (topBlockReasons.length) {
    lines.push('top block reasons:');
    for (const r of topBlockReasons) lines.push(`  ${r.n}x ${r.reason}`);
  }
  const text = lines.join('\n');

  return { windowDays, counts, topBlockReasons, attribution, text };
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
