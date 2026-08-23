import { StartScreen, startMetadata } from './StartScreen';

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
 * /start/<channel> renders this same screen with the traffic source read
 * from the PATH, because privacy browsers strip ?utm_source= before our
 * code ever runs — see lib/closing/channels.ts.
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
export const metadata = startMetadata;

export default async function StartPage({
  searchParams,
}: {
  searchParams: { p?: string };
}) {
  return <StartScreen personaParam={searchParams?.p} />;
}
