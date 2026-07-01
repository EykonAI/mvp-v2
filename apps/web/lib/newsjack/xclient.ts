import { createHmac, randomBytes } from 'crypto';

// Native X (Twitter) API v2 posting via OAuth 1.0a user context — the classic
// "app posts to its own account" flow. Dependency-free (node crypto). Entirely
// inert unless all four creds are set; a missing cred returns not-configured
// and the caller falls back to the webhook / manual path (publish.ts).
//
// Env: X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET.
// NOTE: build-verified only. A real credential + a single live post must be
// confirmed before relying on this (see RUNBOOK.md) — same posture as any
// untested external integration.

const POST_URL = 'https://api.twitter.com/2/tweets';

interface Creds {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
}

function creds(): Creds | null {
  const apiKey = process.env.X_API_KEY?.trim();
  const apiSecret = process.env.X_API_SECRET?.trim();
  const accessToken = process.env.X_ACCESS_TOKEN?.trim();
  const accessSecret = process.env.X_ACCESS_SECRET?.trim();
  if (!apiKey || !apiSecret || !accessToken || !accessSecret) return null;
  return { apiKey, apiSecret, accessToken, accessSecret };
}

export function xConfigured(): boolean {
  return creds() !== null;
}

// RFC 3986 percent-encoding (stricter than encodeURIComponent).
function pct(s: string): string {
  return encodeURIComponent(s).replace(/[!*'()]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

// OAuth 1.0a Authorization header for a POST to a JSON endpoint. The JSON body
// is NOT part of the signature base (only oauth_* + any query params are); this
// endpoint has no query params.
function authHeader(c: Creds, url: string): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: c.apiKey,
    oauth_nonce: randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: c.accessToken,
    oauth_version: '1.0',
  };
  const paramStr = Object.keys(oauth)
    .sort()
    .map((k) => `${pct(k)}=${pct(oauth[k])}`)
    .join('&');
  const base = `POST&${pct(url)}&${pct(paramStr)}`;
  const signingKey = `${pct(c.apiSecret)}&${pct(c.accessSecret)}`;
  const signature = createHmac('sha1', signingKey).update(base).digest('base64');
  const all: Record<string, string> = { ...oauth, oauth_signature: signature };
  return `OAuth ${Object.keys(all)
    .sort()
    .map((k) => `${pct(k)}="${pct(all[k])}"`)
    .join(', ')}`;
}

async function postTweet(c: Creds, text: string, replyTo?: string): Promise<string> {
  const body: { text: string; reply?: { in_reply_to_tweet_id: string } } = { text };
  if (replyTo) body.reply = { in_reply_to_tweet_id: replyTo };
  const res = await fetch(POST_URL, {
    method: 'POST',
    headers: { authorization: authHeader(c, POST_URL), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: { id?: string }; detail?: string; title?: string };
  if (!res.ok || !json.data?.id) {
    throw new Error(`x_post_failed ${res.status}: ${json.detail ?? json.title ?? 'unknown'}`);
  }
  return json.data.id;
}

// Post a thread — each post replies to the previous. Returns the head tweet's
// URL + all ids. Throws on any post failure (partial threads are surfaced via
// the error message so the founder can finish manually).
export async function postThread(posts: string[]): Promise<{ url: string; ids: string[] }> {
  const c = creds();
  if (!c) throw new Error('x_not_configured');
  const clean = posts.map((p) => p.trim()).filter(Boolean);
  if (clean.length === 0) throw new Error('empty_thread');

  const ids: string[] = [];
  let replyTo: string | undefined;
  try {
    for (const text of clean) {
      const id = await postTweet(c, text, replyTo);
      ids.push(id);
      replyTo = id;
    }
  } catch (e) {
    const posted = ids.length ? ` (${ids.length}/${clean.length} posted: https://x.com/i/web/status/${ids[0]})` : '';
    throw new Error(`${e instanceof Error ? e.message : 'x_error'}${posted}`);
  }
  return { url: `https://x.com/i/web/status/${ids[0]}`, ids };
}
