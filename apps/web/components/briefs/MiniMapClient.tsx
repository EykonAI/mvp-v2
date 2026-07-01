'use client';
import dynamic from 'next/dynamic';
import type { MiniMapBbox } from './MiniMap';

interface Props {
  lat: number;
  lon: number;
  bbox?: MiniMapBbox | null;
  height?: number;
}

// Client-only wrapper. The globe loads MapView the same way (dynamic,
// ssr: false) because maplibre-gl needs the DOM and throws on the server. This
// lets the (server) convergence detail page embed the mini-map without
// SSR-importing maplibre — the actual map module is fetched in the browser.
const MiniMap = dynamic(() => import('./MiniMap').then((m) => m.MiniMap), {
  ssr: false,
  loading: () => (
    <div
      style={{
        height: 260,
        borderRadius: 4,
        border: '1px solid var(--rule-soft)',
        background: 'var(--bg-panel)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--f-mono)',
        fontSize: 9.5,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--ink-faint)',
      }}
    >
      Loading map …
    </div>
  ),
});

export function MiniMapClient(props: Props) {
  return <MiniMap {...props} />;
}
