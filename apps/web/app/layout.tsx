import './globals.css';
import type { Metadata } from 'next';
import { PostHogProvider } from '@/components/analytics/PostHogProvider';

export const metadata: Metadata = {
  title: 'eYKON.ai — Geopolitical Intelligence Platform',
  description:
    'Real-time situational awareness for a complex world. Live aircraft, vessel, conflict, and infrastructure data on an interactive 3D globe and nine deep-dive workspaces.',
  icons: { icon: '/favicon.ico' },
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
        <PostHogProvider>{children}</PostHogProvider>
      </body>
    </html>
  );
}
