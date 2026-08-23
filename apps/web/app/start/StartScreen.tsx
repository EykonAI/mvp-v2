import type { Metadata } from 'next';
import './start.css';
import { loadClosingStatus } from '@/lib/closing/status';
import { isPersonaId } from '@/lib/closing/personas';
import { channelFromSlug } from '@/lib/closing/channels';
import { ClosingPage } from './ClosingPage';

/**
 * The closing page body, shared by /start and /start/[channel].
 *
 * Both routes render THIS — not two copies. A campaign landing page that
 * drifts between its tagged and untagged variants is a page you can no
 * longer reason about, and the tagged variant is the one real traffic
 * uses, so it is the one that would rot unnoticed.
 */

// Flipped by PR F when the recording lands in /public/start/. Until then
// the video slot renders its styled fallback — never a broken player.
const VIDEO_SRC: string | null = null;
const VIDEO_POSTER: string | null = null;

export const startMetadata: Metadata = {
  title: 'Start — eYKON.ai',
  description:
    'We saw a national blackout from orbit. Live geopolitical sensors, a public forecast record, and 1,000 founding seats at $29/month locked for life.',
  openGraph: {
    title: 'eYKON.ai — We saw a national blackout from orbit',
    description:
      'Three NASA-sensed facilities, three clear nights, one monotonic collapse in emitted light. The founding rate is live: $29/month, locked for life.',
    type: 'website',
  },
};

export async function StartScreen({
  personaParam,
  channelSlug,
}: {
  personaParam?: string;
  channelSlug?: string;
}) {
  const status = await loadClosingStatus();
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null;
  const raw = typeof personaParam === 'string' ? personaParam.toLowerCase() : null;
  const initialPersona = isPersonaId(raw) ? raw : null;

  return (
    <main className="cs-page">
      <ClosingPage
        status={status}
        turnstileSiteKey={turnstileSiteKey}
        videoSrc={VIDEO_SRC}
        videoPoster={VIDEO_POSTER}
        initialPersona={initialPersona}
        channel={channelFromSlug(channelSlug)}
      />
    </main>
  );
}
