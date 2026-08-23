import { StartScreen, startMetadata } from '../StartScreen';

/**
 * /start/<channel> — the closing page, with the traffic source carried in
 * the PATH instead of the query string.
 *
 * Measured on production 2026-08-23: DuckDuckGo strips `?utm_source=` from
 * the address bar before the page loads, so every visitor on a privacy
 * browser reached /start looking organic — and `purchases.utm_source`, the
 * Channel column of the admin Subscribers view, would have read "—" for
 * them forever. Brave and Safari 17+ ship comparable protection.
 *
 * A path segment cannot be distinguished from ordinary routing, so no
 * tracking-parameter stripper removes it. Post /start/reddit and the
 * channel survives.
 *
 * Unknown-but-well-formed slugs still render the page. A campaign link
 * must never 404 because someone invented a new channel name on a Friday
 * night; channels.ts keeps the data clean with a strict pattern instead.
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const metadata = startMetadata;

export default async function StartChannelPage({
  params,
  searchParams,
}: {
  params: { channel: string };
  searchParams: { p?: string };
}) {
  return <StartScreen personaParam={searchParams?.p} channelSlug={params.channel} />;
}
