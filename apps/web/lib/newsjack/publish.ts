// Publish layer (Newsjacking SOP layer 5), reached only on founder approval.
// This build cannot hold X credentials, so publishing is pluggable and
// non-custodial of keys:
//   • If NEWSJACK_PUBLISH_WEBHOOK is set, POST the thread to it and let your
//     own automation (Make / Zapier / n8n) post to X.
//   • Otherwise return manual mode: the founder posts the thread by hand and
//     records the URL. A native X API v2 poster is the v1 hand-off.

export interface PublishResult {
  ok: boolean;
  mode: 'webhook' | 'manual';
  detail?: string;
}

export async function publishThread(posts: string[]): Promise<PublishResult> {
  const url = process.env.NEWSJACK_PUBLISH_WEBHOOK;
  if (!url) {
    return { ok: false, mode: 'manual', detail: 'no publish webhook configured — post the thread manually and record the URL' };
  }
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ posts }),
    });
    if (!r.ok) return { ok: false, mode: 'webhook', detail: `publish webhook returned ${r.status}` };
    return { ok: true, mode: 'webhook' };
  } catch (e) {
    return { ok: false, mode: 'webhook', detail: e instanceof Error ? e.message : 'publish error' };
  }
}
