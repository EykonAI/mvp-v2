// ─── DISCORD PUBLISH — OWN SERVER ONLY (PR-4) ────────────────────
//
// Reached only on founder approval of a DISCORD draft in
// /admin/newsjack. Posts to NEWSJACK_DISCORD_WEBHOOK, which by
// deployment decision points at a channel in the server eYKON owns.
// Publishing into anyone else's community is outreach under the SOP's
// founder-direct rules and is never a code path.
//
// Distinct from NEWSJACK_ALERT_WEBHOOK (the founder "draft ready"
// alert) — pointing this at the alert channel would post marketing
// artifacts into the ops feed. Two variables, two audiences.
//
// FAIL LOUD. Discord itself errors rather than truncating an oversized
// embed, and this module keeps that property end to end: any parse or
// HTTP failure returns ok:false with the reason, the route surfaces it,
// and the draft stays approved-but-unpublished for a manual retry.
// Nothing here writes a success it did not confirm.

export interface DiscordPublishResult {
  ok: boolean;
  /** Discord message id when the webhook confirmed the post (?wait=true). */
  messageId?: string;
  detail?: string;
}

export function discordConfigured(): boolean {
  return Boolean(process.env.NEWSJACK_DISCORD_WEBHOOK);
}

// The discord writer's artifact is posts: [message, embedJson]
// (lib/copy/shared/types.ts). The embed arrives as JSON text; a parse
// failure is a real failure, never silently posted as plain text —
// the embed carries the limit field and the provenance footer, and a
// message without them is not the artifact the founder approved.
export async function publishDiscord(posts: string[]): Promise<DiscordPublishResult> {
  const url = process.env.NEWSJACK_DISCORD_WEBHOOK;
  if (!url) return { ok: false, detail: 'NEWSJACK_DISCORD_WEBHOOK is not set' };

  const [message, embedJson] = posts;
  if (!message?.trim()) return { ok: false, detail: 'draft has no message part' };

  let embed: Record<string, unknown> | null = null;
  if (embedJson?.trim()) {
    try {
      const parsed: unknown = JSON.parse(embedJson);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        embed = parsed as Record<string, unknown>;
      } else {
        return { ok: false, detail: 'embed part is not a JSON object' };
      }
    } catch (e) {
      return { ok: false, detail: `embed part is not valid JSON: ${e instanceof Error ? e.message : 'parse error'}` };
    }
  }

  try {
    // ?wait=true makes Discord confirm (and return) the created message
    // instead of answering 204 before it exists — the difference between
    // "posted" and "probably posted".
    const r = await fetch(`${url}?wait=true`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: message,
        embeds: embed ? [embed] : [],
        // Belt and braces on top of the compose-time no-mass-mention
        // lint: the webhook itself is told to resolve no mentions at
        // all, so even a hand-edited draft cannot ping a role.
        allowed_mentions: { parse: [] },
      }),
    });
    if (!r.ok) {
      const bodyText = (await r.text()).slice(0, 300);
      return { ok: false, detail: `discord webhook ${r.status}: ${bodyText}` };
    }
    const data = (await r.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, messageId: data?.id, detail: data?.id ? `discord message ${data.id}` : 'posted' };
  } catch (e) {
    return { ok: false, detail: `discord webhook unreachable: ${e instanceof Error ? e.message : 'network error'}` };
  }
}
