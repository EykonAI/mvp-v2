/**
 * PAMS — server-side channel-touch capture. Called from
 * /api/attribution/channel. Writes one channel_touchpoints row per valid
 * tagged landing via the service-role client (migration 046).
 *
 * Sibling of lib/referral/capture.ts (referral attribution_events). It
 * reuses that module's hashIpAddress helper so both attribution streams
 * hash IPs identically and the raw IP is never persisted.
 *
 * Attribution is silent: failures are logged server-side but never
 * surface. The route handler returns 204 unconditionally.
 */

import { createServerSupabase } from '@/lib/supabase-server';
import { hashIpAddress } from '@/lib/referral/capture';
import { normalizeChannel, type ChannelUtm } from './channels';

export type ChannelTouchInput = {
  /** raw utm_source / ?ch value; re-validated here against the canonical list */
  channel: string | null;
  utm: ChannelUtm | null;
  sessionId: string | null;
  userId: string | null;
  landingPath: string | null;
  referrerHost: string | null;
  rawIp: string | null;
};

export type ChannelCaptureResult = { ok: true } | { ok: false; reason: 'invalid_channel' };

/** Sanity-cap free-text fields before they hit the row (defence in depth
 * against an oversized hand-crafted POST body). */
function clamp(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  return v.length > max ? v.slice(0, max) : v;
}

export async function captureChannelTouch(
  input: ChannelTouchInput,
): Promise<ChannelCaptureResult> {
  // Re-validate the channel server-side — never trust the client for the
  // canonical tag, even though the middleware already validated at cookie
  // time. An unknown channel is dropped (no row) so reporting stays clean.
  const channel = normalizeChannel(input.channel);
  if (!channel) return { ok: false, reason: 'invalid_channel' };

  const supabase = createServerSupabase();

  await supabase.from('channel_touchpoints').insert({
    session_id: clamp(input.sessionId, 200),
    user_id: input.userId,
    channel,
    utm_source: clamp(input.utm?.source, 200),
    utm_medium: clamp(input.utm?.medium, 200),
    utm_campaign: clamp(input.utm?.campaign, 200),
    utm_content: clamp(input.utm?.content, 200),
    utm_term: clamp(input.utm?.term, 200),
    landing_path: clamp(input.landingPath, 512),
    referrer_host: clamp(input.referrerHost, 255),
    ip_hash: input.rawIp ? hashIpAddress(input.rawIp) : null,
  });

  return { ok: true };
}
