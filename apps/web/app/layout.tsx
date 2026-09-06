import './globals.css';
import type { Metadata } from 'next';
import { PostHogProvider } from '@/components/analytics/PostHogProvider';
import { ChannelCapture } from '@/components/attribution/ChannelCapture';

export const metadata: Metadata = {
  title: 'eYKON.ai — Geopolitical Intelligence Platform',
  description:
    // "3D globe" was untrue: /app renders a FLAT deck.gl + MapLibre
    // web-Mercator map — no _GlobeView, no globe.gl, and maplibre-gl is
    // pinned below the v5 that first shipped a globe projection. This is
    // the site-wide description used in search results and social cards,
    // so it was the most-syndicated false claim on the site. Same class
    // as the #368 homepage truth pass.
    'Real-time situational awareness for a complex world. Live aircraft, vessel, conflict, and infrastructure data on an interactive map and nine deep-dive workspaces.',
  // No manual icons entry: app/icon.svg is the App Router file
  // convention and Next emits the <link rel="icon"> for it. The line
  // that used to live here pointed at /favicon.ico, which 404'd —
  // eykon.ai had no favicon in any browser tab, and a metadata entry
  // would OVERRIDE the file convention and reinstate the 404.
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Jura:wght@300;400;500;600;700&family=IBM+Plex+Sans:wght@300;400;500;600&family=IBM+Plex+Mono:wght@300;400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-eykon-bg-void text-eykon-ink antialiased">
        {/* PAMS: records the inbound marketing-channel touch on any tagged
            landing (utm_source/?ch). No-op on untagged pages. */}
        <ChannelCapture />
        <PostHogProvider>{children}</PostHogProvider>
      </body>
    </html>
  );
}
