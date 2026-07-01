import { xConfigured, postThread } from '@/lib/newsjack/xclient';

// Publish layer (Newsjacking SOP layer 5), reached only on founder approval of
// an X draft. Preference order:
//   1. Native X API v2 (if X_API_* creds are set) — posts the thread directly.
//   2. NEWSJACK_PUBLISH_WEBHOOK — your own automation posts it (Make/Zapier/n8n).
//   3. Manual — the founder posts the thread and records the URL.

export interface PublishResult {
  ok: boolean;
  mode: 'x_api' | 'webhook' | 'manual';
  url?: string;
  detail?: string;
}

async function tryWebhook(posts: string[]): Promise<boolean> {
  const url = process.env.NEWSJACK_PUBLISH_WEBHOOK;
  if (!url) return false;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ posts }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function publishThread(posts: string[]): Promise<PublishResult> {
  if (xConfigured()) {
    try {
      const { url } = await postThread(posts);
      return { ok: true, mode: 'x_api', url };
    } catch (e) {
      const detail = e instanceof Error ? e.message : 'x error';
      if (await tryWebhook(posts)) return { ok: true, mode: 'webhook', detail: `x_api failed (${detail}); used webhook` };
      return { ok: false, mode: 'manual', detail: `x_api failed (${detail}); post manually` };
    }
  }
  if (await tryWebhook(posts)) return { ok: true, mode: 'webhook' };
  return { ok: false, mode: 'manual', detail: 'no X credentials or publish webhook — post the thread manually and record the URL' };
}
