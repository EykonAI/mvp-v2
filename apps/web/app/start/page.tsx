import type { Metadata } from 'next';
import './start.css';
import { loadClosingStatus } from '@/lib/closing/status';
import { isPersonaId } from '@/lib/closing/personas';
import { ClosingPage } from './ClosingPage';

/**
 * /start — the closing landing page for campaign traffic (brief v1.4,
 * PRs D/G/H). One route, THREE STEPS, one exit: who you are → your
 * pitch → your setup. /c and /q hand off here (PR E); the homepage keeps
 * serving people who arrive already interested.
 *
 * ?p=<persona> deep-links a channel straight to its own pitch — resolved
 * on the SERVER so the pitch is in the first HTML. Resolving it in a
 * client effect made a campaign visitor watch step 1 flash before their
 * own step 2 replaced it, which is jank on exactly the path the feature
 * exists for.
 *
 * Public: top-level route outside the (app) group, not in middleware
 * APP_PATHS — no login wall, same posture as /c and /q.
 *
 * force-dynamic + no-store: the honesty board and the freshness of this
 * page ARE the product. Next 14's Data Cache would freeze the first
 * response until the next deploy (§17.6) — on a page whose middle
 * screen says "queried live", a frozen response is a false claim.
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export const metadata: Metadata = {
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

// Flipped by PR F when the recording lands in /public/start/. Until then
// the video slot renders its styled fallback — never a broken player.
const VIDEO_SRC: string | null = null;
const VIDEO_POSTER: string | null = null;

export default async function StartPage({
  searchParams,
}: {
  searchParams: { p?: string };
}) {
  const status = await loadClosingStatus();
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null;
  const raw = typeof searchParams?.p === 'string' ? searchParams.p.toLowerCase() : null;
  const initialPersona = isPersonaId(raw) ? raw : null;

  return (
    <main className="cs-page">
      <ClosingPage
        status={status}
        turnstileSiteKey={turnstileSiteKey}
        videoSrc={VIDEO_SRC}
        videoPoster={VIDEO_POSTER}
        initialPersona={initialPersona}
      />
    </main>
  );
}
