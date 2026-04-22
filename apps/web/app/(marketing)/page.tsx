import type { Metadata } from 'next';
import { Landing } from './Landing';

export const metadata: Metadata = {
  title: 'eYKON.ai — Geopolitical Intelligence for Fast Decisions',
  description:
    'Real-time geopolitical signals translated into trade-relevant cues. Built for day-traders, independent analysts, and the journalists who cover them.',
  openGraph: {
    title: 'eYKON.ai — Geopolitical Intelligence for Fast Decisions',
    description:
      'Maritime chokepoints, energy infrastructure, sanctions events, conflict escalation — a single screen from event to position idea in seconds.',
    type: 'website',
    url: 'https://mvp.eykon.ai',
    siteName: 'eYKON.ai',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'eYKON.ai — Geopolitical Intelligence for Fast Decisions',
    description:
      'Real-time signals translated into trade-relevant cues. Founding rate locked for life.',
  },
};

export default function MarketingHome() {
  return <Landing />;
}
