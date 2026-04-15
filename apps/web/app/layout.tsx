import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'eYKON.ai — Geopolitical Intelligence Platform',
  description: 'Real-time situational awareness for a complex world. Live aircraft, vessel, conflict, and infrastructure data on an interactive 3D globe.',
  icons: { icon: '/favicon.ico' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body className="bg-eykon-dark text-gray-200 antialiased">
        {children}
      </body>
    </html>
  );
}
